/**
 * Bringing the tunnel up and down.
 *
 * Creating a `utun` and installing routes needs root, and there are two ways
 * to get it: install a privileged helper that runs forever, or ask macOS for
 * authorization per action. This app does the second, which is the posture
 * SystemCleaner settled on for the same question — elevate for one legible,
 * bounded command, never hold privilege between actions. There is no helper
 * to install, nothing runs as root between connections, and the thing being
 * authorized is a command the user could have typed.
 *
 * The cost is a password prompt per connect, which is the honest price.
 *
 * ## Why these values are rejected rather than escaped
 *
 * The command ends up inside a shell string inside an AppleScript literal:
 *
 *     osascript -e 'do shell script "<shell command>" with administrator privileges'
 *
 * Escaping has to be perfect twice. So nothing reaches the quoting that has
 * not first matched an allowlist — a coordinator is a scheme, host and
 * optional port with no path, query or userinfo; a key is base64. The CLI
 * path is never caller-supplied; it is the bundled binary.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { appleScriptEscape, exec, shellEscape } from '../support/shell'
import { regionById } from '../regions'
import { findCli } from './core'

/** `ws://host`, `wss://host:51821`. No path, no query, no credentials. */
const COORDINATOR_URL = /^wss?:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i
/** A shared secret, as a coordinator token: word characters and dashes. */
const AUTH_KEY = /^[\w-]{1,128}$/
/** base64 X25519, which is 43 characters and a `=`. */
const PUBLIC_KEY = /^[\w+/]{42}[\w+/=]=$/

export interface ServerEntry {
  /** `ws://` or `wss://` host, optionally with a port. */
  coordinatorUrl: string
  /** Shared secret, when the coordinator requires one. */
  authKey?: string
  /** A specific exit node's public key, or `auto`. Absent means no exit. */
  useExit?: string
}

export type ServerMap = Record<string, ServerEntry>

/** `~/Library/Application Support/BuddyVPN`. */
export function appSupportDir(): string {
  return path.join(os.homedir(), 'Library/Application Support', 'BuddyVPN')
}

/**
 * Where each region's coordinator lives.
 *
 * A file rather than a text field on the window, because a coordinator URL is
 * not something you retype per connection — it is a property of a server you
 * deployed once. `bun run deploy:vpn --region us-west` is what produces one;
 * until then a region simply has no server, and the window says so rather
 * than offering a button that cannot work.
 */
export function serversPath(): string {
  return path.join(appSupportDir(), 'servers.json')
}

export function pidFile(): string {
  return path.join(appSupportDir(), 'tunnel.pid')
}

export function logFile(): string {
  return path.join(appSupportDir(), 'tunnel.log')
}

/**
 * Validate a parsed server map, dropping anything malformed.
 *
 * Split from the file read so it can be tested without one — the same split
 * `parseIfconfig` has, and for a better reason: this is the boundary between
 * a file someone hand-edited and a command that runs as root. A bad entry
 * makes its region unavailable; it does not make the app unusable, and it
 * never reaches the shell.
 */
export function parseServers(parsed: unknown): ServerMap {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return {}

  const servers: ServerMap = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!regionById(id) || !value || typeof value !== 'object')
      continue
    const entry = value as Record<string, unknown>
    const coordinatorUrl = entry.coordinatorUrl
    if (typeof coordinatorUrl !== 'string' || !COORDINATOR_URL.test(coordinatorUrl))
      continue

    const authKey = typeof entry.authKey === 'string' && AUTH_KEY.test(entry.authKey) ? entry.authKey : undefined
    const rawExit = entry.useExit
    const useExit = rawExit === 'auto' || (typeof rawExit === 'string' && PUBLIC_KEY.test(rawExit))
      ? rawExit as string
      : undefined

    servers[id] = { coordinatorUrl, ...(authKey ? { authKey } : {}), ...(useExit ? { useExit } : {}) }
  }
  return servers
}

/** The server map on disk, or an empty one when there is no readable file. */
export function readServers(): ServerMap {
  try {
    return parseServers(JSON.parse(fs.readFileSync(serversPath(), 'utf8')))
  }
  catch {
    // No file yet, or not JSON. Both mean no servers are configured, which
    // the window reports as a location you cannot connect to.
    return {}
  }
}

/**
 * The command that brings the tunnel up.
 *
 * `nohup ... &` because the tunnel has to outlive the `osascript` that
 * authorized it, and the pid is recorded so the app can stop what it started
 * — and only what it started.
 *
 * `--full-tunnel` and `--kill-switch` are what make this a VPN rather than a
 * private link to one machine. Without the first, the tunnel comes up and the
 * browser ignores it: the default route still points at Wi-Fi and the only
 * thing that changes is that a `utun` device exists. Without the second, a
 * tunnel that dies is a silent downgrade rather than an outage.
 *
 * Both are therefore the default here rather than options on a screen. An
 * app whose whole purpose is "put my traffic somewhere else" has no honest
 * setting for "but not really", and a kill switch that is off by default
 * protects the people who already knew to turn it on.
 */
export function buildConnectCommand(cli: string, entry: ServerEntry): string {
  const args = ['vpn:up', '--coordinator', entry.coordinatorUrl]
  if (entry.authKey)
    args.push('--auth-key', entry.authKey)
  // `--full-tunnel` refuses to run without an exit, so an entry that names
  // none falls back to `auto` rather than producing a tunnel that carries
  // nothing.
  args.push('--use-exit', entry.useExit ?? 'auto')
  args.push('--full-tunnel', '--kill-switch')

  const quoted = [cli, ...args].map(shellEscape).join(' ')
  return `nohup ${quoted} > ${shellEscape(logFile())} 2>&1 & echo $! > ${shellEscape(pidFile())}`
}

export function buildElevatedCommand(shellCommand: string): string {
  return `osascript -e 'do shell script "${appleScriptEscape(shellCommand)}" with administrator privileges'`
}

/**
 * Whether a running process is a tunnel this app started.
 *
 * A recorded pid is not trusted on its own: pids are reused, and killing a
 * stale one means killing whatever inherited the number. The command line has
 * to show the CLI running `vpn:up`, matched on the resolved path — the CLI
 * also ships as `lt`, which is too common a word to match on.
 */
export function looksLikeTunnel(commandLine: string, cliPath?: string | null): boolean {
  if (!/(?:^|\s)vpn:up(?:\s|$)/.test(commandLine))
    return false
  if (cliPath)
    return commandLine.includes(cliPath)
  return /(?:^|[\s/])(?:localtunnels|lt)(?:\s|$)/.test(commandLine)
}

/**
 * Seconds from `ps -o etime=`, whose formats are `MM:SS`, `HH:MM:SS` and
 * `D-HH:MM:SS`.
 *
 * `etime` rather than `lstart` because it needs no date parsing and no
 * timezone: `lstart` prints a localized string, and a clock that reads
 * "Sun Oct 11" has to be interpreted against the machine's locale to be
 * useful. macOS `ps` has no `etimes`, which is the Linux field that would
 * have given seconds outright.
 */
export function parseElapsed(etime: string): number | null {
  const match = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/)
  if (!match)
    return null

  const [, days, hours, minutes, seconds] = match
  return Number(days ?? 0) * 86_400
    + Number(hours ?? 0) * 3600
    + Number(minutes) * 60
    + Number(seconds)
}

/**
 * How long the tunnel has been up, in seconds.
 *
 * Asked of the kernel rather than remembered by the window. A window counting
 * from when it first noticed restarts its clock whenever the app is reopened,
 * so a tunnel up for two hours would read as thirty seconds old.
 */
export function connectionUptime(pid: number): number | null {
  const ps = exec(`ps -o etime= -p ${pid}`, { timeout: 5000 })
  return ps.ok ? parseElapsed(ps.stdout) : null
}

/** The pid of the tunnel this app started, or null. */
export function connectionPid(): number | null {
  let recorded: number
  try {
    recorded = Number.parseInt(fs.readFileSync(pidFile(), 'utf8').trim(), 10)
  }
  catch {
    return null
  }
  if (!Number.isInteger(recorded) || recorded <= 0)
    return null

  const ps = exec(`ps -o command= -p ${recorded}`, { timeout: 5000 })
  if (!ps.ok || !ps.stdout.trim())
    return null

  return looksLikeTunnel(ps.stdout.trim(), findCli()) ? recorded : null
}

export interface ActionResult {
  success: boolean
  error?: string
}

function formatOsaError(message: string): ActionResult {
  if (message.includes('User canceled') || message.includes('-128'))
    return { success: false, error: 'Cancelled' }
  if (message.includes('authorization'))
    return { success: false, error: 'Authorization failed' }
  return { success: false, error: message.slice(0, 160) || 'Operation failed' }
}

/** Bring the tunnel up for a region, through the macOS authorization dialog. */
export function connect(regionId: string): ActionResult {
  const region = regionById(regionId)
  if (!region)
    return { success: false, error: 'Unknown location' }

  const entry = readServers()[regionId]
  if (!entry)
    return { success: false, error: `No server configured for ${region.country}` }

  const cli = findCli()
  if (!cli)
    return { success: false, error: 'The localtunnels CLI is missing from this app' }

  fs.mkdirSync(appSupportDir(), { recursive: true })
  const result = exec(buildElevatedCommand(buildConnectCommand(cli, entry)), { timeout: 180_000 })
  if (!result.ok)
    return formatOsaError(result.stderr || result.stdout)

  return { success: true }
}

/**
 * Stop the tunnel this app started.
 *
 * Only this app's own tunnel: one brought up in a terminal is visible on the
 * window but is not this app's to kill.
 */
export function disconnect(): ActionResult {
  const pid = connectionPid()
  if (pid === null) {
    // Nothing of ours is running, which is the state the caller wanted.
    try {
      fs.rmSync(pidFile(), { force: true })
    }
    catch {
      // The file is advisory; failing to clear it changes nothing.
    }
    return { success: true }
  }

  // `vpn:down` first, so the kill switch and the captured routes come off
  // even if the process is already gone or refuses to die. It is safe when
  // there is nothing recorded, and it is the only thing that can restore a
  // machine whose tunnel process crashed holding the network shut.
  const cli = findCli()
  const teardown = cli ? `${shellEscape(cli)} vpn:down; ` : ''
  const result = exec(buildElevatedCommand(`${teardown}kill ${pid}`), { timeout: 180_000 })
  if (!result.ok)
    return formatOsaError(result.stderr || result.stdout)

  try {
    fs.rmSync(pidFile(), { force: true })
  }
  catch {
    // As above.
  }
  return { success: true }
}

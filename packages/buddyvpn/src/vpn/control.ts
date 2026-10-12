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
import type { ExecResult } from '../support/shell'
import { appleScriptEscape, exec, execFile, shellEscape } from '../support/shell'
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
 * Where the coordinator secret is staged for the tunnel process.
 *
 * It exists so the key never appears in a command line. `ps` shows every
 * process's full argv to every user on the Mac, so `--auth-key <secret>` hands
 * the credential that admits a client to the network to anything that can run
 * `ps aux` — including software that has no business on the network at all.
 *
 * This is not a new exposure: `servers.json` beside it already holds the same
 * key at the same 0600. It is the argv copy that is removed.
 */
export function authKeyFile(): string {
  return path.join(appSupportDir(), 'authkey')
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
 * The tunnel has to outlive the `osascript` that authorized it, and the pid is
 * recorded so the app can stop what it started — and only what it started.
 *
 * It survives by being orphaned, not by `nohup`. `do shell script` runs with
 * no controlling terminal, and macOS `nohup` fails outright when it tries to
 * detach from a console that was never there: `can't detach from console:
 * Inappropriate ioctl for device`, and the tunnel is dead before it has
 * opened anything. Backgrounding inside a subshell that then exits achieves
 * what nohup was for — the process is reparented to launchd, and with no
 * terminal in the picture there is no SIGHUP for nohup to have shielded it
 * from. stdin comes from /dev/null so nothing can block on a read that will
 * never be answered.
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
  // `--full-tunnel` refuses to run without an exit, so an entry that names
  // none falls back to `auto` rather than producing a tunnel that carries
  // nothing.
  args.push('--use-exit', entry.useExit ?? 'auto')
  args.push('--full-tunnel', '--kill-switch')

  // The secret is read out of a 0600 file by the shell rather than passed as
  // an argument, so it never reaches argv. The CLI takes it from the
  // environment; `connect` writes the file just before this runs.
  const secret = entry.authKey ? `LOCALTUNNELS_AUTH_KEY=$(cat ${shellEscape(authKeyFile())}) ` : ''
  const quoted = [cli, ...args].map(shellEscape).join(' ')
  const log = shellEscape(logFile())
  return `(${secret}${quoted} < /dev/null > ${log} 2>&1 & echo $! > ${shellEscape(pidFile())})`
}

/**
 * The AppleScript that runs a shell command as root, as script text.
 *
 * Only the AppleScript layer is escaped here, and that is the whole point.
 * This used to return a complete `osascript -e '...'` shell command, which
 * added a second layer: the script was wrapped in single quotes and then
 * handed to `/bin/sh`, while the command inside it was full of the single
 * quotes `shellEscape` puts around every path. The first of those closed the
 * wrapper, so `osascript` received a sentence ending mid-string and failed to
 * parse before it could ever ask for a password.
 *
 * Run it with {@link runElevated}, which passes this to `osascript` as an
 * argument rather than as shell source. The escaping that is left is for the
 * shell AppleScript itself invokes, which is what `shellEscape` is for.
 */
export function buildElevatedScript(shellCommand: string): string {
  return `do shell script "${appleScriptEscape(shellCommand)}" with administrator privileges`
}

/** Run a shell command as root, prompting through the system dialog. */
export function runElevated(shellCommand: string): ExecResult {
  return execFile('osascript', ['-e', buildElevatedScript(shellCommand)], { timeout: 180_000 })
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
  // Staged before the command runs, and only when there is one to stage.
  if (entry.authKey)
    fs.writeFileSync(authKeyFile(), entry.authKey, { mode: 0o600 })

  const result = runElevated(buildConnectCommand(cli, entry))
  if (!result.ok)
    return formatOsaError(result.stderr || result.stdout)

  /*
   * Elevation succeeding only means the command was launched. The command
   * backgrounds the tunnel and returns immediately, so a tunnel that dies on
   * its first line — a bad key, a coordinator that refuses, a shell that
   * could not detach — looked identical to one that came up, and the window
   * reported success while nothing had happened.
   *
   * So the pid is checked after a moment, and the log is what the user is
   * told. Short enough not to be felt, long enough for an immediate failure
   * to have already happened.
   */
  Bun.sleepSync(1500)
  if (connectionPid() === null)
    return { success: false, error: tunnelFailure() }

  return { success: true }
}

/** The most useful line the dead tunnel left behind, for the window to show. */
function tunnelFailure(): string {
  let log = ''
  try {
    log = fs.readFileSync(logFile(), 'utf8')
  }
  catch {
    // No log at all: the shell never got far enough to redirect into it.
  }

  const lines = log.split('\n').map(line => line.trim()).filter(Boolean)
  // Last first: a stack trace ends with the thing that actually went wrong.
  const blamed = [...lines].reverse().find(line => /error|fail|refus|denied|unable|cannot|can't/i.test(line))
  const detail = blamed ?? lines[lines.length - 1]
  return detail
    ? `The tunnel stopped right after starting: ${detail}`
    : 'The tunnel stopped right after starting, without saying why'
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
  const result = runElevated(`${teardown}kill ${pid}`)
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

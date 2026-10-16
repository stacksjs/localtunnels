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
import process from 'node:process'
import type { ExecResult } from '../support/shell'
import { buildElevatedScript, runElevated } from '../support/elevate'
import { exec, shellEscape } from '../support/shell'
import { HELPER_CLI, helperDown, helperLogPath, helperReady, helperUp, installHelper } from './helper'
import type { Settings } from '../settings'
import { dnsServers } from '../dns'
import { regionById } from '../regions'
import { readSettings } from '../settings'

export { buildElevatedScript, runElevated }
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
export interface ConnectOptions {
  /** Resolver addresses, comma separated, as `--dns` wants them. */
  dns: string
  allowLan: boolean
}

export function buildConnectCommand(cli: string, entry: ServerEntry, options: ConnectOptions): string {
  const args = ['vpn:up', '--coordinator', entry.coordinatorUrl]
  args.push('--dns', options.dns)
  if (options.allowLan)
    args.push('--allow-lan')
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
  if (ourCliPaths(cliPath).some(path => commandLine.includes(path)))
    return true
  // The name heuristic is the answer only when we could not find our own CLI
  // to compare against. With a known bundle path, anything running from
  // somewhere else is deliberately not ours.
  if (cliPath)
    return false
  return /(?:^|[\s/])(?:localtunnels|lt)(?:\s|$)/.test(commandLine)
}

/**
 * Every path a tunnel of ours can be running from.
 *
 * There are two, and for a while this knew about one. The helper runs the
 * root-owned copy of the CLI, not the one in the bundle, so a tunnel it
 * started matched nothing: the window reported `managedPid: null` over a
 * working VPN and settled back to "Not connected", and disconnect decided
 * there was nothing of ours to stop while the traffic kept flowing. Both
 * halves of that are worse than an error.
 *
 * A tunnel started from a terminal still runs neither of these and is still
 * none of our business.
 */
export function ourCliPaths(cliPath?: string | null): string[] {
  return [cliPath, HELPER_CLI].filter((path): path is string => typeof path === 'string' && path.length > 0)
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

/** Every running process whose command line is one of our tunnels. */
export function findTunnelPids(): number[] {
  const cli = findCli()
  const ps = exec('ps -axo pid=,command=', { timeout: 5000 })
  if (!ps.ok)
    return []

  const pids: number[] = []
  for (const line of ps.stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/)
    if (!match)
      continue
    const pid = Number.parseInt(match[1], 10)
    // Never ourselves: this process's own argv mentions the CLI path whenever
    // the app is the one that spawned it.
    if (pid === process.pid)
      continue
    if (looksLikeTunnel(match[2], cli))
      pids.push(pid)
  }
  return pids
}

/**
 * The pid of the tunnel this app started, or null.
 *
 * The recorded pid is a hint, not the record. It is checked first because it
 * is cheap and exact, but it can be missing or stale while the tunnel it
 * named is still running — and a tunnel the app cannot see is a tunnel the
 * app cannot stop, which left a root process holding the network with no way
 * to shut it down from the window that started it.
 *
 * So the fallback is the process table. Matching on the bundled CLI's own
 * path keeps the original rule intact: a tunnel started from a terminal runs
 * a different binary and is still none of our business.
 */
export function connectionPid(): number | null {
  let recorded: number | null = null
  try {
    const parsed = Number.parseInt(fs.readFileSync(pidFile(), 'utf8').trim(), 10)
    if (Number.isInteger(parsed) && parsed > 0)
      recorded = parsed
  }
  catch {
    // No pid file. The scan below is the whole answer.
  }

  if (recorded !== null) {
    const ps = exec(`ps -o command= -p ${recorded}`, { timeout: 5000 })
    if (ps.ok && looksLikeTunnel(ps.stdout.trim(), findCli()))
      return recorded
  }

  // Lowest pid: if somehow more than one is running, the oldest is the one
  // the window has been reporting, and the rest are cleaned up with it.
  const found = findTunnelPids()
  return found.length > 0 ? Math.min(...found) : null
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
/**
 * Start through the helper, recording the pid it reports.
 *
 * The helper runs as root and the pid file lives in the user's directory, so
 * the helper cannot write it — it prints the pid instead and this records it.
 * `connectionPid` would find the process anyway by scanning, but the file is
 * what makes the common case a single `ps` rather than a full table read.
 */
function helperStart(regionId: string, settings: Settings): ExecResult {
  const started = helperUp(regionId, { dns: settings.dns, allowLan: settings.allowLan })
  if (!started.success)
    return { ok: false, stdout: '', stderr: started.error ?? '', code: 1 }
  if (started.pid !== undefined) {
    try {
      fs.writeFileSync(pidFile(), `${started.pid}\n`, { mode: 0o600 })
    }
    catch {
      // Advisory: the process-table scan is the authority.
    }
  }
  return { ok: true, stdout: '', stderr: '', code: 0 }
}

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

  /*
   * The helper is what makes this ask for a password once rather than every
   * time. Installing it needs one prompt; after that `sudo -n` runs without
   * one, and a redeploy that changes servers.json costs one more.
   *
   * Failure to install is not failure to connect. A machine whose admin has
   * locked down /etc/sudoers.d, or a user who dismisses the dialog, should
   * still get a VPN — just with the prompt they were already getting.
   */
  if (!helperReady())
    installHelper()

  const settings = readSettings()
  const options: ConnectOptions = { dns: dnsServers(settings.dns), allowLan: settings.allowLan }

  const result = helperReady()
    ? helperStart(regionId, settings)
    : runElevated(buildConnectCommand(cli, entry, options))
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

/**
 * The tunnel's log, wherever it ended up.
 *
 * Both paths, newest content wins. The helper runs as root and writes to
 * /var/log, while the fallback path writes into the user's own directory —
 * reading only the second meant a helper-started tunnel could fail with a
 * perfectly clear message on disk and the window would say nothing at all,
 * which is what "waiting for authorization, then nothing happens" was.
 */
function tunnelLog(): string {
  let log = ''
  for (const candidate of [helperLogPath(), logFile()]) {
    try {
      const contents = fs.readFileSync(candidate, 'utf8')
      if (contents.trim())
        log = contents
    }
    catch {
      // Missing or unreadable; the other one may still have the answer.
    }
  }
  return log
}

/** What the log says about the coordinator, for the run that is up now. */
export interface CoordinatorHealth {
  /** False once the tunnel has reported the coordinator silent. */
  reachable: boolean
  /** The warning as the tunnel wrote it, for the window to show. */
  detail: string | null
}

/** Where one run's output begins. Printed once, when the interface comes up. */
const RUN_START = /^\s*Interface:\s/
const WENT_QUIET = /^!\s*coordinator silent/i
const ANSWERING = /^\u2713\s*coordinator answering again/i

/**
 * Whether this tunnel is still being heard by its coordinator.
 *
 * The gap this closes: `connected` is true whenever a utun with our range
 * exists, and it stays true through the whole one-way-tunnel failure — the
 * interface is up, the handshakes succeed, and the route home has been
 * withdrawn. The window said Connected for the entire thing. The tunnel
 * itself now notices and writes a warning; this is the window reading it.
 *
 * Only the current run is considered. The log accumulates across connects,
 * and a warning from a previous one reported against a healthy tunnel would
 * be worse than saying nothing — it is the same mistake as tailing a log
 * that still held a failed run's output.
 */
export function readCoordinatorHealth(log: string): CoordinatorHealth {
  const lines = log.split('\n').map(line => line.trim())

  let start = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    if (RUN_START.test(lines[i])) {
      start = i
      break
    }
  }

  // Backwards from the end: whichever came last is the current state.
  for (let i = lines.length - 1; i >= start; i--) {
    if (ANSWERING.test(lines[i]))
      return { reachable: true, detail: null }
    if (WENT_QUIET.test(lines[i]))
      return { reachable: false, detail: lines[i].replace(/^!\s*/, '') }
  }
  return { reachable: true, detail: null }
}

/** {@link readCoordinatorHealth} against whichever log this tunnel wrote. */
export function coordinatorHealth(): CoordinatorHealth {
  return readCoordinatorHealth(tunnelLog())
}

/** The most useful line the dead tunnel left behind, for the window to show. */
function tunnelFailure(): string {
  const lines = tunnelLog().split('\n').map(line => line.trim()).filter(Boolean)
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
  // Every tunnel of ours, not only the recorded one: a pid file lost while
  // the process it named kept running is exactly how one got orphaned, and
  // stopping all of them is what the button claims to do.
  const pids = [...new Set([pid, ...findTunnelPids()])].join(' ')

  /*
   * SIGTERM, then SIGKILL for whatever is left.
   *
   * The tunnel asks for SIGTERM so it can put the routes, DNS and firewall
   * back on the way out, and that is the path worth taking. But a process
   * that does not take it is the one case this button absolutely has to
   * handle: it is running as root, holding the default route, and the only
   * other way to stop it is a terminal. `vpn:down` has already run by then,
   * so the machine is restored either way — what SIGKILL loses is the
   * tunnel's own tidy exit, not the network.
   */
  // Through the helper when it is installed, so stopping costs no prompt
  // either — a kill switch you need a password to lift is a kill switch
  // people learn to leave off.
  const result = helperReady()
    ? helperDown()
    : runElevated(
        `${teardown}kill ${pids} 2>/dev/null; sleep 2; kill -0 ${pids} 2>/dev/null && kill -9 ${pids} 2>/dev/null; exit 0`,
      )
  if ('ok' in result ? !result.ok : !result.success)
    return formatOsaError(('stderr' in result ? result.stderr : result.error) || '')

  try {
    fs.rmSync(pidFile(), { force: true })
  }
  catch {
    // As above.
  }
  return { success: true }
}

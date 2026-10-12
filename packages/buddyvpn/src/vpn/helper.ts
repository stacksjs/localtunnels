/**
 * The root-owned helper, so connecting asks for a password once instead of
 * every time.
 *
 * ExpressVPN and every other commercial client do this with a privileged
 * helper installed through `SMAppService`, which verifies the *calling app's
 * code signature* before obeying it. That check is the entire security story,
 * and it needs a Developer ID to have a signature worth checking. This build
 * is sealed ad hoc, so that door is closed to us.
 *
 * What is left is to bound the damage instead of verifying the caller. The
 * helper is a wrapper that takes one argument — a region id — and reads the
 * coordinator URL, auth key and exit key from its own root-owned copy of
 * `servers.json`. A caller cannot pass a coordinator, a key, a flag or a
 * path, so the worst a local process can do is turn a VPN the user already
 * configured on or off. That is not nothing, and it is deliberately written
 * down here rather than discovered later:
 *
 *   Trade: anything running as this user can toggle the VPN without a
 *   password. It cannot obtain root, choose where the traffic goes, read the
 *   auth key, or alter what runs — the binary and its config live outside the
 *   home directory, owned by root.
 *
 * When there is a Developer ID, this becomes a real `SMAppService` helper
 * that checks the caller and the trade goes away.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runElevated } from '../support/elevate'
import { exec, shellEscape } from '../support/shell'
import { REGIONS } from '../regions'
import { findCli } from './core'
import { serversPath } from './control'

/** Root-owned, outside the home directory: the point is that we cannot edit it. */
export const HELPER_DIR: string = '/usr/local/libexec/buddyvpn'
export const HELPER_PATH: string = `${HELPER_DIR}/buddyvpn-helper`
export const HELPER_CLI: string = `${HELPER_DIR}/localtunnels`
export const HELPER_SERVERS: string = `${HELPER_DIR}/servers.json`
export const SUDOERS_PATH: string = '/etc/sudoers.d/buddyvpn'

/** Bumped when the wrapper's contents change, so an old one is replaced. */
export const HELPER_VERSION = '1'

/**
 * The wrapper, as text.
 *
 * Every value that reaches the CLI comes from the root-owned servers.json;
 * the caller supplies only which region to read. The region is matched
 * against the compiled-in list rather than a pattern, so even a traversal
 * attempt has nothing to match.
 */
export function helperScript(): string {
  const regions = REGIONS.map(region => region.id).join('|')
  return `#!/bin/sh
# BuddyVPN privileged helper, version ${HELPER_VERSION}.
# Installed by BuddyVPN. Remove with: buddyvpn-helper uninstall
#
# Takes a region name and nothing else. The coordinator, auth key and exit
# key come from ${HELPER_SERVERS}, which is root-owned and 0600 — a caller
# cannot point this at a server of its own choosing.
set -eu

CLI=${HELPER_CLI}
SERVERS=${HELPER_SERVERS}
LOG=/var/log/buddyvpn.log

case "\${1:-}" in
  version)
    # Version plus a digest of the config this helper actually holds. The app
    # compares both: a redeploy rewrites the user's servers.json, and a helper
    # still pointing at the old coordinator would connect somewhere the window
    # is no longer offering.
    echo "${HELPER_VERSION} $(shasum -a 256 "$SERVERS" 2>/dev/null | cut -d' ' -f1)"
    ;;
  up)
    region="\${2:-}"
    case "$region" in
      ${regions}) ;;
      *) echo "unknown region" >&2; exit 2 ;;
    esac
    # The key is read by the shell from a root-only file, never passed in
    # argv, because \`ps\` shows argv to every user on the machine.
    coordinator=$("$CLI" vpn:config --servers "$SERVERS" --region "$region" --field coordinatorUrl)
    exit_key=$("$CLI" vpn:config --servers "$SERVERS" --region "$region" --field useExit)
    LOCALTUNNELS_AUTH_KEY=$("$CLI" vpn:config --servers "$SERVERS" --region "$region" --field authKey) \\
      "$CLI" vpn:up --coordinator "$coordinator" --use-exit "$exit_key" \\
        --full-tunnel --kill-switch < /dev/null >> "$LOG" 2>&1 &
    echo $!
    ;;
  down)
    "$CLI" vpn:down >> "$LOG" 2>&1 || true
    pkill -f "$CLI vpn:up" 2>/dev/null || true
    sleep 2
    pkill -9 -f "$CLI vpn:up" 2>/dev/null || true
    exit 0
    ;;
  uninstall)
    rm -f ${SUDOERS_PATH}
    rm -rf ${HELPER_DIR}
    exit 0
    ;;
  *)
    echo "usage: buddyvpn-helper up <region> | down | version | uninstall" >&2
    exit 64
    ;;
esac
`
}

/**
 * The sudoers rule.
 *
 * Scoped to the wrapper alone — not to the CLI, which takes a coordinator URL
 * and would let a local caller route this machine's traffic through a server
 * of its own. `NOPASSWD` on a program is only ever as narrow as that
 * program's own vocabulary, which is why the vocabulary is three words.
 */
export function sudoersRule(user: string): string {
  return `# Installed by BuddyVPN. Lets ${user} start and stop the VPN without a password.\n`
    + `# Scoped to the helper, whose arguments are a region name from a root-owned file.\n`
    + `${user} ALL=(root) NOPASSWD: ${HELPER_PATH}\n`
}

/** The digest the helper reports for its own copy of servers.json. */
function serversDigest(): string | null {
  const probe = exec(`shasum -a 256 ${shellEscape(serversPath())} | cut -d' ' -f1`, { timeout: 5000 })
  return probe.ok ? probe.stdout.trim() : null
}

/**
 * Whether the helper is installed, current, and holding the same servers.
 *
 * All three matter. An old wrapper may not speak the vocabulary this build
 * expects, and a wrapper carrying a stale servers.json would quietly connect
 * to a coordinator the window has stopped offering — a redeploy changes that
 * file, and the helper's copy is root-owned so nothing else can refresh it.
 */
export function helperReady(): boolean {
  if (!fs.existsSync(HELPER_PATH) || !fs.existsSync(SUDOERS_PATH))
    return false
  // `-n` fails rather than prompting, which is exactly the question being
  // asked: can this run without a password?
  const probe = exec(`sudo -n ${shellEscape(HELPER_PATH)} version`, { timeout: 5000 })
  if (!probe.ok)
    return false

  const [version, digest] = probe.stdout.trim().split(/\s+/)
  if (version !== HELPER_VERSION)
    return false

  const ours = serversDigest()
  return ours !== null && digest === ours
}

/** Start the tunnel through the helper. Returns the tunnel's pid. */
export function helperUp(regionId: string): { success: boolean, pid?: number, error?: string } {
  const result = exec(`sudo -n ${shellEscape(HELPER_PATH)} up ${shellEscape(regionId)}`, { timeout: 60_000 })
  if (!result.ok)
    return { success: false, error: result.stderr.trim() || 'the helper refused to start the tunnel' }
  const pid = Number.parseInt(result.stdout.trim(), 10)
  return { success: true, pid: Number.isInteger(pid) && pid > 0 ? pid : undefined }
}

/** Stop the tunnel through the helper. */
export function helperDown(): { success: boolean, error?: string } {
  const result = exec(`sudo -n ${shellEscape(HELPER_PATH)} down`, { timeout: 60_000 })
  return result.ok ? { success: true } : { success: false, error: result.stderr.trim() }
}

/**
 * The one privileged command, run behind a single password prompt.
 *
 * `visudo -c` validates the rule before it is moved into place. A syntax
 * error in /etc/sudoers.d is not a failed install — it can break `sudo` for
 * the whole machine, which is a far worse outcome than a VPN that still asks
 * for a password.
 */
export function buildInstallCommand(user: string, appCli: string): string {
  const script = `${HELPER_DIR}/.helper.tmp`
  const rule = `${HELPER_DIR}/.sudoers.tmp`
  return [
    `set -e`,
    `mkdir -p ${HELPER_DIR}`,
    `chown root:wheel ${HELPER_DIR}`,
    `chmod 755 ${HELPER_DIR}`,
    // A root-owned copy: the bundle sits in the user's home, where anything
    // running as the user could replace it, and a NOPASSWD rule pointing at
    // a writable binary is a password-free path to root.
    `cp -f ${shellEscape(appCli)} ${HELPER_CLI}`,
    `chown root:wheel ${HELPER_CLI}`,
    `chmod 755 ${HELPER_CLI}`,
    `cp -f ${shellEscape(serversPath())} ${HELPER_SERVERS}`,
    `chown root:wheel ${HELPER_SERVERS}`,
    `chmod 600 ${HELPER_SERVERS}`,
    `printf %s ${shellEscape(helperScript())} > ${script}`,
    `chown root:wheel ${script}`,
    `chmod 755 ${script}`,
    `mv -f ${script} ${HELPER_PATH}`,
    `printf %s ${shellEscape(sudoersRule(user))} > ${rule}`,
    `chmod 440 ${rule}`,
    `chown root:wheel ${rule}`,
    `visudo -c -f ${rule}`,
    `mv -f ${rule} ${SUDOERS_PATH}`,
  ].join('; ')
}

export function installHelper(): { success: boolean, error?: string } {
  const cli = findCli()
  if (!cli)
    return { success: false, error: 'The localtunnels CLI is missing from this app' }
  if (!fs.existsSync(serversPath()))
    return { success: false, error: 'No servers are configured yet' }

  const result = runElevated(buildInstallCommand(os.userInfo().username, cli))
  if (!result.ok)
    return { success: false, error: result.stderr.trim() || 'The helper could not be installed' }
  return { success: true }
}

/** Remove the helper and its sudoers rule. One prompt, as with the install. */
export function uninstallHelper(): { success: boolean, error?: string } {
  const result = runElevated(`rm -f ${SUDOERS_PATH}; rm -rf ${HELPER_DIR}; exit 0`)
  return result.ok ? { success: true } : { success: false, error: result.stderr.trim() }
}

/** Where the helper keeps its log, for the window to quote on failure. */
export function helperLogPath(): string {
  return path.join('/var/log', 'buddyvpn.log')
}

/** Unused today; kept so the home-directory path has a single definition. */
export function userServersPath(): string {
  return serversPath()
}

import { describe, expect, it } from 'bun:test'
import { REGIONS } from '../src/regions'
import {
  buildInstallCommand,
  HELPER_CLI,
  HELPER_LIB,
  HELPER_PATH,
  HELPER_SERVERS,
  helperScript,
  nativeLibPath,
  sudoersRule,
  SUDOERS_PATH,
} from '../src/vpn/helper'

/*
 * These are the tests that matter most in this package. The helper trades a
 * password prompt for a standing grant of root, and the only thing keeping
 * that honest is how little the helper is willing to do.
 */
describe('the sudoers grant', () => {
  const rule = sudoersRule('glenn')

  it('is scoped to the helper, never to the CLI', () => {
    expect(rule).toContain(`NOPASSWD: ${HELPER_PATH}`)
    // The CLI takes `--coordinator`, so a NOPASSWD grant on it would let any
    // local process route this machine's traffic through a server of its own.
    expect(rule).not.toContain(HELPER_CLI)
    expect(rule).not.toContain('vpn:up')
    expect(rule).not.toContain('ALL=(ALL)')
  })

  it('names one user, not a group or everyone', () => {
    expect(rule).toContain('glenn ALL=(root)')
    expect(rule).not.toContain('%')
  })
})

describe('the helper wrapper', () => {
  const script = helperScript()

  it('accepts only regions the app compiled in, and rejects the rest', () => {
    // A literal list, not a pattern: a pattern admits anything shaped like a
    // region, while the list admits the regions themselves and nothing else.
    expect(script).toContain(`      ${REGIONS.map(r => r.id).join('|')}) ;;`)
    expect(script).not.toContain('[a-z]')
    // And the arm every other value falls into refuses rather than passing
    // the value through.
    expect(script).toContain('*) echo "unknown region" >&2; exit 2 ;;')
  })

  it('never lets a caller choose the coordinator, key or exit', () => {
    // Every one of them is read from the root-owned file, by field name.
    for (const field of ['coordinatorUrl', 'authKey', 'useExit'])
      expect(script).toContain(`--field ${field}`)
    expect(script).toContain(HELPER_SERVERS)
  })

  it('keeps the auth key out of argv', () => {
    // As an environment assignment on the command, not an `--auth-key` flag:
    // `ps` shows argv to every user on the machine.
    expect(script).toContain('LOCALTUNNELS_AUTH_KEY=$(')
    expect(script).not.toContain('--auth-key')
  })

  it('always asks for a full tunnel and a kill switch', () => {
    expect(script).toContain('--full-tunnel --kill-switch')
  })
})

describe('the install', () => {
  const command = buildInstallCommand('glenn', '/Users/glenn/BuddyVPN.app/Contents/MacOS/localtunnels')

  it('validates the sudoers rule before putting it in place', () => {
    // A syntax error under /etc/sudoers.d can break `sudo` for the whole
    // machine, which is far worse than a VPN that still asks for a password.
    expect(command.indexOf('visudo -c -f')).toBeLessThan(command.indexOf(`mv -f`) + command.length)
    expect(command).toContain('visudo -c -f')
    const validate = command.indexOf('visudo -c -f')
    const install = command.indexOf(`mv -f /usr/local/libexec/buddyvpn/.sudoers.tmp ${SUDOERS_PATH}`)
    expect(validate).toBeLessThan(install)
  })

  it('copies the CLI somewhere the user cannot rewrite it', () => {
    // The bundle lives in the home directory. A NOPASSWD rule whose target
    // can be replaced by anything running as the user is a password-free
    // path to root, so the helper runs its own root-owned copy.
    expect(command).toContain(`cp -f '/Users/glenn/BuddyVPN.app/Contents/MacOS/localtunnels' ${HELPER_CLI}`)
    expect(command).toContain(`chown root:wheel ${HELPER_CLI}`)
  })

  it('keeps the copied servers.json readable only by root', () => {
    expect(command).toContain(`chmod 600 ${HELPER_SERVERS}`)
    expect(command).toContain(`chown root:wheel ${HELPER_SERVERS}`)
  })
})

describe('what the install actually copies', () => {
  const cli = '/Users/glenn/BuddyVPN.app/Contents/MacOS/localtunnels'
  const command = buildInstallCommand('glenn', cli)

  /*
   * The CLI resolves its native library relative to its own executable, so a
   * root-owned copy of the binary alone is a binary that cannot open a TUN
   * device. It installed fine and then failed on every connect with "native
   * libltvpn not found" — which, from the window, looked like the authorization
   * prompt leading nowhere.
   */
  it('takes the native library along with the binary', () => {
    expect(nativeLibPath(cli)).toBe('/Users/glenn/BuddyVPN.app/Contents/MacOS/libltvpn.dylib')
    expect(command).toContain(`cp -f '${nativeLibPath(cli)}' ${HELPER_LIB}`)
    expect(command).toContain(`chown root:wheel ${HELPER_LIB}`)
  })

  it('puts the library where the copied CLI will look for it', () => {
    expect(HELPER_LIB).toBe(`${HELPER_CLI.replace(/\/[^/]+$/, '')}/libltvpn.dylib`)
  })
})

/**
 * Where a shared secret is allowed to sit, and where it is not.
 *
 * The coordinator's `authKey` lets a device join a network, and every member
 * holds the same one. `src/pairing.ts` puts it in the Keychain for that
 * reason, and then the tunnel needs it in a *different process* — which is
 * the whole difficulty, because the two channels Craft gives a screen for
 * reaching Swift are both places a secret should not come to rest:
 *
 *   `UserDefaults`            a plist in the app container, included as
 *                             written in an unencrypted device backup.
 *   `providerConfiguration`   carried with the saved VPN profile, outside
 *                             this app's Keychain, readable by anything
 *                             that can read the VPN preferences.
 *
 * Neither is a bug you can see. The tunnel works either way, which is why
 * this is a test and not a code review comment: the only way to notice the
 * secret had a second home was to go looking for it.
 *
 * So these are read as text — the Swift compiles against iOS SDKs and runs
 * in a Network Extension, so none of it executes here. That cannot prove
 * nothing leaks. It does pin the three decisions that stopped it leaking,
 * so putting one back is a failing test rather than a quiet regression.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8')

const CONTROL = read(PACKAGE_DIR, 'native', 'ios', 'TunnelControl.swift')
const PROVIDER = read(PACKAGE_DIR, 'native', 'ios', 'PacketTunnelProvider.swift')
const SECRET = read(PACKAGE_DIR, 'native', 'ios', 'PairingSecretStore.swift')
const IDENTITY_STORE = read(PACKAGE_DIR, 'native', 'ios', 'DeviceIdentityStore.swift')
const EMITTER = read(PACKAGE_DIR, 'scripts', 'ios-tunnel-extension.ts')

/** The access group an item has to be in for both processes to read it. */
const SHARED_GROUP = '$(AppIdentifierPrefix)org.localtunnels.buddyvpn.shared'

describe('the VPN profile', () => {
  /*
   * The regression. `providerConfiguration` is saved with the profile and
   * read back from the VPN preferences, so a secret in it is a secret
   * outside the Keychain that was chosen for it.
   */
  it('does not carry the join secret', () => {
    expect(CONTROL).not.toContain('providerConfiguration?["authKey"]')
    const dictionary = /proto\.providerConfiguration = \[([\s\S]*?)\n {12}\]/.exec(CONTROL)
    expect(dictionary).not.toBeNull()
    expect(dictionary![1]).not.toContain('authKey')
  })

  // What it does carry, all of which is readable without harm.
  it('carries only what is not secret', () => {
    const dictionary = /proto\.providerConfiguration = \[([\s\S]*?)\n {12}\]/.exec(CONTROL)!
    for (const key of ['region', 'exitIp', 'dns', 'allowLan'])
      expect(dictionary[1]).toContain(`"${key}"`)
  })

  /*
   * And the provider reads the secret from the Keychain rather than from the
   * dictionary it is handed, or the two would disagree about where it lives
   * and the dictionary would win.
   */
  it('is not where the provider looks for the secret', () => {
    expect(PROVIDER).toContain('authKey: PairingSecretStore.load()')
    expect(PROVIDER).not.toContain('configuration?["authKey"]')
  })
})

describe('the request channel', () => {
  /*
   * `UserDefaults` is the only way a screen reaches Swift, so a connect
   * request passes through it carrying the secret. It must not *stay* there:
   * the last request used to sit in the container's plist until the next one
   * replaced it.
   */
  it('is emptied as soon as a request has been read', () => {
    expect(CONTROL).toContain('UserDefaults.standard.removeObject(forKey: requestKey)')
  })

  /*
   * And emptied before the request is acted on, not after. A `connect` that
   * returns early — no region, a Keychain that refused — would otherwise
   * leave the secret behind on exactly the paths that are not the happy one.
   */
  it('is emptied before the request is acted on', () => {
    const cleared = CONTROL.indexOf('UserDefaults.standard.removeObject(forKey: requestKey)')
    const acted = CONTROL.indexOf('switch request["action"] as? String {')
    expect(cleared).toBeGreaterThan(0)
    expect(acted).toBeGreaterThan(cleared)
  })
})

describe('the Keychain item', () => {
  it('is in the group both processes share', () => {
    expect(SECRET).toContain(SHARED_GROUP)
    expect(EMITTER).toContain(SHARED_GROUP)
  })

  /*
   * The same accessibility as the device key, and it has to be the same: the
   * system starts a packet tunnel with the phone in a pocket, and two items
   * readable at different times is a tunnel that has half of what it needs.
   */
  it('is readable when the device key is', () => {
    expect(SECRET).toContain('kSecAttrAccessibleAfterFirstUnlock')
    expect(IDENTITY_STORE).toContain('kSecAttrAccessibleAfterFirstUnlock')
    for (const source of [SECRET, IDENTITY_STORE])
      expect(source).not.toContain('kSecAttrAccessibleWhenUnlocked')
  })

  /*
   * A separate item from the device key, because they have different
   * lifetimes: a device's key survives unpairing — it is what the device
   * *is* — and the secret is what it was *told*, which unpairing is
   * precisely the act of no longer holding.
   */
  it('is not the same item as the device key', () => {
    const service = (source: string): string =>
      /private static let service = "(.*?)"/.exec(source)![1]
    expect(service(SECRET)).not.toBe(service(IDENTITY_STORE))
  })

  /*
   * Re-pairing has to win. `SecItemAdd` alone returns `errSecDuplicateItem`
   * and leaves the old value, which reads as a pairing that was accepted and
   * did nothing — so a rotated key would never reach the tunnel.
   */
  it('is replaced on a second pairing, not kept', () => {
    expect(SECRET).toContain('errSecDuplicateItem')
    expect(SECRET).toContain('SecItemUpdate(')
  })

  // Both halves of a pairing have to go, and the screens can only reach one.
  it('is forgotten when the device is unpaired', () => {
    expect(CONTROL).toMatch(/case "forget-pairing":[\s\S]{0,600}?PairingSecretStore\.forget\(\)/)
    expect(read(PACKAGE_DIR, 'screens', 'settings.stx')).toContain('tunnel.forgetPairing()')
  })
})

describe('the new file', () => {
  /*
   * Both processes write and read this, so both targets have to compile it.
   * The emitter's own check catches a file in neither list; nothing would
   * catch one in only the extension's, which is a store the app cannot use.
   */
  it('is compiled into both targets', () => {
    for (const list of ['BRIDGE_SOURCES', 'TUNNEL_SOURCES']) {
      const sources = new RegExp(`const ${list} = \\[(.*?)\\]`).exec(EMITTER)
      expect(sources).not.toBeNull()
      expect(sources![1]).toContain('PairingSecretStore.swift')
    }
  })

  // No crypto, so it costs the app nothing: linking libltvpn into the app to
  // read a Keychain item is the price `DeviceIdentity` is split to avoid.
  it('needs no crypto core, as the app target has none', () => {
    expect(SECRET).not.toContain('ltvpn_')
  })
})

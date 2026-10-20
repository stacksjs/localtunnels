/**
 * This device's key, and the one check that makes a mismatch impossible.
 *
 * A node *is* its public key: the coordinator assigns an address against it,
 * the exit authorises that key, and the handshake proves possession of the
 * private half. The two halves are stored together in one Keychain item so
 * a pair cannot half-survive a restore — which stops an item from being the
 * wrong length, and does nothing about one that is the right length and
 * holds two keys that do not belong together.
 *
 * That failure is the worst kind to read. Registration succeeds, the
 * directory looks right, and the exit refuses "an unauthorized peer" whose
 * key is sitting in its own directory. Nothing on either end names the
 * cause, because from each end separately nothing is wrong.
 *
 * The desktop never has the problem: it stores a private key and derives the
 * public one with `publicKeyFromPrivate` whenever it needs it. The phone
 * stores both, so it has to check — and the check has to live in the file
 * only the extension compiles, because the app does not link the crypto core.
 * That constraint is the reason `DeviceIdentity` and `DeviceIdentityStore`
 * are separate files at all, so it is worth a test of its own.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8')

const IDENTITY = read(PACKAGE_DIR, 'native', 'ios', 'DeviceIdentity.swift')
const STORE = read(PACKAGE_DIR, 'native', 'ios', 'DeviceIdentityStore.swift')
const KEYS = read(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'keys.ts')
const HEADER = read(PACKAGE_DIR, '..', 'vpn-core', 'include', 'ltvpn.h')
const EMITTER = read(PACKAGE_DIR, 'scripts', 'ios-tunnel-extension.ts')

describe('generating a key', () => {
  it('is the core’s business on both platforms, not the platform’s', () => {
    expect(KEYS).toContain('lib.ltvpn_keypair(priv, pub)')
    expect(IDENTITY).toContain('ltvpn_keypair(&priv, &pub)')
  })

  /*
   * base64 of 32 raw bytes, which is what the coordinator keys its directory
   * on. A phone that encoded them differently would register a key no peer
   * could match and be refused by every exit in the network.
   */
  it('is named to the coordinator the same way', () => {
    expect(KEYS).toContain("Buffer.from(key).toString('base64')")
    expect(IDENTITY).toContain('publicKey.base64EncodedString()')
    expect(STORE).toContain('static let keyLength = 32')
    expect(HEADER).toContain('LTVPN_KEY_LEN')
  })
})

describe('reading a stored key', () => {
  /*
   * The regression. Believing the stored public half is the difference
   * between a device that cannot connect and a device that cannot connect
   * *for a reason anybody can find*.
   */
  it('derives the public half rather than believing it', () => {
    expect(HEADER).toContain('int32_t ltvpn_pubkey(')
    expect(IDENTITY).toContain('ltvpn_pubkey(priv.bindMemory(to: UInt8.self).baseAddress, &derived)')
    expect(IDENTITY).toMatch(/if try derives\(publicKey: stored\.publicKey, from: stored\.privateKey\) \{/)
  })

  /*
   * And the check has to gate the return, not merely happen near it: a
   * verification whose result is logged and then ignored is the same bug
   * with more code.
   */
  it('returns the stored pair only when it checks out', () => {
    const body = /static func loadOrCreate\(\) throws -> DeviceIdentity \{([\s\S]*?)\n {4}\}/.exec(IDENTITY)
    expect(body).not.toBeNull()
    const returns = body![1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    // The only `return DeviceIdentity(privateKey: stored...` is inside the
    // `derives` branch, so a mismatched pair cannot reach a return.
    expect(returns).toMatch(/derives\([\s\S]{0,120}?\{\s*return DeviceIdentity\(privateKey: stored\.privateKey/)
  })

  it('discards a pair that does not match', () => {
    expect(IDENTITY).toMatch(/do not match[\s\S]{0,200}?DeviceIdentityStore\.forget\(\)/)
  })

  /*
   * A core that cannot derive at all is not a verdict on the stored pair.
   * Treating that as a mismatch would throw away a working identity —
   * a fresh address and a new directory record — because a library failed to
   * load.
   */
  it('does not blame the key when the core is the problem', () => {
    expect(IDENTITY).toMatch(/guard result == 0 else \{[\s\S]{0,300}?throw DeviceIdentityFailure\.generationFailed/)
  })
})

describe('where the check lives', () => {
  /*
   * `DeviceIdentityStore` is compiled into the app as well as the extension,
   * and the app does not link libltvpn — linking it so the app could ask the
   * Keychain a question is the cost the split exists to avoid. A derivation
   * in the store would not fail a test here; it would fail the app target's
   * link, which is a worse place to find out.
   */
  it('is the extension’s file, because the app has no crypto core', () => {
    expect(STORE).not.toContain('ltvpn_')
    expect(IDENTITY).toContain('ltvpn_pubkey')
  })

  /*
   * And the split is only real if the emitter keeps it: the app target is
   * given the store and not the generator, so a `ltvpn_` call that drifted
   * into the store would fail the app's link. Checked against the lists that
   * decide it rather than against the comment that describes it.
   */
  it('is a split the build enforces, not just a convention', () => {
    const bridge = /const BRIDGE_SOURCES = \[(.*?)\]/.exec(EMITTER)
    const tunnel = /const TUNNEL_SOURCES = \[(.*?)\]/.exec(EMITTER)
    expect(bridge).not.toBeNull()
    expect(tunnel).not.toBeNull()
    // The app gets the Keychain, never the generator.
    expect(bridge![1]).toContain('DeviceIdentityStore.swift')
    expect(bridge![1]).not.toContain('DeviceIdentity.swift\'')
    // The extension gets both, and is the only target that links the core.
    expect(tunnel![1]).toContain('DeviceIdentity.swift')
    expect(tunnel![1]).toContain('DeviceIdentityStore.swift')
  })
})

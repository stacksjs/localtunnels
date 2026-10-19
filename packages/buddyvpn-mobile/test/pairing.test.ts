/**
 * The link that hands a network to a phone, written by one package and read
 * by another.
 *
 * The desktop builds it from `servers.json`; this app parses it. Two
 * implementations of one format again, with the same failure mode as the
 * coordinator protocol: a field renamed on one side is not an error, it is a
 * code that is scanned, declined, and gives nobody a reason. So the desktop's
 * builder is imported here and its output is fed to this app's parser — the
 * only check that actually joins the two.
 */
import { describe, expect, it } from 'bun:test'
import { pairingUrl as desktopPairingUrl } from '../../buddyvpn/src/pairing'
import {
  forgetPairing,
  isPairing,
  PAIR_VERSION,
  pairingUrl,
  parsePairingUrl,
  readPairing,
  savePairing,
} from '../src/pairing'

const REAL = {
  coordinatorUrl: 'wss://vpn.example.com:51821',
  authKey: 'a-shared-secret-token',
  region: 'us-west',
}

/** A Keychain that remembers, as Craft's secureStorage does. */
function withKeychain(initial: Record<string, string> = {}): Record<string, string> {
  const store = { ...initial }
  ;(globalThis as any).window = {
    craft: {
      secureStorage: {
        get: async (key: string) => store[key] ?? null,
        set: async (key: string, value: string) => { store[key] = value },
        remove: async (key: string) => { delete store[key] },
      },
    },
  }
  return store
}

describe('the link the desktop builds', () => {
  /*
   * The join. Everything else here tests one side; this is the only test
   * that would fail if the two drifted apart.
   */
  it('is a link this app reads back unchanged', () => {
    const built = desktopPairingUrl('us-west', {
      coordinatorUrl: REAL.coordinatorUrl,
      authKey: REAL.authKey,
    })
    expect(built).not.toBeNull()
    expect(parsePairingUrl(built)).toEqual(REAL)
  })

  it('carries a coordinator that needs no secret', () => {
    const built = desktopPairingUrl('eu-central', { coordinatorUrl: 'ws://10.0.0.5:51821' })
    expect(parsePairingUrl(built)).toEqual({
      coordinatorUrl: 'ws://10.0.0.5:51821',
      authKey: null,
      region: 'eu-central',
    })
  })

  /*
   * A region with nothing deployed has no coordinator, and a code that
   * cannot be acted on is worse than no code: scanned, accepted, and failing
   * at the first connection with nothing to point at.
   */
  it('is not built for a region with no server', () => {
    expect(desktopPairingUrl('us-west', undefined)).toBeNull()
  })

  it('agrees with this app about the format version', () => {
    expect(desktopPairingUrl('us-west', { coordinatorUrl: 'ws://a:1' })).toContain(`v=${PAIR_VERSION}`)
  })
})

describe('reading a link', () => {
  it('round-trips what this app builds', () => {
    expect(parsePairingUrl(pairingUrl(REAL))).toEqual(REAL)
  })

  it('refuses anything that is not a pairing link', () => {
    for (const raw of ['', 'not a url', 'https://example.com', 'buddyvpn://connect/us-west', null, undefined])
      expect(parsePairingUrl(raw)).toBeNull()
  })

  /*
   * An unknown version means fields this build has never heard of. Saying
   * "update the app" beats acting on half a format.
   */
  it('refuses a version it does not know', () => {
    const link = pairingUrl(REAL)!.replace('v=1', 'v=2')
    expect(parsePairingUrl(link)).toBeNull()
  })

  /*
   * This arrives from outside the app — anyone can put a buddyvpn:// link in
   * front of somebody — and the values reach a VPN configuration. A
   * coordinator URL is a scheme, a host and an optional port, and nothing
   * else: no path, no query, no credentials.
   */
  it.each([
    'wss://vpn.example.com/../admin',
    'wss://user:pass@vpn.example.com',
    'http://vpn.example.com',
    'file:///etc/passwd',
    'wss://vpn.example.com:51821?x=1',
  ])('refuses %s as a coordinator', (coordinatorUrl) => {
    expect(parsePairingUrl(pairingUrl({ ...REAL, coordinatorUrl }) ?? `buddyvpn://pair?v=1&c=${encodeURIComponent(coordinatorUrl)}&r=us-west`)).toBeNull()
  })

  it('refuses a secret that is not one', () => {
    for (const authKey of ['short', 'has spaces in it', '../../etc/passwd'])
      expect(isPairing({ ...REAL, authKey })).toBe(false)
  })

  it('refuses a region that is not one', () => {
    for (const region of ['../us-west', 'US WEST', ''])
      expect(isPairing({ ...REAL, region })).toBe(false)
  })
})

describe('keeping a pairing', () => {
  /*
   * The Keychain, not UserDefaults. This holds a secret shared by every
   * member of a network, and `storage` is a plist in the container.
   */
  it('is kept where the secret belongs', async () => {
    const keychain = withKeychain()
    expect(await savePairing(REAL)).toBe(true)
    expect(Object.keys(keychain)).toEqual(['vpn.pairing'])
    expect(await readPairing()).toEqual(REAL)
  })

  it('is nothing at all before a device has been paired', async () => {
    withKeychain()
    expect(await readPairing()).toBeNull()
  })

  // Validated on the way out as well as in: this survives app updates, and a
  // format that changed underneath must not be acted on.
  it('refuses to read back something that is no longer a pairing', async () => {
    withKeychain({ 'vpn.pairing': JSON.stringify({ coordinatorUrl: 'nonsense' }) })
    expect(await readPairing()).toBeNull()
  })

  it('refuses to store something that is not a pairing', async () => {
    const keychain = withKeychain()
    expect(await savePairing({ ...REAL, coordinatorUrl: 'http://nope' })).toBe(false)
    expect(Object.keys(keychain)).toEqual([])
  })

  /*
   * What signing out means for a device: with no coordinator there is
   * nothing to connect to. The device's own key is separate and survives.
   */
  it('can be forgotten', async () => {
    const keychain = withKeychain()
    await savePairing(REAL)
    expect(await forgetPairing()).toBe(true)
    expect(keychain['vpn.pairing']).toBeUndefined()
    expect(await readPairing()).toBeNull()
  })

  // A screen written in a browser has no Keychain, and must still render.
  it('does nothing rather than throwing with no keychain', async () => {
    ;(globalThis as any).window = {}
    expect(await savePairing(REAL)).toBe(false)
    expect(await readPairing()).toBeNull()
    expect(await forgetPairing()).toBe(true)
  })
})

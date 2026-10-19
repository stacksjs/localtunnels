/**
 * How a phone learns which network it belongs to.
 *
 * A device needs a coordinator to join and, usually, a shared secret to be
 * let in. The desktop app reads both from `servers.json`, written by
 * `bun run deploy:vpn`. A phone has no such file, and the values cannot be
 * built into the app: `authKey` is shared by every member of the network, so
 * a copy in a shipped binary belongs to everyone who downloads it, and
 * rotating it would mean shipping a new build to everyone who already had
 * the old one.
 *
 * So the desktop shows them and the phone reads them, once, as a link:
 *
 *     buddyvpn://pair?v=1&c=wss%3A%2F%2Fvpn.example%3A51821&k=<secret>&r=us-west
 *
 * ── Why a link and not a scanner ───────────────────────────────────────
 *
 * The app registers the `buddyvpn` scheme, so the phone's own camera
 * recognises this and offers to open it. That is one fewer camera
 * permission, one fewer screen, and a scanner nobody has to trust — iOS
 * does the reading, and the app only ever sees a URL it was launched with.
 *
 * ── What this is, plainly ──────────────────────────────────────────────
 *
 * A shared secret on a screen. Anyone who photographs it joins the network
 * and can advertise themselves as an exit, which the coordinator relays
 * without checking. It is no worse than `servers.json` on a laptop, and it
 * is not better: the screen that shows it says so, and the right long-term
 * answer is per-device credentials the coordinator can revoke, which it has
 * no notion of today.
 */

/** The scheme and host the desktop builds and the phone answers to. */
export const PAIR_SCHEME = 'buddyvpn:'
export const PAIR_HOST = 'pair'

/**
 * The format version, carried so an older app meets a newer link and says
 * so rather than reading fields it does not understand.
 */
export const PAIR_VERSION = '1'

export interface Pairing {
  /** `ws://` or `wss://`, optionally with a port. Never a path. */
  coordinatorUrl: string
  /** The shared secret, when the coordinator requires one. */
  authKey: string | null
  /** Which region this coordinator serves. */
  region: string
}

/**
 * A coordinator URL, by the same rule the desktop applies before letting one
 * near a root command: a scheme, a host and an optional port, and nothing
 * else. No path, no query, no credentials.
 */
const COORDINATOR_URL = /^wss?:\/\/[\w.-]+(?::\d{1,5})?$/
/** Word characters and dashes, as the desktop's token rule has it. */
const AUTH_KEY = /^[\w-]{8,128}$/
const REGION = /^[a-z0-9-]{2,32}$/

/** Build the link the desktop shows. Returns null if it would be invalid. */
export function pairingUrl(pairing: Pairing): string | null {
  if (!isPairing(pairing))
    return null
  const query = new URLSearchParams({
    v: PAIR_VERSION,
    c: pairing.coordinatorUrl,
    r: pairing.region,
  })
  if (pairing.authKey)
    query.set('k', pairing.authKey)
  return `${PAIR_SCHEME}//${PAIR_HOST}?${query.toString()}`
}

/** Whether a pairing is one this app would act on. */
export function isPairing(value: unknown): value is Pairing {
  if (!value || typeof value !== 'object')
    return false
  const raw = value as Record<string, unknown>
  if (typeof raw.coordinatorUrl !== 'string' || !COORDINATOR_URL.test(raw.coordinatorUrl))
    return false
  if (typeof raw.region !== 'string' || !REGION.test(raw.region))
    return false
  if (raw.authKey === null)
    return true
  return typeof raw.authKey === 'string' && AUTH_KEY.test(raw.authKey)
}

/**
 * Read a link the phone was opened with.
 *
 * Everything is validated rather than trusted. This arrives from outside the
 * app — anyone can put a `buddyvpn://` link in front of somebody — and the
 * values reach a VPN configuration, so a malformed or hostile one has to be
 * refused here rather than noticed later. Returns null for anything that is
 * not a pairing this app understands.
 */
export function parsePairingUrl(raw: string | null | undefined): Pairing | null {
  if (typeof raw !== 'string' || raw.length === 0)
    return null

  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    return null
  }
  if (url.protocol !== PAIR_SCHEME || url.hostname !== PAIR_HOST)
    return null
  // An unknown version means fields this build has never heard of. Better to
  // say "update the app" than to act on half of a format.
  if (url.searchParams.get('v') !== PAIR_VERSION)
    return null

  const pairing: Pairing = {
    coordinatorUrl: url.searchParams.get('c') ?? '',
    authKey: url.searchParams.get('k'),
    region: url.searchParams.get('r') ?? '',
  }
  return isPairing(pairing) ? pairing : null
}

/**
 * Where a pairing is kept.
 *
 * Craft's `secureStorage` is the Keychain; `storage` is `UserDefaults`, which
 * is a plist in the container. This holds a secret shared by every member of
 * a network, so it goes in the first one. That it is asynchronous, and that
 * the rest of this app's settings are not, is the price.
 */
const PAIRING_KEY = 'vpn.pairing'

interface SecureStore {
  get?: (key: string) => Promise<unknown>
  set?: (key: string, value: string) => Promise<unknown>
  remove?: (key: string) => Promise<unknown>
}

function secureStore(): SecureStore | undefined {
  return (globalThis as { window?: { craft?: { secureStorage?: SecureStore } } }).window?.craft?.secureStorage
}

/** Remember a pairing. Resolves false when it could not be kept. */
export async function savePairing(pairing: Pairing): Promise<boolean> {
  if (!isPairing(pairing))
    return false
  try {
    const store = secureStore()
    if (!store?.set)
      return false
    await store.set(PAIRING_KEY, JSON.stringify(pairing))
    return true
  }
  catch {
    // No Keychain, or it refused. The caller shows this as a pairing that
    // did not take rather than one that silently half-worked.
    return false
  }
}

/** The pairing this device has, or null if it has never been paired. */
export async function readPairing(): Promise<Pairing | null> {
  try {
    const stored = await secureStore()?.get?.(PAIRING_KEY)
    if (typeof stored !== 'string' || stored.length === 0)
      return null
    const parsed: unknown = JSON.parse(stored)
    // Validated on the way out as well as in: this survives app updates, and
    // a format that changed underneath must not be acted on.
    return isPairing(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

/**
 * Forget the pairing.
 *
 * What "sign out" means for a device: without it there is no coordinator to
 * join, so there is nothing to connect to. The device's own key is separate
 * and survives — see `DeviceIdentity.forget()` for the other half.
 */
export async function forgetPairing(): Promise<boolean> {
  try {
    await secureStore()?.remove?.(PAIRING_KEY)
    return true
  }
  catch {
    return false
  }
}

/**
 * The places this app can put you.
 *
 * A copy of the desktop app's list rather than an import of it: that package
 * is a macOS bundle whose entry point reaches for `node:os` and a loopback
 * agent, and pulling it in to read five strings would drag all of it into a
 * phone build.
 *
 * `exitIp` is here because the phone has no way to discover it. The desktop
 * app asks ipinfo what the world sees, which is honest evidence; until a
 * Network Extension exists there is no tunnel for that request to travel
 * through, so this is the address the screens *claim* — and the screens say
 * it is a claim.
 *
 * Keep in step with `packages/buddyvpn/src/regions.ts`, and with the regions
 * `deploy/config.ts` can actually provision. A location that cannot be
 * deployed is a location that cannot be connected to.
 */
export interface Region {
  /** Region alias, as `bun run deploy:vpn --region <id>` takes it. */
  id: string
  /** Two-letter tile. Not a flag: this app draws no emoji. */
  badge: string
  country: string
  city: string
  /** The exit's public address, when one has been deployed. */
  exitIp: string | null
}

export const REGIONS: Region[] = [
  { id: 'us-west', badge: 'US', country: 'United States', city: 'Hillsboro, Oregon · Pacific', exitIp: '5.78.208.190' },
  { id: 'eu-central', badge: 'DE', country: 'Germany', city: 'Falkenstein · Central European', exitIp: null },
]

export const DEFAULT_REGION = 'us-west'

export function regionById(id: string | null): Region | null {
  return REGIONS.find(region => region.id === id) ?? null
}

/** Whether a location has a server behind it. */
export function isDeployed(region: Region): boolean {
  return region.exitIp !== null
}

/** Where the choice is kept, so both screens name it once. */
const STORAGE_KEY = 'buddyvpn.region'

/**
 * The chosen region, read back rather than defaulted.
 *
 * Deliberately a read rather than a value held in a module: the two screens
 * may not share a JavaScript context, and even where they do, the connect
 * screen is still mounted underneath while the picker is open — its setup
 * does not run again when it comes back. Reading on every call, from the
 * place the choice actually lives, is the only version of this that cannot
 * go stale.
 */
export function readRegion(): string {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return stored && regionById(stored) ? stored : DEFAULT_REGION
  }
  catch {
    // Private windows and cleared site data throw rather than return null.
    // A missing preference is not an error.
    return DEFAULT_REGION
  }
}

/** Remember a region. Returns false when the choice could not be kept. */
export function writeRegion(id: string): boolean {
  if (!regionById(id))
    return false
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id)
    return true
  }
  catch {
    // The choice still applies to this session; it just will not outlive it.
    return false
  }
}

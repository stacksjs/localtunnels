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

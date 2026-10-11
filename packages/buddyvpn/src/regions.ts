/**
 * The places this app can put you.
 *
 * One list, shared by the window and the server, taken from the regions
 * `deploy/config.ts` can actually provision — not a menu invented for the UI.
 * A location that cannot be deployed is a location that cannot be connected
 * to, so inventing entries here would only produce a prettier dead end.
 *
 * `id` is the region alias `bun run deploy:vpn --region <id>` takes, which is
 * what keeps the two halves honest: the name on the button is the name you
 * would type to bring its server into existence.
 */
export interface Region {
  /** Region alias, as `deploy/config.ts` knows it. */
  id: string
  /** Two-letter tile in the UI. Not a flag: this app draws no emoji. */
  badge: string
  country: string
  city: string
}

/**
 * `us-west` is Hillsboro, Oregon — which is the West Coast and Pacific time,
 * and is not California. Hetzner has no California location at all, so a
 * literal one would mean AWS `us-west-1`, and for a VPN that is a bigger
 * decision than it looks: Hetzner includes about a terabyte of egress where
 * AWS charges roughly $0.09/GB, and on a VPN every byte you receive is egress
 * from the server. The label says Pacific so the choice reads as deliberate
 * rather than as an arbitrary town nobody asked for.
 */
export const REGIONS: Region[] = [
  { id: 'us-west', badge: 'US', country: 'United States', city: 'Hillsboro, Oregon · Pacific' },
  { id: 'eu-central', badge: 'DE', country: 'Germany', city: 'Falkenstein · Central European' },
]

export const DEFAULT_REGION: string = 'us-west'

export function regionById(id: string): Region | null {
  return REGIONS.find(region => region.id === id) ?? null
}

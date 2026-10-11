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

export const REGIONS: Region[] = [
  { id: 'us-west', badge: 'US', country: 'United States', city: 'Hillsboro, Oregon' },
  { id: 'eu-central', badge: 'DE', country: 'Germany', city: 'Falkenstein' },
]

export const DEFAULT_REGION: string = 'us-west'

export function regionById(id: string): Region | null {
  return REGIONS.find(region => region.id === id) ?? null
}

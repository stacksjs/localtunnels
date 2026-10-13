/**
 * Where the internet thinks this machine is.
 *
 * The window shows it for the same reason every VPN client does: "connected"
 * is a claim about the app, and the only thing that settles whether traffic
 * is actually leaving somewhere else is asking something on the outside what
 * address it sees. Connected and still showing the home city is the failure
 * worth catching, and it is the one a status label cannot report.
 *
 * This costs a request to a third party carrying this machine's own IP. That
 * is inherent — there is no way to ask the question without asking someone —
 * but it is a real disclosure, so it is a setting the user can turn off, and
 * the answer is cached rather than fetched on every repaint.
 *
 * It deliberately goes out over whatever the current routes are. Connected,
 * that means through the tunnel, and the answer is the exit's address: the
 * same check `curl ifconfig.me` would do by hand, which is what makes it
 * evidence rather than decoration.
 */
import { TtlCache } from '../support/shell'

export interface Location {
  ip: string
  city: string | null
  region: string | null
  /** ISO 3166-1 alpha-2, e.g. `PH`. */
  country: string | null
  org: string | null
}

/**
 * Long enough that repainting the window costs nothing, short enough that
 * connecting is reflected quickly. Connect and disconnect clear it outright,
 * so this only governs drift.
 */
const CACHE_MS = 60_000
const cache = new TtlCache<Location | null>(CACHE_MS)

/** Drop the cached answer: the route out has changed, so the answer has too. */
export function forgetLocation(): void {
  cache.clear()
}

/**
 * Parse ipinfo's payload.
 *
 * Split from the request so the shape can be asserted without the network,
 * and because every field here is optional in practice — a reserved or
 * unrouted address comes back with an `ip` and little else.
 */
export function parseLocation(payload: unknown): Location | null {
  if (!payload || typeof payload !== 'object')
    return null
  const raw = payload as Record<string, unknown>
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

  const ip = text(raw.ip)
  if (!ip)
    return null

  return {
    ip,
    city: text(raw.city),
    region: text(raw.region),
    country: text(raw.country),
    org: text(raw.org),
  }
}

/**
 * Ask where this machine appears to be, or null if the question could not be
 * answered.
 *
 * Null is a normal answer, not an error: there is no network, or the service
 * is rate-limiting, or the kill switch is armed and this request is one of
 * the things it is blocking. The window says nothing in that case rather than
 * guessing.
 */
export async function lookupLocation(): Promise<Location | null> {
  const cached = cache.get()
  if (cached !== null)
    return cached

  try {
    const response = await fetch('https://ipinfo.io/json', {
      signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/json' },
    })
    if (!response.ok)
      return null
    const location = parseLocation(await response.json())
    // Only a real answer is cached. A failure should be retried on the next
    // ask rather than remembered for a minute.
    if (location)
      cache.set(location)
    return location
  }
  catch {
    return null
  }
}

/** "Cebu City, Philippines" — or the most specific part available. */
export function describeLocation(location: Location | null, countryName?: string | null): string {
  if (!location)
    return ''
  const parts = [location.city, countryName ?? location.country].filter(Boolean)
  return parts.join(', ')
}

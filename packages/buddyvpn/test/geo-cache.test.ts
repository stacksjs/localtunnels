/**
 * The cached answer, and when it stops being an answer.
 *
 * `geo.ts` exists to settle one question a status label cannot: "connected"
 * is a claim about the app, and only something on the outside can say where
 * traffic actually leaves from. The answer is cached so repainting the window
 * costs nothing.
 *
 * The cache was never cleared. `forgetLocation` was written, documented as
 * the thing connect and disconnect call, and called by nothing — `control.ts`
 * did not import the module at all. So for up to a minute after the route
 * changed, the window showed evidence about the route before it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { connect, disconnect } from '../src/vpn/control'
import { forgetLocation, lookupLocation } from '../src/vpn/geo'

const realFetch = globalThis.fetch

/** Answer ipinfo with a given address, and count how often we are asked. */
function serving(ip: string): () => number {
  let asks = 0
  globalThis.fetch = (async () => {
    asks += 1
    return new Response(JSON.stringify({ ip, city: 'Hillsboro', country: 'US' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return () => asks
}

beforeEach(() => {
  forgetLocation()
})

afterEach(() => {
  globalThis.fetch = realFetch
  forgetLocation()
})

describe('the cache', () => {
  it('answers a second ask without asking again', async () => {
    const asks = serving('1.2.3.4')
    expect((await lookupLocation())?.ip).toBe('1.2.3.4')
    expect((await lookupLocation())?.ip).toBe('1.2.3.4')
    expect(asks()).toBe(1)
  })

  it('asks again once it has been forgotten', async () => {
    const asks = serving('1.2.3.4')
    await lookupLocation()
    forgetLocation()
    await lookupLocation()
    expect(asks()).toBe(2)
  })

  /*
   * A failure is not an answer, so it is not remembered. Caching null for a
   * minute would mean the window stays silent about where traffic leaves
   * from long after the network came back.
   */
  it('does not remember a failure', async () => {
    let asks = 0
    globalThis.fetch = (async () => {
      asks += 1
      return new Response('nope', { status: 503 })
    }) as unknown as typeof fetch
    expect(await lookupLocation()).toBeNull()
    expect(await lookupLocation()).toBeNull()
    expect(asks).toBe(2)
  })
})

describe('changing the route', () => {
  /*
   * Both of these stop early in a test environment — no server is configured
   * and nothing of ours is running — and that is exactly the point: the
   * cache is cleared before either does any work, so the answer cannot
   * outlive the route whatever happens next.
   */
  it('connecting forgets where traffic used to leave from', async () => {
    const asks = serving('1.2.3.4')
    await lookupLocation()
    expect(asks()).toBe(1)

    connect('us-west')

    await lookupLocation()
    expect(asks()).toBe(2)
  })

  /*
   * The direction that matters. Stale after connecting shows the home
   * address beside "Connected", which reads as a tunnel that is not working.
   * Stale after disconnecting shows the exit's address beside "Not
   * connected" — traffic appearing to leave somewhere else when it is going
   * out plainly, which is a false reassurance about exposure.
   */
  it('disconnecting forgets the exit it used to leave from', async () => {
    const asks = serving('5.78.208.190')
    await lookupLocation()
    expect(asks()).toBe(1)

    disconnect()

    await lookupLocation()
    expect(asks()).toBe(2)
  })

  // An unknown location changes no route, so it has no business clearing it.
  it('a location that does not exist leaves the answer alone', async () => {
    const asks = serving('1.2.3.4')
    await lookupLocation()

    connect('atlantis')

    await lookupLocation()
    expect(asks()).toBe(1)
  })
})

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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { appSupportDir, connect, disconnect } from '../src/vpn/control'
import { forgetLocation, lookupLocation } from '../src/vpn/geo'

const realFetch = globalThis.fetch

/*
 * Somewhere that is not the developer's own BuddyVPN.
 *
 * `connect` and `disconnect` are the real ones, deliberately: the bug this
 * file exists for was a `forgetLocation` that nobody called, and a stub of
 * either would have passed with the bug still in. But they read the app's
 * support directory to decide what to do, and on the machine this is written
 * on that directory describes a working VPN — so `disconnect()` found the
 * running tunnel through the pid file and took it down as root, which is
 * what the five-second timeouts in this file were. Pointed at an empty
 * directory, with no CLI to run, both still clear the cache and then stop at
 * the first thing they cannot find.
 */
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'buddyvpn-geo-'))
const realEnv = {
  support: process.env.BUDDYVPN_SUPPORT_DIR,
  bin: process.env.LOCALTUNNELS_BIN,
}

beforeAll(() => {
  process.env.BUDDYVPN_SUPPORT_DIR = sandbox
  // Not a path: `findCli` only accepts one it can execute, so this is how it
  // is told there is no CLI without depending on there being none installed.
  process.env.LOCALTUNNELS_BIN = path.join(sandbox, 'no-such-cli')
})

afterAll(() => {
  if (realEnv.support === undefined)
    delete process.env.BUDDYVPN_SUPPORT_DIR
  else process.env.BUDDYVPN_SUPPORT_DIR = realEnv.support
  if (realEnv.bin === undefined)
    delete process.env.LOCALTUNNELS_BIN
  else process.env.LOCALTUNNELS_BIN = realEnv.bin
  fs.rmSync(sandbox, { recursive: true, force: true })
})

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
   * Both of these stop early, and the first assertion in each is that they
   * did. The cache is cleared before either looks at anything, so clearing
   * is observable from a call that then finds no server and no CLI — and
   * saying so out loud is what keeps this file from quietly operating a real
   * VPN again if the sandbox above ever stops being applied.
   */
  it('reaches neither a server nor a CLI', () => {
    // Checked before anything is called, so a sandbox that stopped applying
    // fails here rather than one line into operating the real thing.
    expect(appSupportDir()).toBe(sandbox)
    expect(connect('us-west')).toEqual({
      success: false,
      error: 'No server configured for United States',
    })
    expect(disconnect()).toEqual({ success: true })
  })

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

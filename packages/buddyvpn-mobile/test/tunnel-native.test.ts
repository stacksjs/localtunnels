/**
 * The tunnel that reports rather than pretends.
 *
 * `StubTunnel` drives its own phases because it owns them. This one is
 * reporting on a process it does not control — a Network Extension the
 * system starts, stops and restarts on its own — and every test here is
 * really the same assertion from a different angle: it says what iOS said,
 * and never what it was asked for.
 *
 * The host is faked rather than mocked out, because the real one is only two
 * functions wide: a storage write going out and a snapshot plus a change
 * notification coming back. Standing that up honestly is cheaper than
 * pretending the class has no dependencies.
 */
import type { TunnelSnapshot } from '../src/tunnel'
import { afterEach, describe, expect, it } from 'bun:test'
import config from '../mobile.config'
import { selectTunnel, StubTunnel, tunnel } from '../src/tunnel'
import { NativeTunnel } from '../src/tunnel-native'

interface FakeHost {
  /** Everything the screens wrote, in order. */
  writes: { key: string, value: any }[]
  /** Put a status frame in place and tell the screens about it. */
  publish: (frame: unknown) => void
  /** Drop the snapshot, as a cleared install or an extension that never ran. */
  clear: () => void
}

function withHost(options: { initial?: unknown, failWrites?: boolean } = {}): FakeHost {
  const writes: { key: string, value: any }[] = []
  let current: string | null = options.initial === undefined ? null : JSON.stringify(options.initial)
  const listeners = new Set<(name: string) => void>()

  ;(globalThis as any).window = {
    craft: {
      storage: {
        set: async (key: string, value: unknown) => {
          if (options.failWrites)
            throw new Error('storage is unavailable')
          writes.push({ key, value })
          return true
        },
      },
      snapshots: {
        get: (name: string) => (name === 'vpn-status' ? current : null),
        onChange: (callback: (name: string) => void) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
      },
    },
  }

  return {
    writes,
    publish: (frame: unknown) => {
      current = JSON.stringify(frame)
      for (const listener of [...listeners]) listener('vpn-status')
    },
    clear: () => {
      current = null
      for (const listener of [...listeners]) listener('vpn-status')
    },
  }
}

/** Subscribe and collect every snapshot the tunnel emits. */
function watch(tunnel: NativeTunnel): { seen: TunnelSnapshot[], stop: () => void } {
  const seen: TunnelSnapshot[] = []
  const stop = tunnel.subscribe(snapshot => seen.push(snapshot))
  return { seen, stop }
}

afterEach(() => {
  delete (globalThis as any).window
})

describe('what it reports', () => {
  it('is a real tunnel, and says so', () => {
    withHost()
    const tunnel = new NativeTunnel()
    expect(tunnel.available()).toBe(true)
    expect(tunnel.snapshot().simulated).toBe(false)
  })

  /*
   * A Network Extension outlives the app that started it — that is the point
   * of it being a separate process. An app launched into a live tunnel that
   * waited for a change would draw "Not connected" over a working one.
   */
  it('adopts a tunnel that was already up when the screen opened', () => {
    withHost({
      initial: { phase: 'connected', region: 'us-west', exitIp: '5.78.208.190', error: null, since: Date.now() - 5000 },
    })
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)
    expect(seen[0].phase).toBe('connected')
    expect(seen[0].region).toBe('us-west')
    expect(seen[0].uptimeSeconds).toBeGreaterThanOrEqual(4)
    stop()
  })

  it('starts idle when the extension has never run', () => {
    withHost()
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)
    expect(seen[0].phase).toBe('idle')
    expect(seen[0].region).toBeNull()
    stop()
  })

  it('follows the phases the host publishes', () => {
    const host = withHost()
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)

    host.publish({ phase: 'connecting', region: 'us-west' })
    host.publish({ phase: 'connected', region: 'us-west', exitIp: '5.78.208.190', since: Date.now() })
    host.publish({ phase: 'disconnecting', region: 'us-west' })
    host.publish({ phase: 'idle' })

    expect(seen.map(s => s.phase)).toEqual(['idle', 'connecting', 'connected', 'disconnecting', 'idle'])
    stop()
  })

  /*
   * A frame that cannot be read is not a tunnel that is up. Carrying the last
   * known phase forward would leave "Connected" on screen over a tunnel
   * whose status is unreadable, which is the failure this whole app is
   * written against.
   */
  it('falls back to idle when the status becomes unreadable', () => {
    const host = withHost({ initial: { phase: 'connected', since: Date.now() } })
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)
    expect(seen[0].phase).toBe('connected')

    host.publish({ phase: 'something-new' })
    expect(seen[seen.length - 1].phase).toBe('idle')
    stop()
  })

  it('falls back to idle when the status is cleared', () => {
    const host = withHost({ initial: { phase: 'connected', since: Date.now() } })
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)

    host.clear()
    expect(seen[seen.length - 1].phase).toBe('idle')
    expect(seen[seen.length - 1].exitIp).toBeNull()
    stop()
  })

  it('carries an error through to the screen', () => {
    const host = withHost()
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)
    host.publish({ phase: 'idle', error: 'BuddyVPN was not allowed to add a VPN configuration.' })
    expect(seen[seen.length - 1].error).toContain('not allowed')
    stop()
  })
})

describe('what it asks for', () => {
  it('leaves a connect request the other process can find', async () => {
    const host = withHost()
    const tunnel = new NativeTunnel()
    await tunnel.connect('us-west', '5.78.208.190')

    expect(host.writes).toHaveLength(1)
    expect(host.writes[0].key).toBe('vpn.request')
    expect(host.writes[0].value).toMatchObject({ action: 'connect', region: 'us-west', exitIp: '5.78.208.190' })
    expect(typeof host.writes[0].value.nonce).toBe('string')
  })

  it('leaves a disconnect request', async () => {
    const host = withHost()
    const tunnel = new NativeTunnel()
    await tunnel.disconnect()
    expect(host.writes[0].value).toMatchObject({ action: 'disconnect' })
  })

  /*
   * The bug the nonce exists for, from this side: connect, disconnect,
   * connect the same region writes identical JSON the second time,
   * UserDefaults sees no change, and the third tap does nothing.
   */
  it('makes two identical requests two different writes', async () => {
    const host = withHost()
    const tunnel = new NativeTunnel()
    await tunnel.connect('us-west', '5.78.208.190')
    await tunnel.disconnect()
    await tunnel.connect('us-west', '5.78.208.190')

    expect(host.writes[0].value.nonce).not.toBe(host.writes[2].value.nonce)
  })

  /*
   * The first connect raises the system's VPN alert and then Face ID, either
   * of which can be declined. A phase set here would show "Connecting…" over
   * a dialog about to be dismissed, and then have to be walked back.
   */
  it('does not claim to be connecting until the host says so', async () => {
    const host = withHost()
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)
    await tunnel.connect('us-west', '5.78.208.190')

    expect(seen.map(s => s.phase)).toEqual(['idle'])
    host.publish({ phase: 'connecting', region: 'us-west' })
    expect(seen[seen.length - 1].phase).toBe('connecting')
    stop()
  })

  // A tap that could not be delivered has to be visible as one, rather than
  // looking like a tap that worked.
  it('reports a request it could not leave', async () => {
    withHost({ failWrites: true })
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)
    await tunnel.connect('us-west', null)
    expect(seen[seen.length - 1].error).toContain('storage is unavailable')
    stop()
  })
})

describe('off a host', () => {
  /*
   * These screens are written in a browser and reviewed in a simulator. A
   * tunnel that throws without the bridge is a tunnel nobody can look at
   * while working on the screen around it.
   */
  it('renders rather than throwing when there is no bridge', async () => {
    ;(globalThis as any).window = {}
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)
    expect(seen[0].phase).toBe('idle')
    await tunnel.connect('us-west', null)
    await tunnel.disconnect()
    stop()
  })
})

describe('subscriptions', () => {
  it('stops listening when the last subscriber goes', () => {
    const host = withHost()
    const tunnel = new NativeTunnel()
    const { seen, stop } = watch(tunnel)
    stop()

    host.publish({ phase: 'connected', since: Date.now() })
    expect(seen.map(s => s.phase)).toEqual(['idle'])
  })

  it('gives every subscriber the current state at once', () => {
    withHost({ initial: { phase: 'connected', region: 'us-west', since: Date.now() } })
    const tunnel = new NativeTunnel()
    const first = watch(tunnel)
    const second = watch(tunnel)
    expect(second.seen[0].phase).toBe('connected')
    first.stop()
    second.stop()
  })
})

/*
 * The selector, which is what makes any of the above reachable at all.
 *
 * NativeTunnel was written, tested and then selected by nothing — the
 * screens held a StubTunnel unconditionally. Tested code that cannot run is
 * worse than no code, because it reads as working.
 */
describe('which tunnel the screens get', () => {
  it('is the real one when the build shipped a provider', () => {
    withHost()
    expect(selectTunnel(true)).toBeInstanceOf(NativeTunnel)
  })

  it('is the stand-in when it did not', () => {
    withHost()
    expect(selectTunnel(false)).toBeInstanceOf(StubTunnel)
  })

  /*
   * The one field a screen must never get wrong. A stub that claimed to be
   * real would put a connection on screen that moves no packets, which is
   * the demo mode this app was written against.
   */
  it('tells the truth about itself either way', () => {
    withHost()
    expect(selectTunnel(true).snapshot().simulated).toBe(false)
    expect(selectTunnel(false).snapshot().simulated).toBe(true)
    expect(selectTunnel(true).available()).toBe(true)
    expect(selectTunnel(false).available()).toBe(false)
  })

  /*
   * Today's answer, and it is deliberate: the entitlement does not exist, so
   * the capability is off and the screens show a simulated tunnel that says
   * it is simulated. This fails the day the flag flips, which is when
   * someone should look at this file again.
   */
  it('is the stand-in today, because the capability is off', () => {
    withHost()
    expect(tunnel.snapshot().simulated).toBe(true)
    expect(config.ios.capabilities.networkExtension).toBe(false)
  })
})

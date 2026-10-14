import { describe, expect, it } from 'bun:test'
import { DEFAULT_REGION, isDeployed, REGIONS, regionById } from '../src/regions'
import { formatUptime, StubTunnel } from '../src/tunnel'

describe('formatUptime', () => {
  it('pads to hours, which is the width the clock holds', () => {
    expect(formatUptime(0)).toBe('00:00:00')
    expect(formatUptime(65)).toBe('00:01:05')
    expect(formatUptime(3725)).toBe('01:02:05')
  })

  it('renders nothing when nothing is running', () => {
    // An empty string rather than a zeroed clock: a clock reading 00:00:00
    // beside "Not connected" is a clock that looks stuck.
    expect(formatUptime(null)).toBe('')
    expect(formatUptime(-1)).toBe('')
  })
})

describe('regions', () => {
  it('has a default that exists', () => {
    expect(regionById(DEFAULT_REGION)).not.toBeNull()
  })

  it('distinguishes a deployed location from a listed one', () => {
    // eu-central is in the list and has no server. The screens disable it
    // rather than offering a button that cannot work.
    expect(REGIONS.some(r => isDeployed(r))).toBe(true)
    expect(REGIONS.some(r => !isDeployed(r))).toBe(true)
  })

  it('returns null for an id it does not have', () => {
    expect(regionById('atlantis')).toBeNull()
    expect(regionById(null)).toBeNull()
  })
})

describe('StubTunnel', () => {
  it('says it is simulated on every snapshot', () => {
    // The desktop app once had a demo mode that walked a convincing
    // connection without moving a packet. The risk it carried was somebody
    // believing it, so this is not a flag a screen can forget to read.
    const tunnel = new StubTunnel()
    expect(tunnel.snapshot().simulated).toBe(true)
    expect(tunnel.available()).toBe(false)
  })

  it('walks idle -> connecting -> connected, then back', async () => {
    const tunnel = new StubTunnel()
    const seen: string[] = []
    tunnel.subscribe(s => seen.push(s.phase))

    await tunnel.connect('us-west')
    expect(tunnel.snapshot().phase).toBe('connected')
    expect(tunnel.snapshot().exitIp).toBe('5.78.208.190')

    await tunnel.disconnect()
    expect(tunnel.snapshot().phase).toBe('idle')
    // And the exit address goes with it, rather than lingering under a
    // disconnected label.
    expect(tunnel.snapshot().exitIp).toBeNull()
    expect(seen).toEqual(['idle', 'connecting', 'connected', 'disconnecting', 'idle'])
  }, 10_000)

  it('refuses a location it does not have, without changing phase', async () => {
    const tunnel = new StubTunnel()
    await tunnel.connect('atlantis')
    expect(tunnel.snapshot().phase).toBe('idle')
    expect(tunnel.snapshot().error).toBe('Unknown location')
  })

  it('ignores a second connect while one is in flight', async () => {
    const tunnel = new StubTunnel()
    const first = tunnel.connect('us-west')
    await tunnel.connect('eu-central')
    // The second call is dropped rather than queued or raced: the region is
    // still the first one.
    expect(tunnel.snapshot().region).toBe('us-west')
    await first
  }, 10_000)
})

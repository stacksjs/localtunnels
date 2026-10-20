import { describe, expect, it } from 'bun:test'
import { DEFAULT_REGION, isDeployed, REGIONS, regionById } from '../src/regions'
import { coordinatorNotice, formatUptime, StubTunnel } from '../src/tunnel'

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

/*
 * The banner for a tunnel that is up and about to stop carrying traffic.
 *
 * This is the one state the phase cannot express. A node dropped from its
 * coordinator's directory loses the exit's route to it, and iOS goes on
 * reporting `connected` because the interface really is up — so the screen
 * says Connected, the badge is showing, and the traffic has stopped or is
 * about to. Being forgotten is not an event anybody sends you.
 *
 * The wording is here rather than in `connect.stx` precisely so it can be
 * checked. A bound expression leaves no trace in the rendered document until
 * its condition holds, and the shipped build selects the stand-in, which
 * joins no coordinator and so can never reach these states — a sentence
 * written in the markup could only have been verified by reading it.
 */
describe('coordinatorNotice', () => {
  // Nothing to say is the common case, and a banner that is always there is
  // furniture rather than a change.
  it('says nothing while the coordinator is fine', () => {
    expect(coordinatorNotice('joined', 'United States')).toBeNull()
  })

  // Null is an idle tunnel, which has not joined anything to lose.
  it('says nothing when there is no tunnel', () => {
    expect(coordinatorNotice(null, 'United States')).toBeNull()
  })

  /*
   * Waiting, not broken. The retrying case is the whole reason this exists,
   * and it has to say that traffic may stop — otherwise it reads as a
   * cosmetic warning next to a screen that still says Connected.
   */
  it('warns while it is trying to get back', () => {
    const notice = coordinatorNotice('retrying', 'Germany')
    expect(notice?.tone).toBe('warning')
    expect(notice?.message).toContain('Germany')
    expect(notice?.message).toContain('traffic may stop')
  })

  /*
   * Broken, and in a way only a person can fix: a coordinator refuses a
   * device whose auth key it does not accept, which no amount of retrying
   * will change. So the sentence says what to do instead of what happened.
   */
  it('tells somebody to re-pair when the network refused this device', () => {
    const notice = coordinatorNotice('refused', 'Germany')
    expect(notice?.tone).toBe('error')
    expect(notice?.message).toContain('Germany')
    expect(notice?.message).toContain('Pair it again')
  })

  // The two are different tones because one of them needs an action, and a
  // screen that painted them the same would be hiding that.
  it('distinguishes waiting from needing somebody', () => {
    expect(coordinatorNotice('retrying', null)?.tone)
      .not.toBe(coordinatorNotice('refused', null)?.tone)
  })

  /*
   * A region the screens cannot name. `running()` resolves the tunnel's own
   * region and returns null for one this build has never heard of, so both
   * sentences have to read without it rather than saying "undefined".
   */
  it('reads without a region name', () => {
    for (const phase of ['retrying', 'refused'] as const) {
      const message = coordinatorNotice(phase, null)?.message ?? ''
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain('null')
      expect(message).not.toContain('undefined')
    }
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

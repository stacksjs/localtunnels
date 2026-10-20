/**
 * What the screens talk to, and the stub they talk to today.
 *
 * The desktop app reaches its tunnel through a loopback HTTP agent. A phone
 * has nothing of the kind: an iOS app reaches the network stack only through
 * a Network Extension, which is a separate process the system starts, and
 * which this build does not have the entitlement to ship.
 *
 * So the screens are written against this interface rather than against
 * either mechanism. The stub below drives every state the real one will —
 * connecting, connected, the clock, failure — which is what makes the screens
 * testable in a browser before an extension exists. When the entitlement
 * arrives, `NativeTunnel` replaces `StubTunnel` behind the same five methods
 * and no screen changes.
 *
 * It is deliberately obvious about being a stub. The desktop app once had a
 * demo mode that walked a convincing connection without moving a packet, and
 * the risk it carried was someone believing it: `simulated` is on every
 * snapshot, and the screens say so where a person can read it.
 */
import config from '../mobile.config'
import { REGIONS } from './regions'
import { NativeTunnel } from './tunnel-native'

export type TunnelPhase = 'idle' | 'connecting' | 'connected' | 'disconnecting'

/**
 * How this device is getting on with its network's coordinator.
 *
 * Separate from {@link TunnelPhase}, which is the system's view of the VPN
 * connection and says nothing about this. The two come apart in the failure
 * that matters: a node that stops heart-beating is dropped from the
 * directory and the exit withdraws the route to its address, while iOS goes
 * on reporting `connected` because the interface is up. Folding this into
 * the phase would have made that state unrepresentable — the tunnel *is*
 * connected, and the traffic is about to stop.
 *
 * `'retrying'` collapses two things on purpose: a coordinator that has gone
 * silent on an open socket, and one this device is between sockets with.
 * There is nothing a person would do differently about them, and the
 * distinction is in the log.
 */
export type CoordinatorPhase = 'joined' | 'retrying' | 'refused'

/**
 * What to say about the coordinator, if anything.
 *
 * Here rather than inline in the screen because the wording is the part
 * worth testing and a template is where things go to stop being tested: a
 * bound expression leaves no trace in the rendered document until its
 * condition holds, so a message written in the markup can only be checked by
 * reading it.
 *
 * Null while it is fine, and null while idle. A banner that is always there
 * is furniture, and this one has to read as a change.
 *
 * `country` rather than a region id, because it is going on a screen. Null
 * when the region is not known, which the sentences are written to survive.
 */
export interface CoordinatorNotice {
  /** `'error'` needs somebody to act; `'warning'` is waiting. */
  tone: 'warning' | 'error'
  message: string
}

export function coordinatorNotice(
  coordinator: CoordinatorPhase | null,
  country: string | null,
): CoordinatorNotice | null {
  if (coordinator === 'refused') {
    /*
     * The one that needs a person. A coordinator refuses a device whose auth
     * key it does not accept, which no amount of retrying will fix — the
     * network's key was rotated, or this pairing was for somewhere else.
     */
    return {
      tone: 'error',
      message: `${country ?? 'This network'} refused this device. Pair it again from BuddyVPN on your Mac.`,
    }
  }
  if (coordinator === 'retrying') {
    /*
     * The one that is only waiting — and the reason any of this is on screen.
     * A node dropped from the directory loses the exit's route to it, and iOS
     * goes on reporting `connected` because the interface is up. So the
     * screen says Connected, the badge is showing, and the traffic has
     * stopped or is about to. Being forgotten is not an event anybody sends
     * you, which is why it has to be said from the side that noticed.
     */
    return {
      tone: 'warning',
      message: `Lost touch with ${country ?? 'the network'}. Trying to get back — traffic may stop until it does.`,
    }
  }
  return null
}

export interface TunnelSnapshot {
  phase: TunnelPhase
  /**
   * The coordinator, or null when there is no tunnel to have one.
   *
   * Null rather than `'joined'` for an idle tunnel: a device that is not
   * connected has not joined anything, and saying it had would put a
   * reassuring word on a screen for a state nobody is in.
   */
  coordinator: CoordinatorPhase | null
  /** Region id, once one has been chosen. */
  region: string | null
  /** Seconds since the tunnel came up, or null when it is not up. */
  uptimeSeconds: number | null
  /** What the far end reports, once connected. */
  exitIp: string | null
  /** Why the last attempt failed, if it did. */
  error: string | null
  /** Whether this is a real tunnel or the stand-in. Always rendered. */
  simulated: boolean
}

export interface Tunnel {
  snapshot: () => TunnelSnapshot
  subscribe: (listener: (snapshot: TunnelSnapshot) => void) => () => void
  connect: (region: string) => Promise<void>
  disconnect: () => Promise<void>
  /** Whether a real tunnel is available at all; false drives the banner. */
  available: () => boolean
  /**
   * This device's public key, or null. The stand-in has none: it joins
   * nothing, so there is nothing to be known by.
   */
  deviceKey: () => string | null
  /** Throw this device's key away and make another. */
  forgetIdentity: () => Promise<void>
  /**
   * Throw away the secret this device joins with.
   *
   * Separate from the pairing the screens keep, because there are two
   * copies and only one of them is theirs: the tunnel runs in another
   * process and reads its own, which would otherwise outlive the pairing.
   */
  forgetPairing: () => Promise<void>
}

/** How long the stand-in spends pretending to shake hands. */
const FAKE_CONNECT_MS = 1400
const FAKE_DISCONNECT_MS = 600

export class StubTunnel implements Tunnel {
  private current: TunnelSnapshot = {
    phase: 'idle',
    coordinator: null,
    region: null,
    uptimeSeconds: null,
    exitIp: null,
    error: null,
    simulated: true,
  }

  private listeners = new Set<(snapshot: TunnelSnapshot) => void>()
  private connectedAt: number | null = null
  private clock: ReturnType<typeof setInterval> | null = null

  available(): boolean {
    return false
  }

  deviceKey(): string | null {
    return null
  }

  async forgetIdentity(): Promise<void> {
    // Nothing to forget: the stand-in never had a key.
  }

  async forgetPairing(): Promise<void> {
    // Nor a network to be let into.
  }

  snapshot(): TunnelSnapshot {
    return { ...this.current }
  }

  subscribe(listener: (snapshot: TunnelSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(patch: Partial<TunnelSnapshot>): void {
    this.current = { ...this.current, ...patch }
    for (const listener of this.listeners)
      listener(this.snapshot())
  }

  async connect(region: string): Promise<void> {
    if (this.current.phase !== 'idle')
      return
    // Rejected here rather than at the button, because the real tunnel will
    // reject it here too: a region with no server is not a thing the UI
    // should have to remember not to ask for.
    const known = REGIONS.find(entry => entry.id === region)
    if (!known) {
      this.emit({ error: 'Unknown location' })
      return
    }

    this.emit({ phase: 'connecting', region, error: null })
    await new Promise(resolve => setTimeout(resolve, FAKE_CONNECT_MS))

    this.connectedAt = Date.now()
    // `'joined'` because the stand-in's pretence is a tunnel that works, and
    // a banner about a coordinator it never had would be a worse lie than
    // the one it is already labelled with.
    this.emit({ phase: 'connected', coordinator: 'joined', exitIp: known.exitIp, uptimeSeconds: 0 })
    this.clock = setInterval(() => {
      if (this.connectedAt === null)
        return
      this.emit({ uptimeSeconds: Math.floor((Date.now() - this.connectedAt) / 1000) })
    }, 1000)
  }

  async disconnect(): Promise<void> {
    if (this.current.phase !== 'connected')
      return
    this.emit({ phase: 'disconnecting' })
    await new Promise(resolve => setTimeout(resolve, FAKE_DISCONNECT_MS))

    if (this.clock) {
      clearInterval(this.clock)
      this.clock = null
    }
    this.connectedAt = null
    this.emit({ phase: 'idle', coordinator: null, uptimeSeconds: null, exitIp: null })
  }
}

/**
 * Which tunnel the screens get.
 *
 * The capability, not the host. It would seem more careful to ask whether
 * there is a Craft bridge first, and it would be wrong twice over: the
 * bridge is installed after the document starts, so the answer at module
 * load is "no" even on a phone, and the question it answers is not the one
 * that matters. What decides whether there is a tunnel to talk to is whether
 * this build shipped a packet tunnel provider, and that is a build-time fact
 * — the same flag `build:ios` reads when it decides whether to emit the
 * extension at all. One switch, one answer, in both places.
 *
 * Off a host, `NativeTunnel` reports an idle tunnel and does nothing, which
 * is the honest thing for a VPN screen opened in a browser: it cannot
 * tunnel, and the stub's pretend connection would be a worse answer than no
 * connection.
 */
export function selectTunnel(capable: boolean): Tunnel {
  return capable ? new NativeTunnel() : new StubTunnel()
}

/**
 * The tunnel the screens use. One per app.
 *
 * `StubTunnel` today, because the Network Extension entitlement does not
 * exist yet and so the capability is off. That is not a placeholder left in
 * by accident: `simulated` rides on every snapshot and the screens say so
 * where a person can read it.
 */
export const tunnel: Tunnel = selectTunnel(config.ios.capabilities.networkExtension)

/** `01:23:45`, or an empty string when nothing is running. */
export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0)
    return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
}

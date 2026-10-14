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
import { REGIONS } from './regions'

export type TunnelPhase = 'idle' | 'connecting' | 'connected' | 'disconnecting'

export interface TunnelSnapshot {
  phase: TunnelPhase
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
}

/** How long the stand-in spends pretending to shake hands. */
const FAKE_CONNECT_MS = 1400
const FAKE_DISCONNECT_MS = 600

export class StubTunnel implements Tunnel {
  private current: TunnelSnapshot = {
    phase: 'idle',
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
    this.emit({ phase: 'connected', exitIp: known.exitIp, uptimeSeconds: 0 })
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
    this.emit({ phase: 'idle', uptimeSeconds: null, exitIp: null })
  }
}

/** The tunnel the screens use. One per app. */
export const tunnel: Tunnel = new StubTunnel()

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

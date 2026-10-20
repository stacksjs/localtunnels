/**
 * The tunnel, when there is a real one behind it.
 *
 * Same five methods as {@link StubTunnel}, so no screen knows which it has.
 * The difference is that nothing here pretends: `connect` leaves a request
 * for the Swift half and returns, and the phase changes when — and only
 * when — the system says it did. A stub can promise its own state changes
 * because it owns them; this one is reporting on a process it does not
 * control, and the whole value of it is that it never says "connected"
 * unless iOS does.
 *
 * It is selected only when the host both has the bridge and was built with
 * the VPN capability. Without the Network Extension entitlement there is no
 * provider to start, so a native tunnel there would be a stub with worse
 * manners — see {@link selectTunnel}.
 */
import type { Tunnel, TunnelSnapshot } from './tunnel'
import type { TunnelStatusFrame } from './tunnel-bridge'
import { readPairing } from './pairing'
import { regionById } from './regions'
import { dnsServers, readSettings } from './settings'
import { nextNonce, parseStatus, REQUEST_KEY, STATUS_SNAPSHOT, uptimeFrom } from './tunnel-bridge'

/** How often the uptime is recomputed while connected. Local, not pushed. */
const CLOCK_MS = 1000

export class NativeTunnel implements Tunnel {
  private current: TunnelSnapshot = {
    phase: 'idle',
    region: null,
    uptimeSeconds: null,
    exitIp: null,
    error: null,
    // The one field that is not a lie either way: there is a real tunnel.
    simulated: false,
  }

  private key: string | null = null
  private listeners = new Set<(snapshot: TunnelSnapshot) => void>()
  private since: number | null = null
  private clock: ReturnType<typeof setInterval> | null = null
  private unwatch: (() => void) | null = null

  available(): boolean {
    return true
  }

  deviceKey(): string | null {
    return this.key
  }

  async forgetIdentity(): Promise<void> {
    await this.request({ action: 'forget-identity', nonce: nextNonce() })
  }

  async forgetPairing(): Promise<void> {
    await this.request({ action: 'forget-pairing', nonce: nextNonce() })
  }

  snapshot(): TunnelSnapshot {
    return { ...this.current }
  }

  subscribe(listener: (snapshot: TunnelSnapshot) => void): () => void {
    /*
     * The watch starts before the listener is added, not after.
     *
     * `watch` reads the current status and applies it, which emits — so a
     * listener added first would be called by that, and then again by the
     * explicit call below. The first subscriber got two snapshots for one
     * subscription, which re-renders a screen on mount and double-fires
     * anything wired to the subscription. Starting the watch while there is
     * nobody to notify makes the call below the only one.
     *
     * The first subscriber is also what starts it at all, so a screen that
     * is never shown costs nothing.
     */
    if (this.listeners.size === 0)
      this.watch()
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0)
        this.unwatch?.()
    }
  }

  /**
   * Follow the status the other process writes.
   *
   * Read first, then subscribe. The tunnel may well have been up before this
   * screen existed — a Network Extension outlives the app that started it,
   * which is the entire point of it being a separate process — so waiting
   * for a change would show "Not connected" over a live tunnel.
   */
  private watch(): void {
    this.apply(this.read())
    try {
      const snapshots = window.craft?.snapshots
      const stop = snapshots?.onChange?.((name: string) => {
        if (name === STATUS_SNAPSHOT)
          this.apply(this.read())
      })
      this.unwatch = () => {
        try {
          stop?.()
        }
        catch {
          // Unsubscribing from a host that has gone is not a failure.
        }
        this.stopClock()
        this.unwatch = null
      }
    }
    catch {
      // No bridge: the read above still gave whatever was on disk, and the
      // screen renders that rather than nothing.
      this.unwatch = () => this.stopClock()
    }
  }

  private read(): TunnelStatusFrame | null {
    try {
      return parseStatus(window.craft?.snapshots?.get?.(STATUS_SNAPSHOT) ?? null)
    }
    catch {
      return null
    }
  }

  /** Take on a status frame, or fall back to idle when there is none. */
  private apply(frame: TunnelStatusFrame | null): void {
    this.key = frame?.deviceKey ?? null
    if (!frame) {
      this.since = null
      this.stopClock()
      this.emit({ phase: 'idle', region: null, exitIp: null, uptimeSeconds: null })
      return
    }

    this.since = frame.since
    this.emit({
      phase: frame.phase,
      region: frame.region,
      exitIp: frame.exitIp,
      error: frame.error,
      uptimeSeconds: uptimeFrom(frame.since),
    })

    if (frame.phase === 'connected')
      this.startClock()
    else
      this.stopClock()
  }

  private startClock(): void {
    if (this.clock)
      return
    this.clock = setInterval(() => {
      this.emit({ uptimeSeconds: uptimeFrom(this.since) })
    }, CLOCK_MS)
  }

  private stopClock(): void {
    if (!this.clock)
      return
    clearInterval(this.clock)
    this.clock = null
  }

  private emit(patch: Partial<TunnelSnapshot>): void {
    this.current = { ...this.current, ...patch }
    for (const listener of this.listeners)
      listener(this.snapshot())
  }

  /**
   * Ask for a tunnel. Deliberately does not set `connecting` itself.
   *
   * The first connect raises the system's "Add VPN Configurations" alert and
   * then Face ID, and a person can decline both. A phase set here would show
   * "Connecting…" over a dialog the user is about to dismiss, and then have
   * to be walked back. The Swift half reports `connecting` once iOS has
   * actually accepted the start.
   */
  async connect(region: string): Promise<void> {
    /*
     * The request is assembled here rather than by the caller.
     *
     * Everything in it is already knowable from the region and the stored
     * settings, and an argument for each would be an argument each caller
     * could forget — `exitIp` was one, defaulted to null, and nothing ever
     * passed it. A screen asks for a region; what that means is this
     * object's business.
     */
    const settings = readSettings()
    // The network this device was paired to, if it has been. Without one
    // there is no coordinator to join, and the provider says so rather than
    // starting something that cannot finish.
    const pairing = await readPairing()
    await this.request({
      action: 'connect',
      region,
      exitIp: regionById(region)?.exitIp ?? null,
      dns: dnsServers(settings.dns),
      allowLan: settings.allowLan,
      coordinatorUrl: pairing?.coordinatorUrl ?? null,
      authKey: pairing?.authKey ?? null,
      exitKey: pairing?.exitKey ?? null,
      nonce: nextNonce(),
    })
  }

  async disconnect(): Promise<void> {
    await this.request({ action: 'disconnect', nonce: nextNonce() })
  }

  private async request(body: unknown): Promise<void> {
    try {
      await window.craft?.storage?.set?.(REQUEST_KEY, body)
    }
    catch (error) {
      // A request that could not be left is a tap that did nothing, and the
      // screen has to be able to say so rather than appearing to work.
      this.emit({ error: error instanceof Error ? error.message : 'The tunnel could not be reached' })
    }
  }
}

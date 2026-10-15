/**
 * The contract between the screens and the process that owns the tunnel.
 *
 * These are two processes with no shared memory and, after an update, not
 * necessarily the same build: the screens are JavaScript in the app, and the
 * VPN is driven by Swift that talks to `NETunnelProviderManager`. Everything
 * here is the wire format between them, which is why it is a module of its
 * own with no behaviour in it — both halves have to agree, and the agreement
 * should be readable in one place.
 *
 * ── Why these two channels ─────────────────────────────────────────────
 *
 * Craft's native API is a fixed switch in generated Swift with no
 * registration point, and the file is rewritten on every build, so a `Vpn`
 * module cannot be added to it without patching generated code that a Craft
 * upgrade would silently break. What Craft does publish is enough:
 *
 *   screens → Swift   `craft.storage.set`, which writes JSON into
 *                     `UserDefaults.standard` under Craft's own prefix. Our
 *                     Swift observes that key.
 *   Swift → screens   `CraftSnapshots.write`, which posts a notification
 *                     every screen forwards as `SNAPSHOT_CHANGED`. The
 *                     screens then read it with `craft.snapshots.get`.
 *
 * Different directions use different mechanisms because they want different
 * things. A request is a one-shot the screens already know they made. A
 * status change happens while nobody is asking, and has to arrive on its own.
 */
import type { TunnelPhase } from './tunnel'

/**
 * Craft's own prefix on everything `craft.storage` writes. Not ours to
 * choose — it is here because the Swift half has to look under the same one,
 * and a constant with a comment beats the string appearing twice.
 */
export const CRAFT_STORAGE_PREFIX = 'craft.native.storage.'

/** Where the screens leave a request. */
export const REQUEST_KEY = 'vpn.request'

/** Where Swift leaves the current state. A snapshot name, so no prefix. */
export const STATUS_SNAPSHOT = 'vpn-status'

/** The `UserDefaults` key a `craft.storage` key actually lands on. */
export function defaultsKey(key: string): string {
  return `${CRAFT_STORAGE_PREFIX}${key}`
}

export interface ConnectRequest {
  action: 'connect'
  region: string
  /** Where the screens believe this region exits, for the provider to use. */
  exitIp: string | null
  nonce: string
}

export interface DisconnectRequest {
  action: 'disconnect'
  nonce: string
}

export type TunnelRequest = ConnectRequest | DisconnectRequest

/**
 * What Swift reports back.
 *
 * `since` rather than a running uptime, because a status push every second
 * to carry a number the screens can work out themselves would be absurd —
 * and would make the tunnel's state churn in a way that is hard to read in a
 * log. The screens tick their own clock from this.
 */
export interface TunnelStatusFrame {
  phase: TunnelPhase
  region: string | null
  exitIp: string | null
  /** Why the last attempt failed, in words a person can read. */
  error: string | null
  /** Epoch milliseconds the tunnel came up, or null when it is not up. */
  since: number | null
}

/**
 * A value that makes two identical requests two events.
 *
 * Without it, connect us-west → disconnect → connect us-west writes the same
 * JSON the second time, `UserDefaults` sees no change, and the observer never
 * fires: the third tap would do nothing, intermittently, depending on what
 * the user did before it. Monotonic and random, so it is also unique across
 * a relaunch.
 */
export function nextNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Read a status frame written by the other process.
 *
 * Defensive to the point of paranoia, because the writer is a separate
 * binary that may be older than this one, may have been interrupted
 * mid-write, or may be absent entirely — and because the alternative to
 * returning null is a screen that throws during setup and renders nothing.
 */
export function parseStatus(raw: string | null | undefined): TunnelStatusFrame | null {
  if (typeof raw !== 'string' || raw.length === 0)
    return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object')
    return null

  const frame = parsed as Record<string, unknown>
  const phase = frame.phase
  if (phase !== 'idle' && phase !== 'connecting' && phase !== 'connected' && phase !== 'disconnecting')
    return null

  const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
  const since = typeof frame.since === 'number' && Number.isFinite(frame.since) ? frame.since : null

  return {
    phase,
    region: text(frame.region),
    exitIp: text(frame.exitIp),
    error: text(frame.error),
    // A tunnel that is not up has no start time, whatever it claims.
    since: phase === 'connected' ? since : null,
  }
}

/** Seconds since `since`, which is the uptime the screens display. */
export function uptimeFrom(since: number | null, now: number = Date.now()): number | null {
  if (since === null)
    return null
  return Math.max(0, Math.floor((now - since) / 1000))
}

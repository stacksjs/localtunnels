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
import type { CoordinatorPhase, TunnelPhase } from './tunnel'

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
  /**
   * The resolvers to use while connected, as addresses rather than a preset
   * name. The provider has no list to look a name up in — it is a separate
   * process with its own bundle — and sending the name would mean keeping
   * that list in a third place.
   */
  dns: string[]
  /** Whether the local network stays reachable while the tunnel is up. */
  allowLan: boolean
  /**
   * Where the coordinator for this region lives, and the secret to join it.
   *
   * Null until this device has been provisioned, which it has no way to be
   * yet — see `PROVISIONING.md`. Carried rather than baked into the build on
   * purpose: `authKey` is a shared secret, and a secret in a shipped binary
   * belongs to anyone who downloads it.
   */
  coordinatorUrl: string | null
  authKey: string | null
  /**
   * The only peer allowed to carry this device's traffic, or null to accept
   * whichever peer advertises itself.
   *
   * Pinned at pairing time, so it travels with the rest of the pairing.
   * `exitNode` is a claim the coordinator relays without checking and the
   * `authKey` above is what lets anybody make it — so with a key here the
   * provider refuses every other peer rather than preferring this one.
   */
  exitKey: string | null
  nonce: string
}

export interface DisconnectRequest {
  action: 'disconnect'
  nonce: string
}

/**
 * Throw away this device's key and generate another.
 *
 * The coordinator identifies a device by its public key and assigns an
 * address against it, so a new key is a new device: a fresh lease, and
 * whatever the old one was allowed stays allowed until somebody removes it
 * there. It is the answer to a key that has been somewhere it should not
 * have been, and nothing smaller.
 */
export interface ForgetIdentityRequest {
  action: 'forget-identity'
  nonce: string
}

/**
 * Forget the secret this device joins with.
 *
 * The other half of unpairing. The screens hold the coordinator's address
 * and the region in their own Keychain and can forget those themselves; the
 * secret has a second copy in the group the tunnel reads, which would
 * otherwise outlive the pairing it belongs to.
 */
export interface ForgetPairingRequest {
  action: 'forget-pairing'
  nonce: string
}

export type TunnelRequest = ConnectRequest | DisconnectRequest | ForgetIdentityRequest | ForgetPairingRequest

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
  /**
   * How the tunnel is getting on with its coordinator.
   *
   * Carried separately from `phase` because the two come apart in the one
   * failure worth a banner: a node dropped from the directory loses the
   * exit's route to it while iOS goes on reporting `connected`, since the
   * interface is up. The phase cannot say that and should not try.
   *
   * It also crosses a second process boundary to get here. The coordinator
   * lives in the extension; this frame is written by the app, which has to
   * ask — see `TunnelControl` and the provider's `handleAppMessage`.
   */
  coordinator: CoordinatorPhase | null
  region: string | null
  exitIp: string | null
  /** Why the last attempt failed, in words a person can read. */
  error: string | null
  /** Epoch milliseconds the tunnel came up, or null when it is not up. */
  since: number | null
  /**
   * This device's public key, as the coordinator knows it.
   *
   * Reported rather than read: the key lives in the Keychain and is the
   * tunnel's to generate, so the screens learn it the same way they learn
   * everything else about the tunnel. Null before one has been made.
   */
  deviceKey: string | null
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

  /*
   * An unrecognised coordinator phase reads as none at all.
   *
   * Not a reason to discard the frame: this field arrived after the others,
   * so a Swift half older or newer than these screens sends a frame without
   * it or with a word they have never heard of — and throwing the whole
   * thing away for that would lose the phase, the region and the error with
   * it. No banner is the right answer to not knowing.
   */
  const coordinator = frame.coordinator === 'joined' || frame.coordinator === 'retrying' || frame.coordinator === 'refused'
    ? frame.coordinator
    : null

  const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
  const since = typeof frame.since === 'number' && Number.isFinite(frame.since) ? frame.since : null

  return {
    phase,
    // A tunnel that is not up has not joined anything, whatever it says.
    coordinator: phase === 'idle' ? null : coordinator,
    region: text(frame.region),
    exitIp: text(frame.exitIp),
    error: text(frame.error),
    // A tunnel that is not up has no start time, whatever it claims.
    since: phase === 'connected' ? since : null,
    deviceKey: text(frame.deviceKey),
  }
}

/** Seconds since `since`, which is the uptime the screens display. */
export function uptimeFrom(since: number | null, now: number = Date.now()): number | null {
  if (since === null)
    return null
  return Math.max(0, Math.floor((now - since) / 1000))
}

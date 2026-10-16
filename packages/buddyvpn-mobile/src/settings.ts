/**
 * What a person is allowed to change, and what is deliberately not offered.
 *
 * A copy of the desktop app's shape rather than an import of it, for the
 * reason `regions.ts` gives: that package is a macOS bundle whose entry point
 * reaches for `node:os`. Keep the preset ids and their addresses in step with
 * `packages/buddyvpn/src/dns.ts` — a phone that asks for `quad9` and a helper
 * that has never heard of it is a connection that fails at the last step.
 *
 * ── What is missing, and why ───────────────────────────────────────────
 *
 * The kill switch and full-tunnel mode are not settings here, exactly as on
 * the desktop. An app whose whole purpose is "put my traffic somewhere else"
 * has no honest setting for "but not really", and a kill switch that is off
 * by default protects only the people who already knew to turn it on. The
 * screen says so rather than leaving their absence to be noticed.
 *
 * `launchAtLogin` is gone because iOS has no equivalent, and `showLocation`
 * because this app never asks a third party what address the world sees —
 * there is no tunnel for that request to travel through yet, and the screens
 * say the exit address is a claim.
 */

/** The resolvers this app will use, by name. */
export const DNS_PRESETS = {
  cloudflare: ['1.1.1.1', '1.0.0.1'],
  google: ['8.8.8.8', '8.8.4.4'],
  quad9: ['9.9.9.9', '149.112.112.112'],
} as const

export type DnsPreset = keyof typeof DNS_PRESETS

/**
 * Offered by name rather than as an address box.
 *
 * On the desktop the reason is that the choice reaches a command running as
 * root, and free text there would let anything point the machine at a
 * resolver of its own. Here it reaches a Network Extension through
 * `providerConfiguration`. The reasoning survives the move: a fixed list
 * means the worst a caller can do is pick a different well-known resolver.
 */
export const DNS_LABELS: Record<DnsPreset, string> = {
  cloudflare: 'Cloudflare',
  google: 'Google',
  quad9: 'Quad9',
}

export function isDnsPreset(value: unknown): value is DnsPreset {
  return typeof value === 'string' && value in DNS_PRESETS
}

/** The addresses for a preset, as the tunnel wants them. */
export function dnsServers(preset: DnsPreset): string[] {
  return [...DNS_PRESETS[preset]]
}

export interface Settings {
  /** Which resolver to use while connected. */
  dns: DnsPreset
  /** Let the local network through — printers, a NAS, AirPlay. */
  allowLan: boolean
  /** Connect as soon as the app opens. */
  autoConnect: boolean
}

export const DEFAULTS: Settings = {
  dns: 'cloudflare',
  // Off by default: a device on your LAN can see your real address, which is
  // most of what routing everything through a tunnel exists to prevent.
  allowLan: false,
  autoConnect: false,
}

/** Where the choices are kept. One key, so one parse and one write. */
const STORAGE_KEY = 'buddyvpn.settings'

/**
 * Validate a parsed settings object field by field.
 *
 * Anything unrecognised falls back to its default rather than failing the
 * read, which is the desktop's rule and matters more here: this value
 * survives app updates, and a field added or renamed in a later build must
 * not leave somebody with no settings at all. Rejecting the bad field beats
 * rejecting the file.
 */
export function parseSettings(parsed: unknown, fallback: Settings = DEFAULTS): Settings {
  if (!parsed || typeof parsed !== 'object')
    return { ...fallback }
  const raw = parsed as Record<string, unknown>
  const bool = (value: unknown, previous: boolean): boolean =>
    typeof value === 'boolean' ? value : previous

  return {
    dns: isDnsPreset(raw.dns) ? raw.dns : fallback.dns,
    allowLan: bool(raw.allowLan, fallback.allowLan),
    autoConnect: bool(raw.autoConnect, fallback.autoConnect),
  }
}

/** The current settings, read back rather than held in a module. */
export function readSettings(): Settings {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return stored ? parseSettings(JSON.parse(stored)) : { ...DEFAULTS }
  }
  catch {
    // Unparseable, or storage that throws in a private window. Neither is a
    // reason to show a screen with nothing on it.
    return { ...DEFAULTS }
  }
}

/**
 * Change settings, returning what was actually stored after validation.
 *
 * Returns the settings rather than a success flag, because every caller
 * wants to render the result and a failed write still has a correct answer:
 * the choice applies to this session, it just will not outlive it.
 */
export function writeSettings(patch: Partial<Settings>): Settings {
  const current = readSettings()
  /*
   * Validated against what is already in force, not against the defaults.
   *
   * The difference only shows on a bad field, and then it matters: someone
   * who had chosen Quad9 and hit a patch carrying a resolver this build does
   * not know would have had their choice replaced by Cloudflare — a setting
   * silently changed to something they never picked. Falling back to the
   * current value drops the bad field instead of the person's decision.
   */
  const next = parseSettings({ ...current, ...patch }, current)
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  catch {
    // As above.
  }
  return next
}

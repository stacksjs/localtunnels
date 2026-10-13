/**
 * What the user is allowed to change, and what is deliberately not offered.
 *
 * Two things a standard VPN client puts on this screen are missing on
 * purpose. The kill switch and full-tunnel mode are not settings: an app
 * whose whole purpose is "put my traffic somewhere else" has no honest
 * setting for "but not really", and a kill switch that is off by default
 * protects only the people who already knew to turn it on. The screen says so
 * rather than leaving their absence to be noticed.
 *
 * Two of these do reach the privileged helper, which is why neither is free
 * text. The helper takes a region and a short list of words it already knows;
 * a DNS box a caller could fill in would let anything running as this user
 * point the machine at a resolver of its choosing, without a password, which
 * is the one thing the helper exists to prevent.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DnsPreset } from './dns'
import { isDnsPreset } from './dns'
import { DEFAULT_REGION, REGIONS } from './regions'
import { appSupportDir } from './vpn/control'

export interface Settings {
  /** Which location the window starts on. */
  defaultRegion: string
  /** Connect as soon as the window opens. */
  autoConnect: boolean
  /** Start BuddyVPN when this user logs in. */
  launchAtLogin: boolean
  /** Let the local network through while the kill switch is armed. */
  allowLan: boolean
  /** Which resolver to use while connected. */
  dns: DnsPreset
  /** Ask a third party what address the internet sees. Off means do not ask. */
  showLocation: boolean
}

export const DEFAULTS: Settings = {
  defaultRegion: DEFAULT_REGION,
  autoConnect: false,
  launchAtLogin: false,
  allowLan: false,
  dns: 'cloudflare',
  showLocation: true,
}

export function settingsPath(): string {
  return path.join(appSupportDir(), 'settings.json')
}

/**
 * Validate a parsed settings object field by field.
 *
 * Anything unrecognised falls back to the default rather than failing the
 * read. This file is hand-editable and two of its values reach a root
 * command, so "reject the bad field" has to beat "reject the file": a single
 * typo should not leave the app with no settings at all, and must never leave
 * it with a value nobody checked.
 */
export function parseSettings(parsed: unknown): Settings {
  if (!parsed || typeof parsed !== 'object')
    return { ...DEFAULTS }
  const raw = parsed as Record<string, unknown>

  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback

  const region = typeof raw.defaultRegion === 'string'
    && REGIONS.some(entry => entry.id === raw.defaultRegion)
    ? raw.defaultRegion
    : DEFAULTS.defaultRegion

  const dns = isDnsPreset(raw.dns) ? raw.dns : DEFAULTS.dns

  return {
    defaultRegion: region,
    autoConnect: bool(raw.autoConnect, DEFAULTS.autoConnect),
    launchAtLogin: bool(raw.launchAtLogin, DEFAULTS.launchAtLogin),
    allowLan: bool(raw.allowLan, DEFAULTS.allowLan),
    dns,
    showLocation: bool(raw.showLocation, DEFAULTS.showLocation),
  }
}

export function readSettings(): Settings {
  try {
    return parseSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')))
  }
  catch {
    return { ...DEFAULTS }
  }
}

/** Write settings, returning what was actually stored after validation. */
export function writeSettings(patch: Partial<Settings>): Settings {
  const next = parseSettings({ ...readSettings(), ...patch })
  fs.mkdirSync(appSupportDir(), { recursive: true })
  fs.writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  return next
}

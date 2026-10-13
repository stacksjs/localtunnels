import { describe, expect, it } from 'bun:test'
import { DNS_PRESETS, dnsServers, isDnsPreset } from '../src/dns'
import { loginItemPlist, LOGIN_ITEM_LABEL } from '../src/login-item'
import { DEFAULTS, parseSettings } from '../src/settings'
import { parseLocation } from '../src/vpn/geo'

describe('parseSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    for (const input of [null, undefined, 'x', 42, []])
      expect(parseSettings(input)).toEqual(DEFAULTS)
  })

  /*
   * Field by field rather than all-or-nothing. This file is hand-editable
   * and two of its values reach a command running as root, so one bad field
   * must not leave the app with no settings — and must never leave it
   * carrying a value nobody checked.
   */
  it('keeps the good fields and defaults the bad ones', () => {
    const parsed = parseSettings({ autoConnect: true, dns: 'attacker', defaultRegion: 'atlantis' })
    expect(parsed.autoConnect).toBe(true)
    expect(parsed.dns).toBe(DEFAULTS.dns)
    expect(parsed.defaultRegion).toBe(DEFAULTS.defaultRegion)
  })

  it('refuses a region the app does not have', () => {
    expect(parseSettings({ defaultRegion: '../../etc/passwd' }).defaultRegion).toBe(DEFAULTS.defaultRegion)
  })

  it('refuses a non-boolean for a toggle rather than coercing it', () => {
    // `'false'` is truthy, so a coerced read would turn an off switch on.
    expect(parseSettings({ allowLan: 'false' }).allowLan).toBe(DEFAULTS.allowLan)
    expect(parseSettings({ showLocation: 0 }).showLocation).toBe(DEFAULTS.showLocation)
  })
})

describe('the DNS choice is a name, never an address', () => {
  /*
   * The value reaches a root command. Free text there would let anything
   * running as this user repoint the machine at a resolver of its own with
   * no password, which is the one thing the helper exists to prevent.
   */
  it('admits only the presets', () => {
    expect(isDnsPreset('cloudflare')).toBe(true)
    expect(isDnsPreset('1.1.1.1')).toBe(false)
    expect(isDnsPreset('cloudflare; rm -rf /')).toBe(false)
    expect(isDnsPreset('')).toBe(false)
  })

  it('resolves a name to addresses the caller never supplied', () => {
    expect(dnsServers('cloudflare')).toBe('1.1.1.1,1.0.0.1')
    for (const servers of Object.values(DNS_PRESETS))
      expect(servers.every(ip => /^[\d.]+$/.test(ip))).toBe(true)
  })
})

describe('parseLocation', () => {
  it('reads a real ipinfo payload', () => {
    const parsed = parseLocation({ ip: '5.78.208.190', city: 'Hillsboro', region: 'Oregon', country: 'US', org: 'AS212317 Hetzner' })
    expect(parsed).toEqual({ ip: '5.78.208.190', city: 'Hillsboro', region: 'Oregon', country: 'US', org: 'AS212317 Hetzner' })
  })

  it('needs an address to be an answer at all', () => {
    expect(parseLocation({ city: 'Nowhere' })).toBeNull()
    expect(parseLocation(null)).toBeNull()
  })

  it('reports missing fields as null rather than as empty strings', () => {
    // A reserved or unrouted address comes back with an ip and little else.
    expect(parseLocation({ ip: '10.0.0.1', city: '  ' })?.city).toBeNull()
  })
})

describe('loginItemPlist', () => {
  it('launches the bundle through open, not the binary', () => {
    // A GUI app started outside a login session gets no window server, and
    // launchd would restart the corpse on a loop.
    const plist = loginItemPlist('/Applications/BuddyVPN.app')
    expect(plist).toContain('<string>/usr/bin/open</string>')
    expect(plist).toContain('<string>/Applications/BuddyVPN.app</string>')
    expect(plist).toContain(LOGIN_ITEM_LABEL)
  })

  it('escapes a path for XML, so one with an ampersand still parses', () => {
    expect(loginItemPlist('/Users/a&b/BuddyVPN.app')).toContain('/Users/a&amp;b/BuddyVPN.app')
  })
})

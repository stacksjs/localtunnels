/**
 * What a person changed, read back after an update.
 *
 * The rule these enforce is the desktop app's: reject the bad field, never
 * the file. This value outlives app versions — a field added, renamed or
 * dropped in a later build must not leave somebody with no settings at all,
 * and must never leave them with a value nobody checked, because two of
 * these reach a Network Extension through `providerConfiguration`.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import {
  DEFAULTS,
  dnsServers,
  isDnsPreset,
  parseSettings,
  readSettings,
  writeSettings,
} from '../src/settings'

/** A localStorage that remembers, and reports what ended up in it. */
function store(initial: string | null = null): () => string | null {
  let value = initial
  ;(globalThis as any).localStorage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
  }
  return () => value
}

afterEach(() => {
  delete (globalThis as any).localStorage
})

describe('the resolvers', () => {
  /*
   * These ids and addresses reach a helper on the desktop and an extension
   * here. A phone that asks for a preset the other side has never heard of
   * is a connection that fails at the last step.
   */
  it('are the three the desktop app knows, by the same names', () => {
    expect(isDnsPreset('cloudflare')).toBe(true)
    expect(isDnsPreset('google')).toBe(true)
    expect(isDnsPreset('quad9')).toBe(true)
  })

  it('refuses anything else, which is the whole point of a fixed list', () => {
    expect(isDnsPreset('my-own-resolver')).toBe(false)
    expect(isDnsPreset('1.1.1.1')).toBe(false)
    expect(isDnsPreset(null)).toBe(false)
    expect(isDnsPreset(undefined)).toBe(false)
  })

  it('carries a primary and a fallback address', () => {
    expect(dnsServers('cloudflare')).toEqual(['1.1.1.1', '1.0.0.1'])
    expect(dnsServers('quad9')).toEqual(['9.9.9.9', '149.112.112.112'])
  })
})

describe('reading what was stored', () => {
  it('reads back what was written', () => {
    store(JSON.stringify({ dns: 'quad9', allowLan: true, autoConnect: true }))
    expect(readSettings()).toEqual({ dns: 'quad9', allowLan: true, autoConnect: true })
  })

  it('is the defaults when nothing has been stored', () => {
    store(null)
    expect(readSettings()).toEqual(DEFAULTS)
  })

  /*
   * The LAN rule is the one default that is a safety decision rather than a
   * preference: a device on your network can see your real address, which is
   * most of what routing everything through a tunnel exists to prevent.
   */
  it('leaves the local network closed until someone opens it', () => {
    expect(DEFAULTS.allowLan).toBe(false)
  })

  it('survives a stored value that is not JSON', () => {
    store('{"dns":"quad')
    expect(readSettings()).toEqual(DEFAULTS)
  })

  // Private windows and cleared site data throw rather than return null.
  it('survives storage that throws', () => {
    ;(globalThis as any).localStorage = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
    }
    expect(readSettings()).toEqual(DEFAULTS)
    expect(writeSettings({ dns: 'google' })).toEqual({ ...DEFAULTS, dns: 'google' })
  })
})

describe('validating a field at a time', () => {
  it('keeps the good fields of an object with a bad one', () => {
    const parsed = parseSettings({ dns: 'atlantis', allowLan: true, autoConnect: true })
    expect(parsed).toEqual({ dns: DEFAULTS.dns, allowLan: true, autoConnect: true })
  })

  it('refuses a boolean that is not one', () => {
    const parsed = parseSettings({ allowLan: 'yes', autoConnect: 1 })
    expect(parsed.allowLan).toBe(false)
    expect(parsed.autoConnect).toBe(false)
  })

  it('ignores fields it has never heard of', () => {
    const parsed = parseSettings({ dns: 'google', killSwitch: false, launchAtLogin: true })
    expect(parsed).toEqual({ ...DEFAULTS, dns: 'google' })
    expect('killSwitch' in parsed).toBe(false)
  })

  it('is the defaults for anything that is not an object', () => {
    for (const value of [null, undefined, 'settings', 42, []])
      expect(parseSettings(value).dns).toBe(DEFAULTS.dns)
  })
})

describe('changing one thing', () => {
  it('leaves the others alone', () => {
    store(JSON.stringify({ dns: 'quad9', allowLan: true, autoConnect: false }))
    const next = writeSettings({ autoConnect: true })
    expect(next).toEqual({ dns: 'quad9', allowLan: true, autoConnect: true })
  })

  /*
   * Returns the settings rather than a success flag, because every caller
   * renders the result — and a write that failed still has a correct answer
   * to show: the choice holds for this session, it just will not outlive it.
   */
  it('answers with what is now in force', () => {
    const current = store(null)
    expect(writeSettings({ dns: 'google' }).dns).toBe('google')
    expect(JSON.parse(current()!).dns).toBe('google')
  })

  /*
   * A bad field drops, the person's decision does not. Validating against
   * the defaults instead would replace a chosen Quad9 with Cloudflare — a
   * setting silently changed to one they never picked.
   */
  it('refuses a resolver it does not know and keeps the one in force', () => {
    store(JSON.stringify({ dns: 'quad9', allowLan: true, autoConnect: false }))
    const next = writeSettings({ dns: 'atlantis' as never })
    expect(next.dns).toBe('quad9')
    expect(next.allowLan).toBe(true)
  })

  it('still falls back to the defaults when there is nothing in force', () => {
    store(null)
    expect(writeSettings({ dns: 'atlantis' as never }).dns).toBe(DEFAULTS.dns)
  })
})

/**
 * The wire between two processes.
 *
 * Everything here is about not trusting the other end. The screens are
 * JavaScript in the app; the tunnel is Swift driving a Network Extension.
 * They do not share memory, and after an update they are not necessarily the
 * same build — so a status frame can be older than the code reading it, can
 * be half-written, or can be missing because the extension has never run.
 * A screen that throws on any of those renders nothing at all, which is a
 * worse outcome than showing a tunnel as down.
 */
import { describe, expect, it } from 'bun:test'
import {
  CRAFT_STORAGE_PREFIX,
  defaultsKey,
  nextNonce,
  parseStatus,
  REQUEST_KEY,
  uptimeFrom,
} from '../src/tunnel-bridge'

describe('where the request lands', () => {
  /*
   * Craft prefixes everything `craft.storage` writes. The Swift half watches
   * UserDefaults directly, so it has to look under the same prefix — this is
   * the one place the two halves must agree character for character.
   */
  it('is Craft’s prefix plus our key', () => {
    expect(defaultsKey(REQUEST_KEY)).toBe('craft.native.storage.vpn.request')
    expect(CRAFT_STORAGE_PREFIX).toBe('craft.native.storage.')
  })
})

describe('the nonce', () => {
  /*
   * The bug it exists for: connect us-west, disconnect, connect us-west
   * writes identical JSON the second time. UserDefaults sees no change, the
   * observer never fires, and the third tap does nothing — intermittently,
   * depending on what the person did before it.
   */
  it('differs between two otherwise identical requests', () => {
    const seen = new Set(Array.from({ length: 200 }, () => nextNonce()))
    expect(seen.size).toBe(200)
  })
})

describe('reading a status frame', () => {
  const connected = JSON.stringify({
    phase: 'connected',
    region: 'us-west',
    exitIp: '5.78.208.190',
    error: null,
    since: 1_700_000_000_000,
  })

  it('reads one the other process wrote', () => {
    expect(parseStatus(connected)).toEqual({
      phase: 'connected',
      region: 'us-west',
      exitIp: '5.78.208.190',
      error: null,
      since: 1_700_000_000_000,
    })
  })

  // The extension has never run, or its snapshot was cleared.
  it('treats absence as no status rather than an error', () => {
    expect(parseStatus(null)).toBeNull()
    expect(parseStatus(undefined)).toBeNull()
    expect(parseStatus('')).toBeNull()
  })

  // Interrupted mid-write, or written by something that is not us.
  it('refuses what it cannot read', () => {
    expect(parseStatus('{"phase":"conn')).toBeNull()
    expect(parseStatus('null')).toBeNull()
    expect(parseStatus('"connected"')).toBeNull()
    expect(parseStatus('[]')).toBeNull()
  })

  /*
   * A phase from a newer build, or a typo in a hand-edited snapshot. There is
   * no sensible way to render an unknown phase, and guessing at the nearest
   * one would put the wrong word above the button.
   */
  it('refuses a phase it does not know', () => {
    expect(parseStatus(JSON.stringify({ phase: 'reconnecting' }))).toBeNull()
    expect(parseStatus(JSON.stringify({ phase: 42 }))).toBeNull()
  })

  it('fills in what a sparse frame leaves out', () => {
    expect(parseStatus(JSON.stringify({ phase: 'idle' }))).toEqual({
      phase: 'idle',
      region: null,
      exitIp: null,
      error: null,
      since: null,
    })
  })

  // Empty strings are what a Swift optional often becomes on the way out.
  it('treats an empty string as absent', () => {
    const frame = parseStatus(JSON.stringify({ phase: 'idle', region: '', exitIp: '', error: '' }))
    expect(frame).toEqual({ phase: 'idle', region: null, exitIp: null, error: null, since: null })
  })

  /*
   * A start time on a tunnel that is not up would run a clock over a
   * disconnected screen. Whatever the frame claims, only a connected tunnel
   * has been up for any length of time.
   */
  it('ignores a start time unless the tunnel is up', () => {
    const frame = parseStatus(JSON.stringify({ phase: 'connecting', since: 1_700_000_000_000 }))
    expect(frame?.since).toBeNull()
  })

  it('ignores a start time that is not a finite number', () => {
    for (const since of ['soon', null, {}]) {
      const frame = parseStatus(JSON.stringify({ phase: 'connected', since }))
      expect(frame?.since).toBeNull()
    }
  })

  it('keeps an error so the screen can show it', () => {
    const frame = parseStatus(JSON.stringify({ phase: 'idle', error: 'Permission denied' }))
    expect(frame?.error).toBe('Permission denied')
  })
})

describe('uptime', () => {
  it('counts whole seconds from the start time', () => {
    expect(uptimeFrom(1000, 61_000)).toBe(60)
  })

  it('is nothing when the tunnel is not up', () => {
    expect(uptimeFrom(null)).toBeNull()
  })

  /*
   * Clocks move backwards — NTP, a timezone change, a device asleep across a
   * correction. A negative uptime would render as a stray minus sign on the
   * one number people watch.
   */
  it('never goes negative when the clock moves backwards', () => {
    expect(uptimeFrom(10_000, 5_000)).toBe(0)
  })
})

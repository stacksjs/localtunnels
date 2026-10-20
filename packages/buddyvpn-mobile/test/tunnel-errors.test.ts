/**
 * Why the tunnel stopped, and how a person ever finds out.
 *
 * A provider that refuses to start hands its reason to a completion handler
 * and the connection then goes to `disconnected` — exactly as it would after
 * somebody tapped the button. `NEVPNConnection` has no property holding the
 * reason, so a reason not fetched is a reason nobody will ever read, and
 * every sentence in `TunnelStartFailure` was written for somebody to read.
 * One of them explains that re-pairing is how you change which server a
 * device trusts, which is not a thing anyone could work out from a tunnel
 * that quietly returned to idle.
 *
 * Read as text, because this Swift runs in the app half of a Network
 * Extension pair and compiles against iOS SDKs. What that pins is the three
 * decisions, each of which is a thing someone could reasonably undo:
 * fetching the reason at all, holding it past the status change that reports
 * it, and clearing it when the next attempt starts.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTROL = readFileSync(join(PACKAGE_DIR, 'native', 'ios', 'TunnelControl.swift'), 'utf8')

describe('why the tunnel stopped', () => {
  /*
   * The regression. `publish()` reported `error: nil` on every status
   * change, so a provider that refused to start looked exactly like a
   * tunnel returning to idle — and every sentence in `TunnelStartFailure`
   * was written for somebody who would never see it.
   */
  it('is fetched from the system, which is the only place it exists', () => {
    expect(CONTROL).toContain('connection.fetchLastDisconnectError')
    expect(CONTROL).toMatch(/case \.disconnected:\s*\n\s*readDisconnectReason\(\)/)
  })

  /*
   * Held until the next attempt rather than published once. The two halves
   * of a failure arrive separately: this process's own refusals immediately,
   * the provider's only after the status change that would have cleared a
   * one-shot.
   */
  it('survives the status change that reports it', () => {
    expect(CONTROL).toContain('private var lastError: String?')
    expect(CONTROL).toContain('"error": lastError ?? NSNull()')
  })

  // A reason this process already has is more specific than the system's
  // account of a tunnel that stopped, and describes something that happened
  // before the provider ever ran.
  it('does not overwrite a more specific reason', () => {
    expect(CONTROL).toMatch(/if self\.lastError == nil \{\s*\n\s*self\.lastError = self\.describe\(error\)/)
  })

  /*
   * And cleared when a new attempt starts, in both places that counts: the
   * request, because Face ID takes long enough to read, and the status
   * reaching `connecting` or `connected`.
   */
  it('is cleared when another attempt begins', () => {
    const connect = /private func connect\(region: String,[\s\S]*?publish\(\)\n/.exec(CONTROL)
    expect(connect).not.toBeNull()
    expect(connect![0]).toContain('lastError = nil')
    expect(CONTROL).toMatch(/case \.connecting, \.connected:[\s\S]{0,400}?lastError = nil/)
  })
})

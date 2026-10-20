/**
 * Does the Swift even parse?
 *
 * Every other test here reads the Swift as text, which is the only option:
 * it compiles against iOS SDKs and runs in a Network Extension on a phone.
 * Reading it has found real bugs, and it cannot find a typo, so a file can
 * satisfy every contract in this directory and still not build — the first
 * anyone would know of it is an Xcode error on the next device build, or a
 * CI job that never runs it at all.
 *
 * `swiftc -parse` is the cheapest real answer. It checks syntax without
 * resolving a single import, so it needs no iOS SDK, no bridging header and
 * no libltvpn: `NEPacketTunnelProvider` and `ltvpn_pubkey` are unresolved
 * names to it and that is fine. What it catches is the class of mistake that
 * reading cannot — an unterminated string, a brace that does not close, and
 * `"—"`, which is a perfectly good escape in most languages and not one
 * Swift has.
 *
 * Skipped where there is no `swiftc`, which includes Linux CI. A check that
 * only runs on the machines that can run it is worth more than no check.
 */
import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'ios')

/** Whether this machine can parse Swift at all. */
function hasSwift(): boolean {
  const probe = spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' })
  return probe.status === 0
}

const sources = readdirSync(NATIVE).filter(name => name.endsWith('.swift'))

describe('the native sources', () => {
  // A directory that has quietly become empty would otherwise pass
  // everything, here and in every contract test that reads these files.
  it('are there to be checked', () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  it.skipIf(!hasSwift()).each(sources)('%s parses', (name) => {
    const parsed = spawnSync('xcrun', ['swiftc', '-parse', join(NATIVE, name)], { encoding: 'utf8' })
    // Printed in full rather than asserted on: the next person to see this
    // wants the compiler's words, not a boolean.
    expect({ name, status: parsed.status, output: `${parsed.stderr}${parsed.stdout}`.trim() })
      .toEqual({ name, status: 0, output: '' })
  })
})

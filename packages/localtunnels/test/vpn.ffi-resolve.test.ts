/* eslint-disable node/prefer-global/process */
import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import process from 'node:process'
import { suffix } from 'bun:ffi'
import { candidatePaths } from '../src/vpn'

/**
 * Where the native library is looked for.
 *
 * This is the resolution that was broken for every binary `bun run compile`
 * produced: each candidate was derived from `import.meta.url`, which inside a
 * single-file binary points into the embedded filesystem rather than at a
 * directory on disk. All six collapsed to paths like
 * `/dist/native/libltvpn.dylib`, so a shipped binary had no VPN at all and
 * said so by listing six places that could never have held anything.
 */
describe('vpn/ffi library resolution', () => {
  const LIB = `libltvpn.${suffix}`

  it('looks beside the executable, which is the only layout a compiled binary has', () => {
    const execDir = dirname(process.execPath)
    const paths = candidatePaths()

    expect(paths).toContain(join(execDir, LIB))
    expect(paths).toContain(join(execDir, '..', 'lib', LIB))
  })

  it('tries the executable before anything derived from the source path', () => {
    // Order is the fix: a compiled binary never reaches the source-relative
    // candidates, so they must not be what it tries first.
    const paths = candidatePaths().filter(p => p !== process.env.LTVPN_LIB)
    const execDir = dirname(process.execPath)

    expect(paths[0]).toBe(join(execDir, LIB))
    expect(paths[1]).toBe(join(execDir, '..', 'lib', LIB))
  })

  it('honours LTVPN_LIB ahead of everything', () => {
    const original = process.env.LTVPN_LIB
    process.env.LTVPN_LIB = '/tmp/some/explicit/libltvpn.dylib'
    try {
      expect(candidatePaths()[0]).toBe('/tmp/some/explicit/libltvpn.dylib')
    }
    finally {
      if (original === undefined)
        delete process.env.LTVPN_LIB
      else process.env.LTVPN_LIB = original
    }
  })

  it('names every candidate absolutely, so the cwd cannot change the answer', () => {
    for (const p of candidatePaths())
      expect(isAbsolute(p)).toBe(true)
  })

  it('lists no candidate twice, so a failure reads as distinct attempts', () => {
    const paths = candidatePaths()
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('derives source-relative candidates only from a real package root', () => {
    // The guard against the compiled case: there, both roots collapse to `/`,
    // and `/package.json` does not exist. Testing that the directory exists
    // was not enough — the embedded filesystem answers that happily.
    const execDir = dirname(process.execPath)
    const fromSource = candidatePaths().filter(p =>
      p !== process.env.LTVPN_LIB
      && p !== join(execDir, LIB)
      && p !== join(execDir, '..', 'lib', LIB),
    )

    for (const p of fromSource) {
      // Each is <root>/dist/native/LIB, <root>/native/zig-out/lib/LIB or
      // <root>/../vpn-core/zig-out/lib/LIB — walk back up to the root.
      const root = p.includes(`${'vpn-core'}/`)
        ? join(dirname(p), '..', '..', '..', '..')
        : p.includes('zig-out')
          ? join(dirname(p), '..', '..', '..')
          : join(dirname(p), '..', '..')
      expect(existsSync(join(root, 'package.json'))).toBe(true)
    }
  })

  it('finds the monorepo build in a dev checkout', () => {
    // Running from source, the vpn-core build has to be reachable or every
    // other VPN test in this suite would be skipping for the wrong reason.
    expect(candidatePaths().some(p => p.includes('vpn-core'))).toBe(true)
  })
})

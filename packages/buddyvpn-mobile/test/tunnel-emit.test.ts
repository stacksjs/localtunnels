/**
 * The function that actually writes the extension, run against a real
 * directory.
 *
 * Everything else about this emitter is tested as pure functions, and they
 * are the easy half: `tunnelInfoPlist` returning the right object proves
 * nothing about a file landing on disk, parsing as a plist, or a source
 * reaching the target that compiles it. The bug that cost a cycle was in
 * this half — `TunnelSession.swift` was emitted into no target and compiled
 * to zero symbols, from a copy list that had been updated in one place.
 * `assertEveryNativeSourceIsClaimed` was the answer to it and catches a file
 * claimed by nobody; it cannot catch a claimed file that does not arrive, a
 * plist that writes malformed, or a merge that eats Craft's entitlements.
 *
 * It had no test because it cross-compiles the Zig core first, which needs
 * the iOS SDK and takes a while. That is now a parameter, so the rest runs
 * in a temp directory in milliseconds.
 *
 * macOS only: reading and writing a plist here goes through `plutil`, which
 * is the point — a `plutil` round-trip is the check that these files are
 * well-formed, and an XML parser agreeing with itself is not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  emitTunnelExtension,
  EXTENSION_POINT,
  planTunnel,
  readPlist,
  removeTunnelExtension,
} from '../scripts/ios-tunnel-extension'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NATIVE_DIR = join(PACKAGE_DIR, 'native', 'ios')
const PLAN = planTunnel('BuddyVPN', 'org.localtunnels.buddyvpn')
const onMac = process.platform === 'darwin'

/** A generated `ios/` as Craft leaves it, minus everything not read here. */
function craftOutput(): string {
  const dir = mkdtempSync(join(tmpdir(), 'buddyvpn-emit-'))
  writeFileSync(join(dir, 'project.yml'), [
    'name: BuddyVPN',
    'targets:',
    '  BuddyVPN:',
    '    type: application',
    '    platform: iOS',
    '    sources:',
    '      - Sources',
    '',
  ].join('\n'))
  // Craft's own, with its access group in it — the thing the merge must not
  // drop, since secure storage depends on it.
  writeFileSync(join(dir, 'Craft.entitlements'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '<key>keychain-access-groups</key>',
    '<array><string>$(AppIdentifierPrefix)$(CFBundleIdentifier)</string></array>',
    '</dict></plist>',
    '',
  ].join('\n'))
  return dir
}

/** A stand-in for the cross-compiled core, so no Zig runs here. */
function stubCore(root: string): string {
  const framework = join(root, 'libltvpn.xcframework')
  mkdirSync(framework, { recursive: true })
  writeFileSync(join(framework, 'Info.plist'), '<plist version="1.0"><dict/></plist>\n')
  return framework
}

describe('emitting the extension', () => {
  let output = ''
  let core = ''

  beforeEach(() => {
    if (!onMac)
      return
    output = craftOutput()
    core = stubCore(mkdtempSync(join(tmpdir(), 'buddyvpn-core-')))
  })

  afterEach(() => {
    for (const dir of [output, core ? dirname(core) : ''])
      if (dir) rmSync(dir, { recursive: true, force: true })
  })

  /*
   * Every tracked source has to land in a target that compiles it. A file
   * copied nowhere is not a build error — it is a symbol that does not
   * exist, discovered as a link failure with no filename in it.
   */
  it.skipIf(!onMac)('puts every native source in a target', () => {
    emitTunnelExtension(output, PLAN, core)
    const tracked = readdirSync(NATIVE_DIR).filter(name => /\.(?:swift|m|h)$/.test(name))
    const emitted = new Set([
      ...readdirSync(join(output, 'Tunnel')),
      ...readdirSync(join(output, 'Bridge')),
    ])
    for (const name of tracked)
      expect({ name, emitted: emitted.has(name) }).toEqual({ name, emitted: true })
  })

  // The two halves are different processes, and a file in the wrong one is a
  // link error at best and the app linking the crypto core at worst.
  it.skipIf(!onMac)('puts the provider in the extension and the manager in the app', () => {
    emitTunnelExtension(output, PLAN, core)
    const tunnel = readdirSync(join(output, 'Tunnel'))
    const bridge = readdirSync(join(output, 'Bridge'))
    expect(tunnel).toContain('PacketTunnelProvider.swift')
    expect(tunnel).toContain('DeviceIdentity.swift')
    expect(bridge).toContain('TunnelControl.swift')
    expect(bridge).toContain('TunnelBootstrap.m')
    // Both, because both processes read the Keychain.
    expect(tunnel).toContain('DeviceIdentityStore.swift')
    expect(bridge).toContain('DeviceIdentityStore.swift')
    // Never the app: it does not link libltvpn, which is why the generator
    // and the store are separate files at all.
    expect(bridge).not.toContain('DeviceIdentity.swift')
  })

  /*
   * A `plutil` round-trip, which is the half a pure function cannot check.
   * An Info.plist Xcode cannot read is an extension iOS will not load, and
   * the only symptom is a VPN that never starts.
   */
  it.skipIf(!onMac)('writes an Info.plist that says what this process is', () => {
    emitTunnelExtension(output, PLAN, core)
    const plist = readPlist(join(output, 'Tunnel', 'Info.plist'))
    expect(plist.CFBundlePackageType).toBe('XPC!')
    const extension = plist.NSExtension as Record<string, unknown>
    expect(extension.NSExtensionPointIdentifier).toBe(EXTENSION_POINT)
    /*
     * Module-qualified. A Swift class named without `$(PRODUCT_MODULE_NAME)`
     * is not found at launch, and `PacketTunnelProvider` carries no
     * `@objc(...)` that would give it an unqualified name.
     */
    expect(extension.NSExtensionPrincipalClass).toBe('$(PRODUCT_MODULE_NAME).PacketTunnelProvider')
  })

  it.skipIf(!onMac)('writes entitlements both processes can read the key through', () => {
    emitTunnelExtension(output, PLAN, core)
    const shared = '$(AppIdentifierPrefix)org.localtunnels.buddyvpn.shared'
    const extension = readPlist(join(output, 'Tunnel', 'BuddyVPNTunnel.entitlements'))
    const app = readPlist(join(output, 'Craft.entitlements'))
    expect(extension['keychain-access-groups']).toContain(shared)
    expect(app['keychain-access-groups']).toContain(shared)
    // Craft's own, which the merge exists not to drop.
    expect(app['keychain-access-groups']).toContain('$(AppIdentifierPrefix)$(CFBundleIdentifier)')
    for (const plist of [extension, app])
      expect(plist['com.apple.developer.networking.networkextension']).toEqual(['packet-tunnel-provider'])
  })

  // An entitlement nothing uses still has to be provisioned, or signing
  // fails — on the first device build, for a container nothing opens.
  it.skipIf(!onMac)('asks for no App Group', () => {
    emitTunnelExtension(output, PLAN, core)
    for (const path of [['Tunnel', 'BuddyVPNTunnel.entitlements'], ['Craft.entitlements']])
      expect(readPlist(join(output, ...path))['com.apple.security.application-groups']).toBeUndefined()
  })

  /*
   * Generated directories are emptied, not written into. A source renamed or
   * split in two otherwise stays behind and is still compiled, which is how
   * a type that moved between files became `invalid redeclaration` in a
   * build whose sources were correct.
   */
  it.skipIf(!onMac)('clears what a previous emit left behind', () => {
    emitTunnelExtension(output, PLAN, core)
    writeFileSync(join(output, 'Tunnel', 'OldName.swift'), '// renamed away\n')
    emitTunnelExtension(output, PLAN, core)
    expect(readdirSync(join(output, 'Tunnel'))).not.toContain('OldName.swift')
  })

  // Twice is an ordinary thing to do, and must not produce two targets.
  it.skipIf(!onMac)('is idempotent', () => {
    const first = emitTunnelExtension(output, PLAN, core)
    const project = Bun.file(join(output, 'project.yml'))
    const after = emitTunnelExtension(output, PLAN, core)
    expect(after).toEqual(first)
    expect(project).toBeDefined()
    expect(existsSync(join(output, 'libltvpn.xcframework'))).toBe(true)
  })

  /*
   * And taken back out. This is the one that bites: a stale network
   * entitlement fails to sign against a profile that does not carry it, so
   * turning the capability off while the key stays breaks every device build
   * while the config says the feature is off.
   */
  it.skipIf(!onMac)('removes cleanly, entitlement included', () => {
    emitTunnelExtension(output, PLAN, core)
    removeTunnelExtension(output, PLAN)
    expect(existsSync(join(output, 'Tunnel'))).toBe(false)
    expect(existsSync(join(output, 'Bridge'))).toBe(false)
    const app = readPlist(join(output, 'Craft.entitlements'))
    expect(app['com.apple.developer.networking.networkextension']).toBeUndefined()
    // Craft's group survives: removing the key outright would turn a
    // capability being switched off into the Keychain being switched off.
    expect(app['keychain-access-groups']).toEqual(['$(AppIdentifierPrefix)$(CFBundleIdentifier)'])
  })
})

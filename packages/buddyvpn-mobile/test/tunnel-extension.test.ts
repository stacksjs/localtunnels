/**
 * The second target, and what it must not disturb.
 *
 * None of this can be checked by running it: the extension needs an
 * entitlement Apple has not granted, a paid account, and a physical device,
 * because Network Extensions do not run in the Simulator at all. What can be
 * checked is the shape of what the build emits — which is most of what goes
 * wrong with an app extension, since a wrong bundle id or a missing extension
 * point produces a target that builds cleanly and is never started.
 */
import { describe, expect, it } from 'bun:test'
import {
  assertEveryNativeSourceIsClaimed,
  BRIDGE_DIR,
  CORE_FRAMEWORK,
  EXTENSION_POINT,
  planTunnel,
  tunnelEntitlements,
  tunnelInfoPlist,
  withNetworkEntitlements,
  withoutNetworkEntitlements,
  withoutTunnelTarget,
  withTunnelTarget,
} from '../scripts/ios-tunnel-extension'

const PLAN = planTunnel('BuddyVPN', 'org.localtunnels.buddyvpn')

/** A project.yml of the shape Craft's `init` writes. */
function craftProject(): any {
  return {
    name: 'BuddyVPN',
    targets: {
      BuddyVPN: {
        type: 'application',
        platform: 'iOS',
        sources: ['Sources', 'Shared'],
        settings: { PRODUCT_BUNDLE_IDENTIFIER: 'org.localtunnels.buddyvpn' },
      },
    },
    schemes: { BuddyVPN: { build: { targets: { BuddyVPN: 'all' } } } },
  }
}

describe('the plan', () => {
  /*
   * iOS requires an extension's bundle id to be the container app's plus one
   * component. A sibling id installs, builds and signs, and the system then
   * declines to start the extension.
   */
  it('puts the extension under the app', () => {
    expect(PLAN.tunnelBundleId).toBe('org.localtunnels.buddyvpn.tunnel')
    expect(PLAN.tunnelBundleId.startsWith(`${PLAN.bundleId}.`)).toBe(true)
  })

  it('shares a group container, which is the only place both processes reach', () => {
    expect(PLAN.appGroup).toBe('group.org.localtunnels.buddyvpn')
  })
})

describe('the project', () => {
  /*
   * The protocol core, cross-compiled for iOS. `embed: false` because the
   * slices hold static archives — the code is linked into the extension's
   * binary, and an embedded copy would be a second one nothing opens.
   */
  it('links the VPN core into the provider', () => {
    const target = withTunnelTarget(craftProject(), PLAN).targets.BuddyVPNTunnel
    expect(target.dependencies).toEqual([{ framework: CORE_FRAMEWORK, embed: false }])
    expect(CORE_FRAMEWORK).toBe('libltvpn.xcframework')
  })

  // Swift reaches C through a bridging header, and without this setting the
  // provider compiles until the first ltvpn_ call and then does not.
  it('gives the provider a bridging header', () => {
    const target = withTunnelTarget(craftProject(), PLAN).targets.BuddyVPNTunnel
    expect(target.settings.SWIFT_OBJC_BRIDGING_HEADER).toBe('Tunnel/Tunnel-Bridging-Header.h')
  })

  it('adds an app-extension target with its own entitlements and plist', () => {
    const target = withTunnelTarget(craftProject(), PLAN).targets.BuddyVPNTunnel
    expect(target.type).toBe('app-extension')
    expect(target.settings.PRODUCT_BUNDLE_IDENTIFIER).toBe('org.localtunnels.buddyvpn.tunnel')
    expect(target.settings.INFOPLIST_FILE).toBe('Tunnel/Info.plist')
    expect(target.settings.CODE_SIGN_ENTITLEMENTS).toBe('Tunnel/BuddyVPNTunnel.entitlements')
  })

  /*
   * Without `embed` the extension builds and is left behind: the app ships
   * with no PlugIns directory and the system has nothing to start.
   */
  it('makes the app depend on it and embed it', () => {
    const app = withTunnelTarget(craftProject(), PLAN).targets.BuddyVPN
    expect(app.dependencies).toEqual([{ target: 'BuddyVPNTunnel', embed: true }])
  })

  // This runs on every build over a project.yml written once, so a second
  // pass has to produce the same project rather than a second dependency.
  it('is idempotent', () => {
    const once = withTunnelTarget(craftProject(), PLAN)
    expect(withTunnelTarget(once, PLAN)).toEqual(once)
  })

  /*
   * The app's half of the tunnel compiles into the app, not the extension:
   * NETunnelProviderManager lives in the container app and the provider lives
   * in the extension, and putting either in the other's target is a mistake
   * that builds cleanly.
   */
  it('adds the bridge sources to the app target', () => {
    const app = withTunnelTarget(craftProject(), PLAN).targets.BuddyVPN
    expect(app.sources).toEqual(['Sources', 'Shared', BRIDGE_DIR])
  })

  it('leaves the app target otherwise alone', () => {
    const app = withTunnelTarget(craftProject(), PLAN).targets.BuddyVPN
    expect(app.settings.PRODUCT_BUNDLE_IDENTIFIER).toBe('org.localtunnels.buddyvpn')
    expect(app.type).toBe('application')
  })

  it('refuses a project whose app target it cannot find', () => {
    expect(() => withTunnelTarget({ targets: {} }, PLAN)).toThrow(/no target named BuddyVPN/)
  })
})

describe('the Info.plist', () => {
  /*
   * The extension point is how the system decides what this process is. A
   * provider without it is an extension of no kind, which is loaded by
   * nothing.
   */
  it('declares the packet tunnel extension point', () => {
    const extension = tunnelInfoPlist(PLAN).NSExtension as Record<string, string>
    expect(extension.NSExtensionPointIdentifier).toBe(EXTENSION_POINT)
    expect(EXTENSION_POINT).toBe('com.apple.networkextension.packet-tunnel')
  })

  // A principal class without its Swift module is not resolved at launch.
  it('names the principal class through the Swift module', () => {
    const extension = tunnelInfoPlist(PLAN).NSExtension as Record<string, string>
    expect(extension.NSExtensionPrincipalClass).toBe('$(PRODUCT_MODULE_NAME).PacketTunnelProvider')
  })

  it('is an XPC bundle, which iOS requires of an extension', () => {
    expect(tunnelInfoPlist(PLAN).CFBundlePackageType).toBe('XPC!')
  })
})

describe('entitlements', () => {
  /*
   * `vpn.api` comes with a paid account and drives only the protocols iOS
   * implements. A custom protocol needs the packet tunnel provider, which is
   * granted by request.
   */
  it('asks for the packet tunnel provider on both processes', () => {
    const wanted = ['packet-tunnel-provider']
    expect(tunnelEntitlements()['com.apple.developer.networking.networkextension']).toEqual(wanted)
    expect(withNetworkEntitlements({})['com.apple.developer.networking.networkextension']).toEqual(wanted)
  })

  /*
   * The merge exists for this: Craft writes the app's keychain access group
   * into that file, and replacing it rather than merging would drop secure
   * storage without a word.
   */
  /*
   * The app and the extension are separate processes with separate
   * containers. Without a shared group they each get their own Keychain item
   * under the same name, and the app would show and reset a key the tunnel
   * never uses — both looking like they worked.
   */
  it('adds a shared Keychain group without dropping Craft’s', () => {
    const craft = { 'keychain-access-groups': ['$(AppIdentifierPrefix)$(CFBundleIdentifier)'] }
    const merged = withNetworkEntitlements(craft)
    expect(merged['keychain-access-groups']).toEqual([
      '$(AppIdentifierPrefix)$(CFBundleIdentifier)',
      '$(AppIdentifierPrefix)org.localtunnels.buddyvpn.shared',
    ])
  })

  /*
   * And asks for nothing else.
   *
   * An App Group was in both entitlement files, to carry the chosen region
   * between the two processes. Nothing ever read it: the region travels in
   * `providerConfiguration` and the secret through the Keychain group above,
   * which exists precisely because a group container is no better protected
   * than the rest of the sandbox.
   *
   * An unused entitlement is not free. A group in
   * `com.apple.security.application-groups` has to be registered for the
   * team and carried by the provisioning profile or signing fails — the same
   * failure `withoutNetworkEntitlements` exists to prevent, waiting for
   * whoever makes the first device build, for a container nothing opens.
   */
  it('asks for no entitlement nothing uses', () => {
    const merged = withNetworkEntitlements({})
    expect(merged['com.apple.security.application-groups']).toBeUndefined()
    expect(Object.keys(merged).sort()).toEqual([
      'com.apple.developer.networking.networkextension',
      'keychain-access-groups',
    ])
  })

  it('asks for nothing extra of the extension either', () => {
    expect(Object.keys(tunnelEntitlements()).sort()).toEqual([
      'com.apple.developer.networking.networkextension',
      'keychain-access-groups',
    ])
  })

  /*
   * The removal stays, though nothing writes it any more: a project
   * generated by a build that did write it still carries the key, and that
   * is exactly the state that fails to sign.
   */
  it('still clears an App Group a previous build wrote', () => {
    const stale = { 'com.apple.security.application-groups': ['group.org.localtunnels.buddyvpn'] }
    expect(withoutNetworkEntitlements(stale)['com.apple.security.application-groups']).toBeUndefined()
  })

  it('is idempotent', () => {
    const once = withNetworkEntitlements({ 'keychain-access-groups': ['x'] })
    expect(withNetworkEntitlements(once)).toEqual(once)
  })
})

/*
 * The other direction, which is the one that bites.
 *
 * `init` runs once and project.yml persists, so turning the capability off
 * after a build with it on leaves the extension in place unless something
 * takes it out. The entitlement is the dangerous half: a profile that does
 * not carry it fails to sign, so a stale key breaks every device build while
 * the config says the feature is off.
 */
describe('turning it back off', () => {
  it('removes the target, the dependency and the bridge sources', () => {
    const on = withTunnelTarget(craftProject(), PLAN)
    const off = withoutTunnelTarget(on, PLAN)
    expect(off.targets.BuddyVPNTunnel).toBeUndefined()
    expect(off.targets.BuddyVPN.dependencies).toBeUndefined()
    expect(off.targets.BuddyVPN.sources).toEqual(['Sources', 'Shared'])
  })

  it('leaves a project that never had one untouched', () => {
    expect(withoutTunnelTarget(craftProject(), PLAN)).toEqual(craftProject())
  })

  // On, off, on again is an ordinary thing to do while waiting on Apple.
  it('round-trips', () => {
    const base = craftProject()
    expect(withoutTunnelTarget(withTunnelTarget(base, PLAN), PLAN)).toEqual(base)
  })

  it('keeps a dependency that is not ours', () => {
    const base = craftProject()
    base.targets.BuddyVPN.dependencies = [{ target: 'SomethingElse' }]
    const off = withoutTunnelTarget(withTunnelTarget(base, PLAN), PLAN)
    expect(off.targets.BuddyVPN.dependencies).toEqual([{ target: 'SomethingElse' }])
  })

  /*
   * Only our group leaves. Craft's own access group is what secure storage
   * depends on, so removing the key outright would turn a capability being
   * switched off into the Keychain being switched off.
   */
  it('strips what it added and leaves Craft’s Keychain group', () => {
    const craft = { 'keychain-access-groups': ['$(AppIdentifierPrefix)$(CFBundleIdentifier)'] }
    const stripped = withoutNetworkEntitlements(withNetworkEntitlements(craft))
    expect(stripped).toEqual(craft)
  })
})

/*
 * The mistake this catches, which this package has now made in three
 * different forms: something is written, it is correct, and nothing
 * compiles or reaches it. A Swift file added to native/ios/ without being
 * named in one of the source lists is simply not built — the build
 * succeeds, the symbol is absent, and nothing says so until a call fails
 * at runtime on a device, which is the worst place to find out.
 *
 * Asserted here as well as in the build so it fails in `bun test`, which
 * runs far more often than `build:ios` does.
 */
describe('every native source belongs to a target', () => {
  it('leaves nothing in native/ios unclaimed', () => {
    expect(() => assertEveryNativeSourceIsClaimed()).not.toThrow()
  })
})

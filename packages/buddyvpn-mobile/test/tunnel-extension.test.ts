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

  it('leaves the app target otherwise alone', () => {
    const app = withTunnelTarget(craftProject(), PLAN).targets.BuddyVPN
    expect(app.sources).toEqual(['Sources', 'Shared'])
    expect(app.settings.PRODUCT_BUNDLE_IDENTIFIER).toBe('org.localtunnels.buddyvpn')
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
    expect(tunnelEntitlements(PLAN)['com.apple.developer.networking.networkextension']).toEqual(wanted)
    expect(withNetworkEntitlements({}, PLAN)['com.apple.developer.networking.networkextension']).toEqual(wanted)
  })

  /*
   * The merge exists for this: Craft writes the app's keychain access group
   * into that file, and replacing it rather than merging would drop secure
   * storage without a word.
   */
  it('keeps what Craft already put in the app’s entitlements', () => {
    const craft = { 'keychain-access-groups': ['$(AppIdentifierPrefix)$(CFBundleIdentifier)'] }
    const merged = withNetworkEntitlements(craft, PLAN)
    expect(merged['keychain-access-groups']).toEqual(craft['keychain-access-groups'])
    expect(merged['com.apple.security.application-groups']).toEqual([PLAN.appGroup])
  })

  it('is idempotent', () => {
    const once = withNetworkEntitlements({ 'keychain-access-groups': ['x'] }, PLAN)
    expect(withNetworkEntitlements(once, PLAN)).toEqual(once)
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
  it('removes the target and the dependency', () => {
    const on = withTunnelTarget(craftProject(), PLAN)
    const off = withoutTunnelTarget(on, PLAN)
    expect(off.targets.BuddyVPNTunnel).toBeUndefined()
    expect(off.targets.BuddyVPN.dependencies).toBeUndefined()
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

  it('strips both entitlements and keeps Craft’s', () => {
    const craft = { 'keychain-access-groups': ['$(AppIdentifierPrefix)$(CFBundleIdentifier)'] }
    const stripped = withoutNetworkEntitlements(withNetworkEntitlements(craft, PLAN))
    expect(stripped).toEqual(craft)
  })
})

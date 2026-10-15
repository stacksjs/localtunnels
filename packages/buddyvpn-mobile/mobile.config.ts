/**
 * What the phone app is, and what it is allowed to do.
 *
 * Craft owns the Xcode project and the native bridge; this describes the app
 * that goes in it. The shape follows `config/mobile.ts` in a Stacks project so
 * the two stay legible to each other, but nothing here imports Stacks —
 * localtunnels is a bun workspace, not a Stacks app.
 *
 * ── On actually carrying traffic ────────────────────────────────────────
 *
 * It cannot, yet, and that is a property of iOS rather than of this code.
 * An app there reaches the network stack only through a Network Extension:
 * there is no root, no privileged helper, nothing to shell out to. The macOS
 * build solves this with a root-owned helper and a sudoers rule; none of that
 * exists on a phone.
 *
 * Two entitlements can carry a VPN, and this needs the harder one:
 *
 *   com.apple.developer.networking.vpn.api         Personal VPN. Granted with
 *                                                  a paid account, but only
 *                                                  drives the protocols iOS
 *                                                  implements — IKEv2, IPsec,
 *                                                  L2TP. Not this one.
 *   com.apple.developer.networking.networkextension Packet tunnel provider.
 *                                                  Carries a custom protocol,
 *                                                  and Apple grants it by
 *                                                  request, not by purchase.
 *
 * So the screens, the locations, the connection state and the settings are
 * real and testable now, and the tunnel is a Swift `NEPacketTunnelProvider`
 * that slots in behind the same interface once that entitlement exists. The
 * desktop app spent its first week this way too.
 */

export interface MobileCapabilities {
  /** The system VPN sheet and the tunnel itself. Needs the entitlement above. */
  networkExtension: boolean
  /** Feedback on connect, disconnect and picking a location. */
  haptics: boolean
  /** Remembering the chosen location and the enrolment key. */
  secureStorage: boolean
  /** Telling someone their tunnel dropped while the app was closed. */
  pushNotifications: boolean
  /** `buddyvpn://connect/us-west` and the like. */
  deepLinks: boolean
}

export interface MobileConfig {
  ios: {
    appName: string
    bundleId: string
    /** The screens are bundled, not fetched: a VPN client that needs the
     *  network to draw its own disconnect button is a VPN client that cannot
     *  be turned off when the network is broken. */
    webAssets: string
    deploymentTarget: string
    orientations: Array<'portrait' | 'landscape'>
    urlSchemes: string[]
    /** Follow the phone, rather than pinning a theme the user did not pick. */
    appearance: 'system' | 'light' | 'dark'
    capabilities: MobileCapabilities
  }
}

const config: MobileConfig = {
  ios: {
    appName: 'BuddyVPN',
    bundleId: 'org.localtunnels.buddyvpn',
    webAssets: 'dist',
    // iOS 16 is where the modern NEPacketTunnelProvider surface settles, and
    // it is old enough that nothing we would ship excludes a real phone.
    deploymentTarget: '16.0',
    // A connect button and a list of places. There is nothing here that a
    // landscape layout would serve.
    orientations: ['portrait'],
    urlSchemes: ['buddyvpn'],
    appearance: 'system',
    capabilities: {
      /*
       * Off until the entitlement exists, and this is the switch for it.
       *
       * On, `build:ios` emits a second target — the packet tunnel provider,
       * its Info.plist, its entitlements, and the App Group the two
       * processes share — and embeds it in the app. Off, the project is a
       * single app target and nothing below is written.
       *
       * It stays off because entitlements a provisioning profile does not
       * carry do not sign: with this on, a device build or an archive fails
       * outright. Simulator builds are unaffected either way, which is how
       * the emitted target was checked. Turn it on when Apple grants
       * com.apple.developer.networking.networkextension.
       */
      networkExtension: false,
      haptics: true,
      secureStorage: true,
      pushNotifications: false,
      deepLinks: true,
    },
  },
}

export default config

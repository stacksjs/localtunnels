//
//  The process that would carry the packets.
//
//  An iOS app cannot touch the network stack. Everything a VPN does there
//  happens in a Network Extension: a separate process, with its own bundle
//  identifier and its own entitlement, that the system starts on demand and
//  can keep running after the app is gone. This is that process.
//
//  It is generated into `ios/Tunnel/` by `bun run build:ios`, from
//  `native/ios/` in this package. `ios/` is rebuilt every time, so this file
//  is the one to edit — a change made in the generated copy is lost at the
//  next build.
//
//  ── What this does today ───────────────────────────────────────────────
//
//  It refuses to start, and says why.
//
//  That is the point of it. The target exists so the project is shaped
//  correctly — the extension builds, embeds, and is signed alongside the app
//  — while the data path is still missing. The alternative, a provider that
//  applies tunnel settings and then drops every packet, is far worse: iOS
//  would show the VPN badge, the app would show "Connected", and nothing
//  would reach the internet. The desktop app shipped a demo mode once, and
//  the whole risk it carried was somebody believing it.
//
//  So `startTunnel` reads the configuration the app handed over, logs what it
//  received, and fails with a reason a person can read in Console.app. The
//  handshake is proven; the transport is not pretended.
//
//  ── What goes here next ────────────────────────────────────────────────
//
//  The core is already here. `packages/vpn-core` cross-compiles to
//  `aarch64-ios` and is linked in as `libltvpn.xcframework`, so the handshake
//  and the transport cipher are callable from this file today — `ltvpn.h`
//  says what is callable, and `startTunnel` below proves the link by asking
//  the library its ABI version.
//
//  The data path is here too, in `TunnelSession`: given a session it
//  encrypts what the system sends and delivers what comes back, and
//  `networkSettings` below describes the tunnel to iOS, DNS and the LAN rule
//  included.
//
//  What is missing is enrolment. A session needs a static keypair, the
//  exit's public key and an address the exit will route to, and on the
//  desktop all three come from the coordinator: the client registers over a
//  WebSocket, is assigned an address, and reads the exit's key and endpoint
//  from the directory. That protocol is TypeScript in
//  `packages/localtunnels`, and an extension cannot run it — a Swift client
//  for it is the next piece, and the larger one.
//
import NetworkExtension
import os

/// Why a start attempt did not produce a tunnel.
enum TunnelStartFailure: LocalizedError {
    /// The app started the tunnel without saying where to.
    case noConfiguration
    /// Everything arrived; there is simply no peer to talk to yet.
    case notEnrolled(region: String)
    /// The linked core is not the one this build was written against.
    case coreUnusable

    var errorDescription: String? {
        switch self {
        case .noConfiguration:
            return "This tunnel was started without a configuration, so there is no exit to connect to."
        case let .notEnrolled(region):
            return "BuddyVPN cannot reach \(region) yet: this build has no way to enrol with a coordinator, "
                 + "so it has no key for the exit and no address of its own. The tunnel itself is in place."
        case .coreUnusable:
            return "BuddyVPN's encryption library is not the version this build expects."
        }
    }
}

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let log = Logger(subsystem: "org.localtunnels.buddyvpn", category: "tunnel")

    /// What the app put in `providerConfiguration` when it saved the profile.
    private var configuration: [String: Any]? {
        (protocolConfiguration as? NETunnelProviderProtocol)?.providerConfiguration
    }

    /*
     * The core, asked what it is before anything depends on it.
     *
     * A static archive that linked is not the same as one that matches this
     * header: the symbols resolve either way, and a struct that has changed
     * shape underneath is then read wrongly at the first call, somewhere far
     * from here. `LTVPN_ABI_VERSION` is a cheap thing to disagree about
     * loudly at startup.
     */
    private func coreIsUsable() -> Bool {
        let built = ltvpn_version()
        guard built == LTVPN_ABI_VERSION else {
            log.error("libltvpn is ABI \(built), this build expects \(LTVPN_ABI_VERSION)")
            return false
        }
        log.notice("libltvpn ABI \(built, privacy: .public) linked")
        return true
    }

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        // `options` is what `startVPNTunnel(options:)` passed for this
        // attempt; `providerConfiguration` is what was saved with the
        // profile. A region may arrive either way, so both are read, with the
        // per-attempt value winning.
        let fromOptions = options?["region"] as? String
        let fromProfile = configuration?["region"] as? String
        guard let region = fromOptions ?? fromProfile else {
            log.error("start refused: no region in options or provider configuration")
            completionHandler(TunnelStartFailure.noConfiguration)
            return
        }

        let exit = configuration?["exitIp"] as? String ?? "unspecified"
        // Logged rather than applied: the settings reach this process, and
        // what is missing is the data path that would honour them.
        let dns = (configuration?["dns"] as? [String] ?? []).joined(separator: ", ")
        let allowLan = configuration?["allowLan"] as? Bool ?? false
        log.notice("start requested: region \(region, privacy: .public), exit \(exit, privacy: .public), dns [\(dns, privacy: .public)], lan \(allowLan, privacy: .public)")

        guard coreIsUsable() else {
            completionHandler(TunnelStartFailure.coreUnusable)
            return
        }

        /*
         * Stopping here, one step short of a tunnel.
         *
         * `TunnelSession` below carries packets, and it is complete: given a
         * session it encrypts what the system sends and delivers what comes
         * back. What it cannot do is produce that session, and neither can
         * anything else in this build.
         *
         * A session needs three things this extension has no way to obtain:
         * a static keypair of its own, the exit's public key, and a tunnel
         * address the exit will route to. On the desktop all three come from
         * the coordinator — the client registers over a WebSocket, is
         * assigned an address, and reads the exit's key and endpoint out of
         * the directory it is then sent. None of that exists here: the
         * coordinator protocol is TypeScript in `packages/localtunnels`, and
         * an extension cannot run it.
         *
         * So this is where the work stops, and it stops *before*
         * `setTunnelNetworkSettings`. Applying settings is what makes iOS
         * show the VPN badge and route traffic into this process, and
         * routing traffic into a provider that cannot forward it is a
         * blackhole that looks exactly like a working connection.
         */
        completionHandler(TunnelStartFailure.notEnrolled(region: region))
    }

    /**
     How this tunnel would be described to iOS.

     Unused until there is a session to describe, and written now because
     every value in it is already decided: the resolvers the settings screen
     chose, the LAN rule, and a default route for everything else.

     `includedRoutes` is the whole address space. This app has no
     split-tunnel setting and says so on its settings screen — an app whose
     purpose is to put your traffic somewhere else has no honest setting for
     "but not really". `excludedRoutes` carries the local network only when
     that was asked for, which is what makes a printer reachable while
     everything else goes through the exit.
     */
    func networkSettings(address: String, exit: String, dns: [String], allowLan: Bool) -> NEPacketTunnelNetworkSettings {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: exit)

        let ipv4 = NEIPv4Settings(addresses: [address], subnetMasks: ["255.255.255.255"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
        if allowLan {
            ipv4.excludedRoutes = [
                NEIPv4Route(destinationAddress: "10.0.0.0", subnetMask: "255.0.0.0"),
                NEIPv4Route(destinationAddress: "172.16.0.0", subnetMask: "255.240.0.0"),
                NEIPv4Route(destinationAddress: "192.168.0.0", subnetMask: "255.255.0.0"),
                NEIPv4Route(destinationAddress: "169.254.0.0", subnetMask: "255.255.0.0"),
            ]
        }
        settings.ipv4Settings = ipv4

        if !dns.isEmpty {
            let resolvers = NEDNSSettings(servers: dns)
            // Every name, not just the ones with no better answer: a resolver
            // that only sees some queries is a resolver that leaks the rest.
            resolvers.matchDomains = [""]
            settings.dnsSettings = resolvers
        }

        /*
         * Room for the transport's own overhead.
         *
         * The encrypted packet is larger than the one handed over, and the
         * difference has to come out of the MTU or every full-size packet is
         * refused by `TunnelSession.send` as over the limit — which reads as
         * a tunnel that carries small packets and drops large ones.
         */
        settings.mtu = NSNumber(value: 1280)
        return settings
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        log.notice("stop requested: reason \(reason.rawValue, privacy: .public)")
        completionHandler()
    }

    /// Messages from the containing app while the tunnel runs. Nothing sends
    /// one yet; answering nil is the documented way to say "no reply".
    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        completionHandler?(nil)
    }
}

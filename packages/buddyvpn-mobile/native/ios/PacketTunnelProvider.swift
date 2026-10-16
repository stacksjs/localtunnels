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
//  What is left is the data path, and it is all on this side: apply
//  `NEPacketTunnelNetworkSettings` (addresses, routes, and the DNS the
//  settings screen chose), open a UDP session to the exit, run
//  `ltvpn_hs_create_initiation` against it, then read `packetFlow` and feed
//  `ltvpn_session_encrypt` in one direction and `ltvpn_session_decrypt` in
//  the other until `stopTunnel`.
//
import NetworkExtension
import os

/// Why a start attempt did not produce a tunnel.
enum TunnelStartFailure: LocalizedError {
    /// The app started the tunnel without saying where to.
    case noConfiguration
    /// Everything arrived; there is simply no transport behind it yet.
    case noDataPath(region: String)
    /// The linked core is not the one this build was written against.
    case coreUnusable

    var errorDescription: String? {
        switch self {
        case .noConfiguration:
            return "This tunnel was started without a configuration, so there is no exit to connect to."
        case let .noDataPath(region):
            return "BuddyVPN has no packet transport yet, so the tunnel to \(region) cannot carry traffic. "
                 + "The extension is in place and received its configuration; the data path is not implemented."
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
        log.notice("start requested: region \(region, privacy: .public), exit \(exit, privacy: .public)")

        guard coreIsUsable() else {
            completionHandler(TunnelStartFailure.coreUnusable)
            return
        }

        // Deliberately not `setTunnelNetworkSettings`. Applying settings is
        // what makes iOS show the VPN badge and route traffic here, and
        // routing traffic into a provider that cannot forward it is a
        // blackhole that looks like a working connection.
        completionHandler(TunnelStartFailure.noDataPath(region: region))
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

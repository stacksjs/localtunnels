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
    /// This device has no coordinator to join, so there is nothing to join.
    case notProvisioned
    /// Registered, but the network has no exit to route through.
    case noExit(region: String)
    /// The exit this device was paired to is not in the network right now.
    case pinnedExitAbsent(region: String)

    var errorDescription: String? {
        switch self {
        case .noConfiguration:
            return "This tunnel was started without a configuration, so there is no exit to connect to."
        case let .notEnrolled(region):
            return "BuddyVPN cannot reach \(region) yet: this build has no way to enrol with a coordinator, "
                 + "so it has no key for the exit and no address of its own. The tunnel itself is in place."
        case .coreUnusable:
            return "BuddyVPN's encryption library is not the version this build expects."
        case .notProvisioned:
            return "This device has not been set up yet: it has no coordinator address to join, "
                 + "so there is nothing for it to connect to."
        case let .noExit(region):
            return "No server in \(region) is offering to carry traffic right now."
        case let .pinnedExitAbsent(region):
            return "The server this device was paired to in \(region) is not reachable right now. "
                 + "BuddyVPN will not use a different one — re-pair this device to change which server it trusts."
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
         * From here on this device has to become a member of a network.
         *
         * It needs a coordinator to join and, where one is required, the
         * secret to join it. Neither is baked into this build and neither
         * should be: `authKey` is shared between every member, and a shared
         * secret in a shipped binary belongs to anyone who downloads it. The
         * app is meant to pass them in, and has no way to obtain them yet —
         * see PROVISIONING.md for what is missing and why it is a decision
         * rather than an oversight.
         */
        guard let coordinatorUrl = configuration?["coordinatorUrl"] as? String, !coordinatorUrl.isEmpty else {
            completionHandler(TunnelStartFailure.notProvisioned)
            return
        }

        let identity: DeviceIdentity
        do {
            identity = try DeviceIdentity.loadOrCreate()
        }
        catch {
            log.error("this device has no usable key: \(error.localizedDescription, privacy: .public)")
            completionHandler(error)
            return
        }

        join(
            coordinatorUrl: coordinatorUrl,
            authKey: configuration?["authKey"] as? String,
            // Written only when a pin was carried in the pairing, so absent
            // and empty both mean "decide from the directory".
            exitKey: (configuration?["exitKey"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            identity: identity,
            region: region,
            completionHandler: completionHandler
        )
    }

    /// The coordinator connection, held for as long as the tunnel is up: it
    /// is what keeps this node in the directory, and dropping it is how a
    /// node gets forgotten and the exit stops routing to it.
    private var coordinator: CoordinatorClient?
    private var tunnel: TunnelSession?

    /**
     Register, then wait for a directory with an exit in it.

     Registration settles this device's address; the directory settles who it
     talks to. Both are needed before a single packet can be encrypted, and
     they arrive separately — `registered` first, then `peers`, which the
     coordinator sends again whenever the membership changes.
     */
    private func join(coordinatorUrl: String,
                      authKey: String?,
                      exitKey: String?,
                      identity: DeviceIdentity,
                      region: String,
                      completionHandler: @escaping (Error?) -> Void) {
        let client: CoordinatorClient
        do {
            client = try CoordinatorClient(
                url: coordinatorUrl,
                publicKey: identity.publicKeyBase64,
                // The datapath's port. Reported as 0 until there is a
                // datapath to report: this device makes outbound UDP and the
                // exit learns where to answer from the packets themselves.
                listenPort: 0,
                authKey: authKey
            )
        }
        catch {
            completionHandler(error)
            return
        }
        coordinator = client

        /*
         * Said out loud for the same reason the desktop says it: a node the
         * coordinator stops hearing from is dropped, and the exit then
         * withdraws the route to it. The tunnel keeps reporting health
         * throughout, so nothing else will mention it.
         */
        client.onStale = { [weak self] silent in
            self?.log.error("the coordinator has been silent for \(Int(silent))s; this tunnel is about to stop carrying traffic")
        }
        client.onResumed = { [weak self] _ in
            self?.log.notice("the coordinator is answering again")
        }

        if let exitKey {
            log.notice("this device is paired to one exit: \(exitKey.prefix(16), privacy: .public)…")
        }

        var settled = false
        client.onPeers = { [weak self] peers in
            guard let self, !settled else { return }
            guard let exit = peers.exit(pinnedTo: exitKey) else {
                /*
                 * Not a failure yet, in either case: a peer may still join,
                 * and the coordinator re-sends the directory when one does.
                 *
                 * Which case it is matters for what a person would do about
                 * it, so they are logged apart. A pinned exit that is absent
                 * is not a network without an exit — there may be several
                 * offering, and this device will not take any of them.
                 */
                if exitKey == nil {
                    self.log.notice("no exit in the directory yet, \(peers.count) peer(s) known")
                }
                else {
                    self.log.notice("the pinned exit is not in the directory, \(peers.count) peer(s) known")
                }
                return
            }
            settled = true
            self.log.notice("exit \(exit.publicKey.prefix(16), privacy: .public)… at \(exit.endpoint.host, privacy: .public):\(exit.endpoint.port)")

            /*
             * And this is as far as it goes.
             *
             * Everything above is settled: the device has a key, an address,
             * and an exit chosen by the same rule the desktop uses. What
             * remains is the handshake and the session — open UDP to the
             * endpoint above, exchange `ltvpn_hs_create_initiation` and
             * `ltvpn_hs_consume_response`, derive a session with
             * `ltvpn_session_from_handshake`, apply `networkSettings`, and
             * hand the session to `TunnelSession`.
             *
             * It is not written because none of it can be run. The pieces it
             * joins have never executed, the entitlement that would let them
             * does not exist, and writing the retransmit, timeout and
             * re-handshake behaviour against no feedback would produce code
             * that looks finished and has never been true. It waits for a
             * device.
             */
            completionHandler(exitKey == nil
                ? TunnelStartFailure.noExit(region: region)
                : TunnelStartFailure.pinnedExitAbsent(region: region))
        }

        client.connect { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(registration):
                self.log.notice("joined as \(registration.assignedIp, privacy: .public) on \(registration.network, privacy: .public)")
            case let .failure(error):
                settled = true
                self.log.error("could not join: \(error.localizedDescription, privacy: .public)")
                completionHandler(error)
            }
        }
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

//
//  The app's half of the tunnel: the part that asks iOS for one.
//
//  `NETunnelProviderManager` lives in the container app, never in the
//  extension — the app owns the VPN *configuration*, and the extension is
//  only the process that carries packets once the system starts it. So the
//  permission prompt, the saved profile and the start request all happen
//  here.
//
//  Generated into `ios/Bridge/` by `bun run build:ios` from `native/ios/`.
//  `ios/` is rebuilt every time, so this file is the one to edit.
//
//  ── How the screens reach this ─────────────────────────────────────────
//
//  They do not call it. Craft's native API is a fixed switch in generated
//  Swift with no registration point, rewritten on every build, so a module of
//  our own cannot be added to it without patching generated code that a Craft
//  upgrade would quietly break. Instead the two halves use what Craft already
//  publishes, and `src/tunnel-bridge.ts` is the other side of every constant
//  below:
//
//    in    the screens call `craft.storage.set('vpn.request', …)`, which
//          lands in `UserDefaults.standard` under Craft's own prefix.
//    out   this writes `CraftSnapshots.write("vpn-status", …)`, which posts a
//          notification every screen forwards to JavaScript.
//
//  ── Why a notification rather than KVO ─────────────────────────────────
//
//  `addObserver(forKeyPath:)` would be the obvious way to watch one default,
//  and it cannot be used here: KVO reads dots in a key path as nesting, and
//  the key is `craft.native.storage.vpn.request`. It would observe a `craft`
//  key containing a `native` key, find nothing, and never fire.
//
//  `UserDefaults.didChangeNotification` fires for every write instead, so
//  this reads the key and decides for itself whether anything happened. The
//  nonce in each request is what makes that cheap and exact: the same request
//  twice is two nonces, and a notification carrying no new nonce is ignored.
//
import Foundation
import NetworkExtension
import os

@objc(TunnelControl)
final class TunnelControl: NSObject {
    @objc static func start() {
        shared.begin()
    }

    static let shared = TunnelControl()

    private let log = Logger(subsystem: "org.localtunnels.buddyvpn", category: "tunnel-control")

    /// Craft's prefix plus our key. Both halves of this string are in
    /// `src/tunnel-bridge.ts`; changing one without the other silently stops
    /// every tap from arriving.
    private let requestKey = "craft.native.storage.vpn.request"
    private let statusSnapshot = "vpn-status"

    /// The last request acted on, so a notification that carries nothing new
    /// is ignored. See the note above on why every write wakes this up.
    private var lastNonce: String?
    private var manager: NETunnelProviderManager?
    private var started = false

    /**
     Why the last attempt did not produce a tunnel, until the next one.

     Held rather than passed, because the two halves of a failure arrive
     separately and neither is complete. This process learns about its own
     refusals immediately — a configuration it could not save, a Keychain
     that refused — and about the provider's only after the connection has
     already gone back to disconnected, which is also when the status change
     that would overwrite it arrives.

     Cleared when a new attempt starts, which is the only moment the old
     reason stops being the most useful thing anybody could be told.
     */
    private var lastError: String?

    /// The extension's bundle id, by the same rule `planTunnel` uses in
    /// `scripts/ios-tunnel-extension.ts`: the app's, plus one component. iOS
    /// requires an extension to live under its container app, so this is not
    /// a convention either side is free to change alone.
    private var providerBundleId: String {
        "\(Bundle.main.bundleIdentifier ?? "org.localtunnels.buddyvpn").tunnel"
    }

    func begin() {
        guard !started else { return }
        started = true

        log.notice("watching for tunnel requests; provider \(self.providerBundleId, privacy: .public)")

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(defaultsChanged),
            name: UserDefaults.didChangeNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(vpnStatusChanged),
            name: .NEVPNStatusDidChange,
            object: nil
        )

        // Adopt a tunnel that is already up. A Network Extension outlives the
        // app that started it — that is the point of it being its own process
        // — so the app can launch into a live tunnel and must say so rather
        // than drawing "Not connected" over one.
        NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, _ in
            guard let self else { return }
            self.manager = managers?.first
            self.publish()
        }

        // A request left before this started watching — the tap that launched
        // the app, or one written while it was in the background.
        defaultsChanged()
    }

    // MARK: Requests in

    @objc private func defaultsChanged() {
        guard let data = UserDefaults.standard.data(forKey: requestKey),
              let object = try? JSONSerialization.jsonObject(with: data),
              let request = object as? [String: Any],
              let nonce = request["nonce"] as? String,
              nonce != lastNonce
        else { return }

        lastNonce = nonce
        /*
         * Read, then gone.
         *
         * This is a command, not state: nothing reads it back, and the
         * screens keep their own copy of what they asked for. Leaving it
         * meant the last request sat in the container's plist until the next
         * one replaced it — and a connect request carries the secret that
         * joins this network, which an unencrypted device backup then
         * contains in the clear.
         *
         * Removing it posts another `didChangeNotification`, which arrives
         * here, finds no data and returns at the guard above. No loop.
         */
        UserDefaults.standard.removeObject(forKey: requestKey)

        switch request["action"] as? String {
        case "connect":
            guard let region = request["region"] as? String else {
                log.error("connect request with no region")
                return
            }
            connect(
                region: region,
                exitIp: request["exitIp"] as? String,
                dns: request["dns"] as? [String] ?? [],
                allowLan: request["allowLan"] as? Bool ?? false,
                coordinatorUrl: request["coordinatorUrl"] as? String,
                authKey: request["authKey"] as? String,
                exitKey: request["exitKey"] as? String
            )
        case "disconnect":
            disconnect()
        case "forget-pairing":
            /*
             * The secret half of unpairing. The screens forget the rest — the
             * coordinator's address and the region — in their own Keychain,
             * and this is the copy the tunnel reads, which would otherwise
             * outlive the pairing it belongs to.
             */
            do {
                try PairingSecretStore.forget()
                log.notice("this device's network secret was forgotten")
            }
            catch {
                log.error("could not forget this device's network secret: \(error.localizedDescription, privacy: .public)")
            }
        case "forget-identity":
            /*
             * A new key is a new device to the coordinator: a fresh address,
             * and whatever the old key was allowed stays allowed until
             * somebody removes it there. The answer to a key that has been
             * somewhere it should not have been, and nothing smaller.
             */
            do {
                try DeviceIdentityStore.forget()
                log.notice("this device's key was reset")
            }
            catch {
                log.error("could not reset this device's key: \(error.localizedDescription, privacy: .public)")
            }
            publish()
        case let other:
            log.error("unknown tunnel request \(other ?? "nil", privacy: .public)")
        }
    }

    private func connect(region: String,
                         exitIp: String?,
                         dns: [String],
                         allowLan: Bool,
                         coordinatorUrl: String?,
                         authKey: String?,
                         exitKey: String?) {
        log.notice("connect requested: \(region, privacy: .public)")
        /*
         * Cleared here rather than waiting for the status to reach
         * `connecting`.
         *
         * Everything between this and that — reading the preferences, saving
         * them, Face ID — takes long enough to read, and the last failure
         * sitting next to a spinner reads as the failure happening again.
         */
        lastError = nil
        publish()

        NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, error in
            guard let self else { return }
            if let error {
                self.fail("The VPN configuration could not be read: \(error.localizedDescription)")
                return
            }

            let manager = managers?.first ?? NETunnelProviderManager()
            let proto = NETunnelProviderProtocol()
            proto.providerBundleIdentifier = self.providerBundleId
            // Shown in Settings → VPN. The address, when there is one, is
            // more use to a person than a region slug.
            proto.serverAddress = exitIp ?? region
            /*
             * Everything the provider needs, carried in one place.
             *
             * It is a separate process with its own bundle: it cannot read
             * the app's settings, and a resolver named rather than addressed
             * would mean keeping the preset list in a third copy. So the
             * addresses travel, not the name.
             */
            proto.providerConfiguration = [
                "region": region,
                "exitIp": exitIp ?? "",
                "dns": dns,
                "allowLan": allowLan,
            ]
            // Omitted rather than sent empty: the provider checks presence to
            // decide whether this device has been provisioned at all.
            if let coordinatorUrl {
                proto.providerConfiguration?["coordinatorUrl"] = coordinatorUrl
            }
            /*
             * The join secret is not in there.
             *
             * `providerConfiguration` travels with the saved VPN profile,
             * outside this app's Keychain, and anything that can read the
             * VPN preferences can read it back. It carries what is not
             * secret; the secret goes to the group both processes share, and
             * `PacketTunnelProvider` reads it there.
             *
             * Written on every connect rather than once at pairing, so the
             * pairing the screens hold stays the only source of truth. A
             * rotated key reaches the tunnel on the next connect without
             * anything having to notice it changed.
             */
            if let authKey, !authKey.isEmpty {
                do {
                    try PairingSecretStore.store(authKey)
                }
                catch {
                    // Nothing else will mention it: the provider would start,
                    // find no secret, and be refused by a coordinator that
                    // requires one — which looks like a bad key rather than
                    // a key that never arrived.
                    self.fail("This device's network secret could not be stored: \(self.describe(error))")
                    return
                }
            }
            /*
             * The exit this device will accept, when one was pinned.
             *
             * Absent means the provider decides from the directory, which is
             * what a network whose operator pinned nothing gets. Present
             * means it refuses everything else — so an empty string must not
             * be written here, or "pinned to nothing" would read as "pinned"
             * and no exit would ever match.
             */
            if let exitKey, !exitKey.isEmpty {
                proto.providerConfiguration?["exitKey"] = exitKey
            }
            manager.protocolConfiguration = proto
            manager.localizedDescription = "BuddyVPN"
            manager.isEnabled = true

            /*
             * This is the line that asks the person.
             *
             * The first save raises the system's "Would Like to Add VPN
             * Configurations" alert and then Face ID, Touch ID or the
             * passcode. There is no Info.plist string for it and no way to
             * ask in advance — installing the configuration *is* the
             * request, and a refusal arrives here as an error.
             */
            manager.saveToPreferences { [weak self] error in
                guard let self else { return }
                if let error {
                    self.fail(self.describe(error))
                    return
                }
                /*
                 * Reloaded before starting, which is not optional. After a
                 * save the manager's `connection` is stale, and calling
                 * `startVPNTunnel` on it fails with a configuration error
                 * that reads as though the profile were wrong.
                 */
                manager.loadFromPreferences { [weak self] error in
                    guard let self else { return }
                    if let error {
                        self.fail(self.describe(error))
                        return
                    }
                    self.manager = manager
                    do {
                        try manager.connection.startVPNTunnel(options: ["region": region as NSString])
                    }
                    catch {
                        self.fail(self.describe(error))
                    }
                }
            }
        }
    }

    private func disconnect() {
        log.notice("disconnect requested")
        manager?.connection.stopVPNTunnel()
    }

    /// A refusal or a failure, in words meant for the person who tapped.
    private func describe(_ error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == NEVPNErrorDomain, nsError.code == NEVPNError.configurationReadWriteFailed.rawValue {
            return "BuddyVPN was not allowed to add a VPN configuration."
        }
        return error.localizedDescription
    }

    private func fail(_ message: String) {
        log.error("tunnel request failed: \(message, privacy: .public)")
        lastError = message
        publish()
    }

    // MARK: Status out

    @objc private func vpnStatusChanged() {
        let status = manager?.connection.status ?? .invalid
        switch status {
        case .connecting, .connected:
            // A new attempt, or one that worked. Whatever went wrong last
            // time is no longer what is happening, and leaving it on screen
            // next to a tunnel that is coming up would be worse than saying
            // nothing.
            lastError = nil
            publish()
        case .disconnected:
            readDisconnectReason()
        default:
            publish()
        }
    }

    /**
     Ask the system why the tunnel stopped, and say so.

     This is the only way the provider's reasons reach a person. A
     `startTunnel` that calls its completion handler with an error does not
     put that error anywhere the app can see: the connection's status goes to
     `disconnected`, exactly as it would after somebody tapped disconnect,
     and `NEVPNConnection` has no property holding the reason. So every
     sentence in `TunnelStartFailure` — all of them written for somebody to
     read, one of them explaining that re-pairing is how you change which
     server this device trusts — reached the extension's log and stopped
     there, while the app showed a tunnel that had simply returned to idle.

     `fetchLastDisconnectError` is where iOS keeps it, since 16.0, which is
     this app's deployment target. Nil is the ordinary case: a tunnel that
     was asked to stop did not fail, and has nothing to report.
     */
    private func readDisconnectReason() {
        guard let connection = manager?.connection else {
            publish()
            return
        }
        connection.fetchLastDisconnectError { [weak self] error in
            guard let self else { return }
            if let error {
                /*
                 * Not overwritten if this process already has a reason. Its
                 * own are more specific — "was not allowed to add a VPN
                 * configuration" against the system's account of a tunnel
                 * that stopped — and they describe something that happened
                 * before the provider ever ran.
                 */
                if self.lastError == nil {
                    self.lastError = self.describe(error)
                }
                self.log.error("the tunnel stopped: \(error.localizedDescription, privacy: .public)")
            }
            self.publish()
        }
    }

    /// Write the current state where every screen will be told about it.
    private func publish() {
        let connection = manager?.connection
        let status = connection?.status ?? .invalid
        let proto = manager?.protocolConfiguration as? NETunnelProviderProtocol
        let configuration = proto?.providerConfiguration

        var frame: [String: Any] = [
            "phase": phase(for: status),
            // Read, never generated: asking what this device is called is
            // not a reason to give it a name.
            "deviceKey": DeviceIdentityStore.publicKeyBase64IfPresent() ?? NSNull(),
            "region": configuration?["region"] as? String ?? NSNull(),
            "exitIp": configuration?["exitIp"] as? String ?? NSNull(),
            "error": lastError ?? NSNull(),
            "since": NSNull(),
        ]
        // Epoch milliseconds, because that is what JavaScript counts in. The
        // screens run their own clock from this rather than being pushed a
        // number every second.
        if status == .connected, let connectedDate = connection?.connectedDate {
            frame["since"] = connectedDate.timeIntervalSince1970 * 1000
        }

        guard let data = try? JSONSerialization.data(withJSONObject: frame),
              let json = String(data: data, encoding: .utf8)
        else {
            log.error("could not encode tunnel status")
            return
        }
        CraftSnapshots.write(statusSnapshot, json: json)
    }

    /// NEVPNStatus has six cases; the screens know four phases.
    private func phase(for status: NEVPNStatus) -> String {
        switch status {
        case .connecting:
            return "connecting"
        case .connected:
            return "connected"
        case .disconnecting:
            return "disconnecting"
        case .reasserting:
            // The tunnel is rebuilding itself after a network change. It is
            // not carrying traffic, and saying "connected" through it would
            // be the one-way-tunnel lie in miniature.
            return "connecting"
        case .invalid, .disconnected:
            return "idle"
        @unknown default:
            return "idle"
        }
    }
}

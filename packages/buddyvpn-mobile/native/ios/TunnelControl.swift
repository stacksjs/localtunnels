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
                authKey: request["authKey"] as? String
            )
        case "disconnect":
            disconnect()
        case let other:
            log.error("unknown tunnel request \(other ?? "nil", privacy: .public)")
        }
    }

    private func connect(region: String, exitIp: String?, dns: [String], allowLan: Bool, coordinatorUrl: String?, authKey: String?) {
        log.notice("connect requested: \(region, privacy: .public)")

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
            if let authKey {
                proto.providerConfiguration?["authKey"] = authKey
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
        publish(error: message)
    }

    // MARK: Status out

    @objc private func vpnStatusChanged() {
        publish()
    }

    /// Write the current state where every screen will be told about it.
    private func publish(error: String? = nil) {
        let connection = manager?.connection
        let status = connection?.status ?? .invalid
        let proto = manager?.protocolConfiguration as? NETunnelProviderProtocol
        let configuration = proto?.providerConfiguration

        var frame: [String: Any] = [
            "phase": phase(for: status),
            "region": configuration?["region"] as? String ?? NSNull(),
            "exitIp": configuration?["exitIp"] as? String ?? NSNull(),
            "error": error ?? NSNull(),
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

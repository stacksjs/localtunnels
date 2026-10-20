//
//  The secret that lets this device join, kept out of everything that is
//  backed up in the clear.
//
//  The coordinator's `authKey` is shared by every member of a network. The
//  phone gets it from a pairing link and `src/pairing.ts` puts it in the
//  Keychain for exactly that reason — and then the tunnel needs it in
//  another process, which is where it used to leak.
//
//  ── The two places it should not be ────────────────────────────────────
//
//  `UserDefaults`  the only channel Craft gives a screen for reaching
//                  Swift, and a plist in the app container. An
//                  unencrypted device backup contains that plist as
//                  written. `TunnelControl` now clears the request key as
//                  soon as it has read it, so a value lives there for the
//                  length of one callback rather than until the next
//                  connect overwrites it. That is a short window, not no
//                  window: a crash inside it leaves the request on disk,
//                  and a plist's freed space is not zeroed.
//
//  `providerConfiguration`  carried with the saved VPN profile, outside
//                  this app's Keychain, and read back by anything that can
//                  read the VPN preferences. Apple's own answer for
//                  credentials is a Keychain reference rather than the
//                  dictionary, which is what this is.
//
//  So the app writes it here, in the access group both targets share, and
//  the extension reads it here. The dictionary carries what is not secret:
//  a region, an address, resolvers, and whether the local network stays
//  reachable.
//
//  ── Why not `DeviceIdentityStore` ──────────────────────────────────────
//
//  Same group, same Keychain, different lifetime. A device's key survives
//  unpairing — it is what this device *is*, and forgetting a network does
//  not make it a different device. This is what a device was *told*, and
//  unpairing is precisely the act of no longer holding it. One item each
//  means forgetting one cannot take the other with it.
//
import Foundation
import Security
import os

enum PairingSecretStore {
    static let log = Logger(subsystem: "org.localtunnels.buddyvpn", category: "pairing-secret")

    private static let service = "org.localtunnels.buddyvpn.pairing"
    private static let account = "auth-key"
    /// The group `DeviceIdentityStore` uses, and the one
    /// `scripts/ios-tunnel-extension.ts` writes into both targets'
    /// entitlements. Both items have to be reachable from both processes.
    private static let accessGroup = "$(AppIdentifierPrefix)org.localtunnels.buddyvpn.shared"

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    /// The secret this device joins with, or nil when it has none.
    static func load() -> String? {
        var item: CFTypeRef?
        var lookup = query()
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne

        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            if status != errSecItemNotFound {
                log.error("the join secret could not be read (\(status))")
            }
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    /**
     Keep the secret this device was given, replacing whatever was there.

     Replacing rather than adding: a network's key can be rotated, and a
     second pairing has to win or the device would go on presenting the key
     it was re-paired away from. `SecItemAdd` alone would return
     `errSecDuplicateItem` and leave the old one in place, which reads as a
     pairing that was accepted and did nothing.
     */
    static func store(_ authKey: String) throws {
        guard let data = authKey.data(using: .utf8) else {
            throw DeviceIdentityFailure.keychainFailed(errSecParam)
        }
        var item = query()
        item[kSecValueData as String] = data
        // Not `WhenUnlocked`: the system starts a packet tunnel with the
        // phone in a pocket, and a secret that cannot be read then is a
        // tunnel that cannot reconnect until somebody looks at their screen.
        // The same reasoning as the device key, and it has to be the same
        // answer, or the two would be readable at different times.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let added = SecItemAdd(item as CFDictionary, nil)
        if added == errSecSuccess {
            return
        }
        guard added == errSecDuplicateItem else {
            throw DeviceIdentityFailure.keychainFailed(added)
        }
        let updated = SecItemUpdate(
            query() as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        guard updated == errSecSuccess else {
            throw DeviceIdentityFailure.keychainFailed(updated)
        }
    }

    /**
     Forget it.

     What unpairing means for the half of a pairing that is a secret. It
     reaches this device and nothing else: the coordinator has no notion of
     revoking one member, so anyone else still holding this key still joins.
     */
    static func forget() throws {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DeviceIdentityFailure.keychainFailed(status)
        }
    }
}

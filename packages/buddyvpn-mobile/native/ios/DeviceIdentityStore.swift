//
//  Where this device's key is kept, for the two processes that need it.
//
//  Split from `DeviceIdentity` because they need different things. The
//  extension makes a key and uses it, which takes the crypto core. The app
//  only shows what this device is called and offers to reset it, which takes
//  no crypto at all — and linking libltvpn into the app so it could ask the
//  Keychain a question would be a strange price to pay.
//
//  ── Why a shared access group ──────────────────────────────────────────
//
//  The app and the extension are separate processes with separate
//  containers. Without a group they each get their own item under the same
//  name, which is the worst shape this could take: the app would display and
//  reset a key the tunnel never uses, and both would look like they worked.
//
import Foundation
import Security
import os

enum DeviceIdentityFailure: LocalizedError {
    case generationFailed(Int32)
    case keychainFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case let .generationFailed(code):
            return "This device could not generate a VPN key (\(code))."
        case let .keychainFailed(status):
            return "This device's VPN key could not be stored or read (\(status))."
        }
    }
}

enum DeviceIdentityStore {
    /// 32 bytes, the length of both halves of the pair.
    static let keyLength = 32

    static let log = Logger(subsystem: "org.localtunnels.buddyvpn", category: "identity")

    private static let service = "org.localtunnels.buddyvpn.identity"
    private static let account = "static-keypair"
    /// Named identically in `scripts/ios-tunnel-extension.ts`, which writes
    /// it into both targets' entitlements. `$(AppIdentifierPrefix)` is the
    /// team prefix, filled in at build time.
    private static let accessGroup = "$(AppIdentifierPrefix)org.localtunnels.buddyvpn.shared"

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    /// The stored pair, private half first, or nil if there is none.
    static func load() throws -> (privateKey: Data, publicKey: Data)? {
        var item: CFTypeRef?
        var lookup = query()
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne

        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = item as? Data else {
            throw DeviceIdentityFailure.keychainFailed(status)
        }
        // Both halves in one item. A pair split across two can half-survive a
        // restore and leave a key that does not match the address the
        // coordinator has for it.
        guard data.count == keyLength * 2 else {
            log.error("the stored key is \(data.count) bytes, not \(keyLength * 2); discarding it")
            try forget()
            return nil
        }
        return (data.prefix(keyLength), data.suffix(keyLength))
    }

    static func store(privateKey: Data, publicKey: Data) throws {
        var item = query()
        item[kSecValueData as String] = privateKey + publicKey
        // Not `WhenUnlocked`: the system starts a packet tunnel with the
        // phone in a pocket, and a key that cannot be read then is a tunnel
        // that cannot reconnect until somebody looks at their screen.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw DeviceIdentityFailure.keychainFailed(status)
        }
    }

    /**
     Forget this device's key.

     The next connection is a different device to the coordinator, with a
     different address. Whatever the old key was allowed stays allowed until
     somebody removes it there — this reaches the device and nothing else.
     */
    static func forget() throws {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DeviceIdentityFailure.keychainFailed(status)
        }
    }

    /// What the coordinator calls this device, or nil if it has no key yet.
    /// Reads without generating: asking what something is called is not a
    /// reason to give it a name.
    static func publicKeyBase64IfPresent() -> String? {
        ((try? load()) ?? nil)?.publicKey.base64EncodedString()
    }
}

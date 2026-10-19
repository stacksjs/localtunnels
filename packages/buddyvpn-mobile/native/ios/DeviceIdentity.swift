//
//  This device's static keypair, kept where it belongs.
//
//  A node is its public key. The coordinator assigns an address against it,
//  peers encrypt to it, and a device that generates a new one on every launch
//  is a new device every launch — a fresh lease each time, and the pool
//  climbing for as long as the app is used.
//
//  So it is generated once and kept in the Keychain. Not in `UserDefaults`,
//  which is a plist in the container and readable by anything that can read
//  the container; and not in the App Group, which the app and the extension
//  share but which is no more protected than the rest of the sandbox. This
//  is the one secret this app holds.
//
//  `kSecAttrAccessibleAfterFirstUnlock` rather than `WhenUnlocked`: a packet
//  tunnel is started by the system, including while the phone is in a
//  pocket, and a key that cannot be read then is a tunnel that cannot
//  reconnect until somebody looks at their screen.
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

struct DeviceIdentity {
    /// 32 bytes. Never leaves this struct except into the handshake.
    let privateKey: Data
    let publicKey: Data

    /// What the coordinator knows this device by.
    var publicKeyBase64: String {
        publicKey.base64EncodedString()
    }

    private static let service = "org.localtunnels.buddyvpn.identity"
    private static let account = "static-keypair"
    private static let log = Logger(subsystem: "org.localtunnels.buddyvpn", category: "identity")

    /// The device's key, generated on first use and the same one after.
    static func loadOrCreate() throws -> DeviceIdentity {
        if let stored = try load() {
            return stored
        }
        let fresh = try generate()
        try store(fresh)
        log.notice("generated this device's static key")
        return fresh
    }

    /// Forget this device's key. The next connection is a different device
    /// to the coordinator, with a different address — which is what signing
    /// out should mean, and nothing less.
    static func forget() throws {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DeviceIdentityFailure.keychainFailed(status)
        }
    }

    private static func generate() throws -> DeviceIdentity {
        var priv = [UInt8](repeating: 0, count: Int(LTVPN_KEY_LEN))
        var pub = [UInt8](repeating: 0, count: Int(LTVPN_KEY_LEN))
        let result = ltvpn_keypair(&priv, &pub)
        guard result == 0 else {
            throw DeviceIdentityFailure.generationFailed(result)
        }
        return DeviceIdentity(privateKey: Data(priv), publicKey: Data(pub))
    }

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func load() throws -> DeviceIdentity? {
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
        // Both halves in one item, private first. A pair split across two
        // items can half-survive a restore and leave a key that does not
        // match the address the coordinator has for it.
        let length = Int(LTVPN_KEY_LEN)
        guard data.count == length * 2 else {
            log.error("the stored key is \(data.count) bytes, not \(length * 2); generating a new one")
            try forget()
            return nil
        }
        return DeviceIdentity(
            privateKey: data.prefix(length),
            publicKey: data.suffix(length)
        )
    }

    private static func store(_ identity: DeviceIdentity) throws {
        var item = query()
        item[kSecValueData as String] = identity.privateKey + identity.publicKey
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw DeviceIdentityFailure.keychainFailed(status)
        }
    }
}

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
//  The Keychain itself is `DeviceIdentityStore`, which both processes
//  compile. This half makes a key, which takes the crypto core, and only the
//  extension needs it.
//
import Foundation
import Security
import os

struct DeviceIdentity {
    /// 32 bytes. Never leaves this struct except into the handshake.
    let privateKey: Data
    let publicKey: Data

    /// What the coordinator knows this device by.
    var publicKeyBase64: String {
        publicKey.base64EncodedString()
    }

    /// The device's key, generated on first use and the same one after.
    static func loadOrCreate() throws -> DeviceIdentity {
        if let stored = try DeviceIdentityStore.load() {
            return DeviceIdentity(privateKey: stored.privateKey, publicKey: stored.publicKey)
        }
        var priv = [UInt8](repeating: 0, count: DeviceIdentityStore.keyLength)
        var pub = [UInt8](repeating: 0, count: DeviceIdentityStore.keyLength)
        let result = ltvpn_keypair(&priv, &pub)
        guard result == 0 else {
            throw DeviceIdentityFailure.generationFailed(result)
        }
        let fresh = DeviceIdentity(privateKey: Data(priv), publicKey: Data(pub))
        try DeviceIdentityStore.store(privateKey: fresh.privateKey, publicKey: fresh.publicKey)
        DeviceIdentityStore.log.notice("generated this device's static key")
        return fresh
    }
}

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
            /*
             * The stored public half is checked against the private one
             * rather than believed.
             *
             * `DeviceIdentityStore.load` keeps both halves in one item so a
             * pair cannot half-survive a restore, and that is only half the
             * problem: an item can be the right length and still hold two
             * keys that do not belong together. What that produces is the
             * worst kind of failure to read — the coordinator assigns an
             * address to the public key it was given, the exit authorises
             * that key, and the handshake then presents a different one, so
             * the only symptom is the exit refusing an unauthorised peer that
             * is in its directory.
             *
             * Deriving it is one scalar multiplication, once per tunnel
             * start, against a failure nobody could diagnose from either end.
             * It belongs here and not in the store because the store is
             * compiled into the app too, and the app does not link the
             * crypto core — which is the reason the two are separate files.
             */
            if try derives(publicKey: stored.publicKey, from: stored.privateKey) {
                return DeviceIdentity(privateKey: stored.privateKey, publicKey: stored.publicKey)
            }
            /*
             * Discarded rather than repaired.
             *
             * The public half could be recomputed and kept, but there is no
             * way to know which half is the damaged one: a private key that
             * is not the one this device registered with is a key whose
             * address belongs to somebody else's record. A new identity is a
             * new device to the coordinator, which is a lease and a fresh
             * address — recoverable, and unlike the alternative it is
             * visible, because the key the settings screen shows changes.
             */
            DeviceIdentityStore.log.error("this device's stored key halves do not match; generating a new identity")
            try DeviceIdentityStore.forget()
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

    /// Whether `publicKey` is the one `privateKey` produces. The same
    /// derivation the desktop uses in `publicKeyFromPrivate`.
    private static func derives(publicKey: Data, from privateKey: Data) throws -> Bool {
        guard privateKey.count == DeviceIdentityStore.keyLength,
              publicKey.count == DeviceIdentityStore.keyLength
        else { return false }

        var derived = [UInt8](repeating: 0, count: DeviceIdentityStore.keyLength)
        let result = privateKey.withUnsafeBytes { priv in
            ltvpn_pubkey(priv.bindMemory(to: UInt8.self).baseAddress, &derived)
        }
        guard result == 0 else {
            // The core could not derive one at all, which is not a verdict on
            // the stored pair. Throwing keeps a working identity from being
            // thrown away because the library is unusable.
            throw DeviceIdentityFailure.generationFailed(result)
        }
        /*
         * Constant time, though neither side is a secret: the public half is
         * published to the coordinator and the derived half is computed from
         * the key this process already holds. It costs nothing here, and a
         * comparison that leaks is a thing somebody copies to a place where
         * it matters.
         */
        var equal: UInt8 = 0
        for (a, b) in zip(derived, publicKey) {
            equal |= a ^ b
        }
        return equal == 0
    }
}

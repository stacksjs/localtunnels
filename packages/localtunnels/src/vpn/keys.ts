import type { VpnKeyPair } from './types'
import { loadNative, VpnUnavailableError } from './ffi'

/**
 * Generate a fresh Curve25519 keypair via the native library (seeded from OS
 * entropy). Throws {@link VpnUnavailableError} if the native lib is missing.
 */
export function generateKeyPair(): VpnKeyPair {
  const lib = loadNative()
  const priv = new Uint8Array(32)
  const pub = new Uint8Array(32)
  const rc = lib.ltvpn_keypair(priv, pub)
  if (rc !== 0)
    throw new VpnUnavailableError(`key generation failed (code ${rc})`)
  return { privateKey: priv, publicKey: pub }
}

/** Derive the public key for a given 32-byte private key. */
export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== 32)
    throw new TypeError('private key must be 32 bytes')
  const lib = loadNative()
  const pub = new Uint8Array(32)
  const rc = lib.ltvpn_pubkey(privateKey, pub)
  if (rc !== 0)
    throw new VpnUnavailableError(`public key derivation failed (code ${rc})`)
  return pub
}

/** Encode a 32-byte key as standard base64 (WireGuard's on-the-wire format). */
export function encodeKey(key: Uint8Array): string {
  if (key.length !== 32)
    throw new TypeError('key must be 32 bytes')
  return Buffer.from(key).toString('base64')
}

/** Decode a base64-encoded 32-byte key. */
export function decodeKey(encoded: string): Uint8Array {
  const buf = Buffer.from(encoded, 'base64')
  if (buf.length !== 32)
    throw new TypeError(`decoded key must be 32 bytes, got ${buf.length}`)
  return new Uint8Array(buf)
}

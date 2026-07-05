/**
 * A Curve25519 keypair. Both keys are 32 raw bytes; use the base64 helpers in
 * `keys.ts` for storage and display (WireGuard-compatible encoding).
 */
export interface VpnKeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

/** WireGuard message sizes (bytes on the wire). */
export const HANDSHAKE_INITIATION_LEN = 148
export const HANDSHAKE_RESPONSE_LEN = 92

/** Transport framing overhead: 16-byte header + 16-byte Poly1305 tag. */
export const TRANSPORT_OVERHEAD = 32

/**
 * A completed WireGuard-style handshake, ready to derive a transport session.
 * `peerPublicKey` is only populated on the responder side (learned from the
 * initiation message) — the caller MUST verify it names an authorized peer.
 */
export interface HandshakeResult {
  peerIndex: number
  peerPublicKey?: Uint8Array
  timestamp?: Uint8Array
}

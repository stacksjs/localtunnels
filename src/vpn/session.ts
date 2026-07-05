import type { Pointer } from 'bun:ffi'
import type { LtvpnSymbols } from './ffi'
import type { HandshakeResult } from './types'
import { errorName, loadNative } from './ffi'
import { HANDSHAKE_INITIATION_LEN, HANDSHAKE_RESPONSE_LEN } from './types'

export class VpnProtocolError extends Error {
  readonly code: number
  constructor(op: string, code: number) {
    super(`${op} failed: ${errorName(code)} (${code})`)
    this.name = 'VpnProtocolError'
    this.code = code
  }
}

function nowParts(): { sec: bigint, nano: number } {
  const ms = Date.now()
  const sec = BigInt(Math.floor(ms / 1000))
  const nano = (ms % 1000) * 1_000_000
  return { sec, nano }
}

/**
 * One side of a WireGuard-style IKpsk2 handshake. Wraps the native
 * `HandshakeState`; call {@link free} (or {@link intoSession}, which consumes
 * it) to release native memory.
 */
export class Handshake {
  private readonly lib: LtvpnSymbols
  private ptr: Pointer | null

  private constructor(lib: LtvpnSymbols, ptr: Pointer) {
    this.lib = lib
    this.ptr = ptr
  }

  /** Create an initiator handshake toward a known peer public key. */
  static initiator(staticPrivate: Uint8Array, peerPublic: Uint8Array, psk?: Uint8Array): Handshake {
    return Handshake.create(1, staticPrivate, peerPublic, psk)
  }

  /** Create a responder handshake (peer identity is learned from the initiation). */
  static responder(staticPrivate: Uint8Array, psk?: Uint8Array): Handshake {
    return Handshake.create(0, staticPrivate, null, psk)
  }

  private static create(isInitiator: number, staticPrivate: Uint8Array, peerPublic: Uint8Array | null, psk?: Uint8Array): Handshake {
    if (staticPrivate.length !== 32)
      throw new TypeError('static private key must be 32 bytes')
    if (peerPublic && peerPublic.length !== 32)
      throw new TypeError('peer public key must be 32 bytes')
    if (psk && psk.length !== 32)
      throw new TypeError('preshared key must be 32 bytes')
    const lib = loadNative()
    const ptr = lib.ltvpn_hs_new(isInitiator, staticPrivate, peerPublic ?? null, psk ?? null)
    if (!ptr)
      throw new VpnProtocolError('handshake init', -1)
    return new Handshake(lib, ptr)
  }

  private handle(): Pointer {
    if (this.ptr === null)
      throw new Error('handshake already consumed or freed')
    return this.ptr
  }

  /** Initiator: produce the 148-byte initiation message. */
  createInitiation(senderIndex: number): Uint8Array {
    const out = new Uint8Array(HANDSHAKE_INITIATION_LEN)
    const { sec, nano } = nowParts()
    const rc = this.lib.ltvpn_hs_create_initiation(this.handle(), senderIndex, sec, nano, out)
    if (rc !== 0)
      throw new VpnProtocolError('createInitiation', rc)
    return out
  }

  /** Responder: consume an initiation, learning the peer's identity. */
  consumeInitiation(msg: Uint8Array): HandshakeResult {
    if (msg.length !== HANDSHAKE_INITIATION_LEN)
      throw new TypeError(`initiation must be ${HANDSHAKE_INITIATION_LEN} bytes`)
    const peerPub = new Uint8Array(32)
    const peerIndexBuf = new Uint8Array(4)
    const timestamp = new Uint8Array(12)
    const rc = this.lib.ltvpn_hs_consume_initiation(this.handle(), msg, peerPub, peerIndexBuf, timestamp)
    if (rc !== 0)
      throw new VpnProtocolError('consumeInitiation', rc)
    const peerIndex = new DataView(peerIndexBuf.buffer).getUint32(0, true)
    return { peerIndex, peerPublicKey: peerPub, timestamp }
  }

  /** Responder: produce the 92-byte response message. */
  createResponse(senderIndex: number): Uint8Array {
    const out = new Uint8Array(HANDSHAKE_RESPONSE_LEN)
    const rc = this.lib.ltvpn_hs_create_response(this.handle(), senderIndex, out)
    if (rc !== 0)
      throw new VpnProtocolError('createResponse', rc)
    return out
  }

  /** Initiator: consume the response, completing the handshake. */
  consumeResponse(msg: Uint8Array): void {
    if (msg.length !== HANDSHAKE_RESPONSE_LEN)
      throw new TypeError(`response must be ${HANDSHAKE_RESPONSE_LEN} bytes`)
    const rc = this.lib.ltvpn_hs_consume_response(this.handle(), msg)
    if (rc !== 0)
      throw new VpnProtocolError('consumeResponse', rc)
  }

  /** The peer's session index, valid once the handshake has progressed. */
  peerIndex(): number {
    return this.lib.ltvpn_hs_peer_index(this.handle())
  }

  /**
   * Derive the transport session from the completed handshake. Consumes and
   * frees this handshake.
   */
  intoSession(localIndex: number): Session {
    const ptr = this.lib.ltvpn_session_from_handshake(this.handle())
    const peerIndex = this.peerIndex()
    this.free()
    if (!ptr)
      throw new VpnProtocolError('deriveSession', -1)
    return new Session(this.lib, ptr, localIndex, peerIndex)
  }

  free(): void {
    if (this.ptr !== null) {
      this.lib.ltvpn_hs_free(this.ptr)
      this.ptr = null
    }
  }
}

/**
 * An established transport session. Encrypts/decrypts data packets with
 * ChaCha20-Poly1305 and enforces replay protection natively.
 */
export class Session {
  private readonly lib: LtvpnSymbols
  private ptr: Pointer | null
  readonly localIndex: number
  readonly peerIndex: number

  constructor(lib: LtvpnSymbols, ptr: Pointer, localIndex: number, peerIndex: number) {
    this.lib = lib
    this.ptr = ptr
    this.localIndex = localIndex
    this.peerIndex = peerIndex
  }

  private handle(): Pointer {
    if (this.ptr === null)
      throw new Error('session already freed')
    return this.ptr
  }

  /** Encrypt one plaintext packet, returning the full wire message. */
  encrypt(plaintext: Uint8Array): Uint8Array {
    const cap = Number(this.lib.ltvpn_encrypted_len(BigInt(plaintext.length)))
    const out = new Uint8Array(cap)
    const n = Number(this.lib.ltvpn_session_encrypt(this.handle(), plaintext, BigInt(plaintext.length), out, BigInt(cap)))
    if (n < 0)
      throw new VpnProtocolError('encrypt', n)
    return out.subarray(0, n)
  }

  /**
   * Decrypt one wire message. Returns the padded plaintext (WireGuard pads to
   * a 16-byte boundary; recover the true length from the inner IP header).
   */
  decrypt(msg: Uint8Array): Uint8Array {
    const cap = msg.length
    const out = new Uint8Array(cap)
    const n = Number(this.lib.ltvpn_session_decrypt(this.handle(), msg, BigInt(msg.length), out, BigInt(cap)))
    if (n < 0)
      throw new VpnProtocolError('decrypt', n)
    return out.subarray(0, n)
  }

  /**
   * Native fast path: drain up to `maxPackets` plaintext packets from `inFd`,
   * encrypt each, and write them to `outFd` — all in one FFI call, no per-packet
   * crossing. `inFd`/`outFd` are raw descriptors (a TUN device and a connected
   * UDP socket in production). Returns the number of packets forwarded.
   */
  forwardEncryptFrom(inFd: number, outFd: number, maxPackets = 64): number {
    return Number(this.lib.ltvpn_forward_encrypt(this.handle(), inFd, outFd, BigInt(maxPackets)))
  }

  /** Native fast path in reverse: decrypt wire messages from `inFd` to `outFd`. */
  forwardDecryptFrom(inFd: number, outFd: number, maxPackets = 64): number {
    return Number(this.lib.ltvpn_forward_decrypt(this.handle(), inFd, outFd, BigInt(maxPackets)))
  }

  free(): void {
    if (this.ptr !== null) {
      this.lib.ltvpn_session_free(this.ptr)
      this.ptr = null
    }
  }
}

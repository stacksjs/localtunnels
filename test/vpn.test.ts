import { describe, expect, it } from 'bun:test'
import {
  decodeKey,
  encodeKey,
  generateKeyPair,
  Handshake,
  HANDSHAKE_INITIATION_LEN,
  HANDSHAKE_RESPONSE_LEN,
  isVpnAvailable,
  publicKeyFromPrivate,
  VpnProtocolError,
} from '../src/vpn'

// The native libltvpn library is required for these tests. When it hasn't been
// built (`cd native && zig build`), skip rather than fail so the rest of the
// suite still runs in environments without a Zig toolchain.
const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

if (!available) {
  // eslint-disable-next-line no-console
  console.warn('[vpn.test] native libltvpn not built — skipping VPN tests. Run `cd native && zig build`.')
}

/** Drive a full initiator/responder handshake and return both sessions. */
function completeHandshake(psk?: Uint8Array) {
  const a = generateKeyPair()
  const b = generateKeyPair()

  const ini = Handshake.initiator(a.privateKey, b.publicKey, psk)
  const res = Handshake.responder(b.privateKey, psk)

  const m1 = ini.createInitiation(0x0000_0001)
  const learned = res.consumeInitiation(m1)
  const m2 = res.createResponse(0x0000_0002)
  ini.consumeResponse(m2)

  return {
    a,
    b,
    learned,
    initiatorSession: ini.intoSession(0x0000_0001),
    responderSession: res.intoSession(0x0000_0002),
  }
}

describeVpn('vpn/keys', () => {
  it('generates distinct 32-byte keypairs', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    expect(a.privateKey.length).toBe(32)
    expect(a.publicKey.length).toBe(32)
    expect(encodeKey(a.publicKey)).not.toBe(encodeKey(b.publicKey))
  })

  it('derives the same public key the generator produced', () => {
    const kp = generateKeyPair()
    const derived = publicKeyFromPrivate(kp.privateKey)
    expect(encodeKey(derived)).toBe(encodeKey(kp.publicKey))
  })

  it('round-trips keys through base64', () => {
    const kp = generateKeyPair()
    const encoded = encodeKey(kp.publicKey)
    expect(encoded).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect([...decodeKey(encoded)]).toEqual([...kp.publicKey])
  })

  it('rejects malformed base64 keys', () => {
    expect(() => decodeKey('too-short')).toThrow()
  })
})

describeVpn('vpn/handshake', () => {
  it('produces spec-sized messages', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const ini = Handshake.initiator(a.privateKey, b.publicKey)
    const res = Handshake.responder(b.privateKey)
    const m1 = ini.createInitiation(1)
    expect(m1.length).toBe(HANDSHAKE_INITIATION_LEN)
    res.consumeInitiation(m1)
    const m2 = res.createResponse(2)
    expect(m2.length).toBe(HANDSHAKE_RESPONSE_LEN)
    ini.free()
    res.free()
  })

  it('lets the responder learn the initiator identity', () => {
    const { a, learned, initiatorSession, responderSession } = completeHandshake()
    expect(learned.peerPublicKey).toBeDefined()
    expect(encodeKey(learned.peerPublicKey!)).toBe(encodeKey(a.publicKey))
    expect(learned.peerIndex).toBe(0x0000_0001)
    initiatorSession.free()
    responderSession.free()
  })

  it('fails the handshake on a preshared-key mismatch', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const pskA = new Uint8Array(32).fill(1)
    const pskB = new Uint8Array(32).fill(2)
    const ini = Handshake.initiator(a.privateKey, b.publicKey, pskA)
    const res = Handshake.responder(b.privateKey, pskB)
    const m1 = ini.createInitiation(1)
    res.consumeInitiation(m1)
    const m2 = res.createResponse(2)
    expect(() => ini.consumeResponse(m2)).toThrow(VpnProtocolError)
    ini.free()
    res.free()
  })

  it('rejects a tampered initiation via mac1', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const ini = Handshake.initiator(a.privateKey, b.publicKey)
    const res = Handshake.responder(b.privateKey)
    const m1 = ini.createInitiation(1)
    m1[40] ^= 0xFF
    expect(() => res.consumeInitiation(m1)).toThrow(/invalid_mac/)
    ini.free()
    res.free()
  })
})

describeVpn('vpn/transport', () => {
  it('encrypts and decrypts a packet both directions', () => {
    const { initiatorSession, responderSession } = completeHandshake()
    const msg = new TextEncoder().encode('the quick brown fox jumps over the lazy dog')

    const wire = initiatorSession.encrypt(msg)
    expect(wire.length).toBeGreaterThan(msg.length)
    const back = responderSession.decrypt(wire)
    expect(new TextDecoder().decode(back.subarray(0, msg.length))).toBe('the quick brown fox jumps over the lazy dog')

    // Reverse direction uses independent keys/counters.
    const reply = responderSession.encrypt(new TextEncoder().encode('pong'))
    const replyPlain = initiatorSession.decrypt(reply)
    expect(new TextDecoder().decode(replyPlain.subarray(0, 4))).toBe('pong')

    initiatorSession.free()
    responderSession.free()
  })

  it('rejects replayed packets', () => {
    const { initiatorSession, responderSession } = completeHandshake()
    const wire = initiatorSession.encrypt(new TextEncoder().encode('once'))
    responderSession.decrypt(wire)
    expect(() => responderSession.decrypt(wire)).toThrow(/replay/)
    initiatorSession.free()
    responderSession.free()
  })

  it('rejects tampered ciphertext', () => {
    const { initiatorSession, responderSession } = completeHandshake()
    const wire = initiatorSession.encrypt(new TextEncoder().encode('secret'))
    wire[16] ^= 0x01
    expect(() => responderSession.decrypt(wire)).toThrow(/decrypt_failed/)
    initiatorSession.free()
    responderSession.free()
  })

  it('handles empty keepalive packets', () => {
    const { initiatorSession, responderSession } = completeHandshake()
    const wire = initiatorSession.encrypt(new Uint8Array(0))
    const back = responderSession.decrypt(wire)
    expect(back.length).toBe(0)
    initiatorSession.free()
    responderSession.free()
  })
})

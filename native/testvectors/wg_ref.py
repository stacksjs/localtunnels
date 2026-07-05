#!/usr/bin/env python3
"""Independent reference implementation of the WireGuard v1 handshake.

This is deliberately a *separate* implementation from the Zig core, written in a
different language with hand-rolled primitives, so that byte-for-byte agreement
between the two is strong evidence of wire-correctness (the same role the
official WireGuard test vectors play). Every primitive is validated against its
RFC test vector in `self_test()` before any handshake vector is emitted.

Primitives:
  - BLAKE2s / HMAC-BLAKE2s: Python stdlib (authoritative)
  - X25519: hand-rolled Montgomery ladder, checked vs RFC 7748 §5.2
  - ChaCha20-Poly1305: hand-rolled, checked vs RFC 8439 §2.8.2
"""
import hashlib
import hmac
import json
import struct
import sys

P = 2 ** 255 - 19


# ── X25519 (RFC 7748) ────────────────────────────────────────────────────────

def _cswap(swap, a, b):
    dummy = swap * ((a - b) % P)
    return (a - dummy) % P, (b + dummy) % P


def x25519(scalar: bytes, u: bytes) -> bytes:
    k = bytearray(scalar)
    k[0] &= 248
    k[31] &= 127
    k[31] |= 64
    k = int.from_bytes(k, 'little')
    x1 = int.from_bytes(u, 'little') % P
    x2, z2, x3, z3 = 1, 0, x1, 1
    swap = 0
    for t in reversed(range(255)):
        kt = (k >> t) & 1
        swap ^= kt
        x2, x3 = _cswap(swap, x2, x3)
        z2, z3 = _cswap(swap, z2, z3)
        swap = kt
        A = (x2 + z2) % P
        AA = (A * A) % P
        B = (x2 - z2) % P
        BB = (B * B) % P
        E = (AA - BB) % P
        C = (x3 + z3) % P
        D = (x3 - z3) % P
        DA = (D * A) % P
        CB = (C * B) % P
        x3 = pow((DA + CB) % P, 2, P)
        z3 = (x1 * pow((DA - CB) % P, 2, P)) % P
        x2 = (AA * BB) % P
        z2 = (E * (AA + 121665 * E)) % P
    x2, x3 = _cswap(swap, x2, x3)
    z2, z3 = _cswap(swap, z2, z3)
    res = (x2 * pow(z2, P - 2, P)) % P
    return res.to_bytes(32, 'little')


def x25519_base(scalar: bytes) -> bytes:
    return x25519(scalar, (9).to_bytes(32, 'little'))


# ── ChaCha20-Poly1305 (RFC 8439) ─────────────────────────────────────────────

def _rotl(x, n):
    return ((x << n) | (x >> (32 - n))) & 0xffffffff


def _qr(s, a, b, c, d):
    s[a] = (s[a] + s[b]) & 0xffffffff; s[d] = _rotl(s[d] ^ s[a], 16)
    s[c] = (s[c] + s[d]) & 0xffffffff; s[b] = _rotl(s[b] ^ s[c], 12)
    s[a] = (s[a] + s[b]) & 0xffffffff; s[d] = _rotl(s[d] ^ s[a], 8)
    s[c] = (s[c] + s[d]) & 0xffffffff; s[b] = _rotl(s[b] ^ s[c], 7)


def _chacha_block(key, counter, nonce):
    const = b"expand 32-byte k"
    state = list(struct.unpack('<4I', const)) + list(struct.unpack('<8I', key)) \
        + [counter] + list(struct.unpack('<3I', nonce))
    work = list(state)
    for _ in range(10):
        _qr(work, 0, 4, 8, 12); _qr(work, 1, 5, 9, 13)
        _qr(work, 2, 6, 10, 14); _qr(work, 3, 7, 11, 15)
        _qr(work, 0, 5, 10, 15); _qr(work, 1, 6, 11, 12)
        _qr(work, 2, 7, 8, 13); _qr(work, 3, 4, 9, 14)
    out = [(work[i] + state[i]) & 0xffffffff for i in range(16)]
    return struct.pack('<16I', *out)


def _chacha20(key, counter, nonce, data):
    out = bytearray()
    for i in range(0, len(data), 64):
        block = _chacha_block(key, counter + i // 64, nonce)
        chunk = data[i:i + 64]
        out += bytes(a ^ b for a, b in zip(chunk, block))
    return bytes(out)


def _poly1305(key, msg):
    r = int.from_bytes(key[:16], 'little') & 0x0ffffffc0ffffffc0ffffffc0fffffff
    s = int.from_bytes(key[16:32], 'little')
    acc = 0
    p = (1 << 130) - 5
    for i in range(0, len(msg), 16):
        chunk = msg[i:i + 16]
        n = int.from_bytes(chunk + b'\x01' + b'\x00' * (16 - len(chunk)), 'little') \
            if len(chunk) < 16 else int.from_bytes(chunk + b'\x01', 'little')
        acc = ((acc + n) * r) % p
    acc = (acc + s) & ((1 << 128) - 1)
    return acc.to_bytes(16, 'little')


def _pad16(x):
    return b'\x00' * ((16 - len(x) % 16) % 16)


def chacha20poly1305_encrypt(key, nonce, plaintext, aad):
    otk = _chacha_block(key, 0, nonce)[:32]
    ct = _chacha20(key, 1, nonce, plaintext)
    mac_data = aad + _pad16(aad) + ct + _pad16(ct) \
        + struct.pack('<Q', len(aad)) + struct.pack('<Q', len(ct))
    tag = _poly1305(otk, mac_data)
    return ct + tag


# ── WireGuard handshake ──────────────────────────────────────────────────────

CONSTRUCTION = b"Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s"
IDENTIFIER = b"WireGuard v1 zx2c4 Jason@zx2c4.com"
LABEL_MAC1 = b"mac1----"


def blake2s(*parts):
    h = hashlib.blake2s(digest_size=32)
    for p in parts:
        h.update(p)
    return h.digest()


def mac16(key, data):
    return hashlib.blake2s(data, digest_size=16, key=key).digest()


def hmac_b2s(key, data):
    return hmac.new(key, data, hashlib.blake2s).digest()


def kdf(key, data, n):
    t0 = hmac_b2s(key, data)
    out = []
    prev = b""
    for i in range(1, n + 1):
        prev = hmac_b2s(t0, prev + bytes([i]))
        out.append(prev)
    return out


def tai64n(unix_sec, nano):
    return struct.pack('>Q', 0x400000000000000a + unix_sec) + struct.pack('>I', nano)


def aead(key, counter, plaintext, aad):
    nonce = b'\x00\x00\x00\x00' + struct.pack('<Q', counter)
    return chacha20poly1305_encrypt(key, nonce, plaintext, aad)


def initiation(s_priv_i, s_pub_i, s_pub_r, e_priv_i, e_pub_i, sender_index, unix_sec, nano):
    c = blake2s(CONSTRUCTION)
    h = blake2s(blake2s(c, IDENTIFIER), s_pub_r)
    msg = bytearray()
    msg += bytes([1, 0, 0, 0])
    msg += struct.pack('<I', sender_index)
    # ephemeral
    c = kdf(c, e_pub_i, 1)[0]
    msg += e_pub_i
    h = blake2s(h, e_pub_i)
    # static
    c, k = kdf(c, x25519(e_priv_i, s_pub_r), 2)
    enc_static = aead(k, 0, s_pub_i, h)
    msg += enc_static
    h = blake2s(h, enc_static)
    # timestamp
    c, k = kdf(c, x25519(s_priv_i, s_pub_r), 2)
    ts = tai64n(unix_sec, nano)
    enc_ts = aead(k, 0, ts, h)
    msg += enc_ts
    h = blake2s(h, enc_ts)
    # mac1
    m1 = mac16(blake2s(LABEL_MAC1, s_pub_r), bytes(msg))
    msg += m1
    msg += b'\x00' * 16
    return bytes(msg), c, h


def response(c, h, s_priv_r, s_pub_i, e_priv_r, e_pub_r, e_pub_i, psk, sender_index, receiver_index):
    msg = bytearray()
    msg += bytes([2, 0, 0, 0])
    msg += struct.pack('<I', sender_index)
    msg += struct.pack('<I', receiver_index)
    c = kdf(c, e_pub_r, 1)[0]
    msg += e_pub_r
    h = blake2s(h, e_pub_r)
    c = kdf(c, x25519(e_priv_r, e_pub_i), 1)[0]
    c = kdf(c, x25519(e_priv_r, s_pub_i), 1)[0]
    c, tau, k = kdf(c, psk, 3)
    h = blake2s(h, tau)
    enc_empty = aead(k, 0, b"", h)
    msg += enc_empty
    h = blake2s(h, enc_empty)
    m1 = mac16(blake2s(LABEL_MAC1, s_pub_i), bytes(msg))
    msg += m1
    msg += b'\x00' * 16
    t1, t2 = kdf(c, b"", 2)
    return bytes(msg), t1, t2  # responder: send=t2, recv=t1


def self_test():
    # RFC 7748 §5.2 X25519 test vector.
    scalar = bytes.fromhex("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4")
    u = bytes.fromhex("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c")
    out = bytes.fromhex("c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552")
    assert x25519(scalar, u) == out, "X25519 RFC 7748 vector failed"

    # RFC 8439 §2.8.2 ChaCha20-Poly1305 AEAD vector.
    key = bytes(range(0x80, 0xa0))
    nonce = bytes.fromhex("070000004041424344454647")
    aad_v = bytes.fromhex("50515253c0c1c2c3c4c5c6c7")
    pt = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."
    ct = chacha20poly1305_encrypt(key, nonce, pt, aad_v)
    assert ct[-16:].hex() == "1ae10b594f09e26a7e902ecbd0600691", "ChaCha20-Poly1305 RFC 8439 tag failed"

    # BLAKE2s("abc") known answer (RFC 7693 appendix E).
    assert blake2s(b"abc").hex() == "508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982"


def main():
    self_test()

    # Deterministic inputs — fixed keys so the vector is reproducible.
    s_priv_i = bytes([0x11] * 32)
    s_priv_r = bytes([0x22] * 32)
    e_priv_i = bytes([0x33] * 32)
    e_priv_r = bytes([0x44] * 32)
    psk = bytes([0x55] * 32)

    s_pub_i = x25519_base(s_priv_i)
    s_pub_r = x25519_base(s_priv_r)
    e_pub_i = x25519_base(e_priv_i)
    e_pub_r = x25519_base(e_priv_r)

    sender_i = 0x01020304
    sender_r = 0x0a0b0c0d
    unix_sec, nano = 1_700_000_000, 42

    m1, c, h = initiation(s_priv_i, s_pub_i, s_pub_r, e_priv_i, e_pub_i, sender_i, unix_sec, nano)
    m2, t1, t2 = response(c, h, s_priv_r, s_pub_i, e_priv_r, e_pub_r, e_pub_i, psk, sender_r, sender_i)

    vec = {
        "s_priv_i": s_priv_i.hex(), "s_pub_i": s_pub_i.hex(),
        "s_priv_r": s_priv_r.hex(), "s_pub_r": s_pub_r.hex(),
        "e_priv_i": e_priv_i.hex(), "e_pub_i": e_pub_i.hex(),
        "e_priv_r": e_priv_r.hex(), "e_pub_r": e_pub_r.hex(),
        "psk": psk.hex(),
        "sender_i": sender_i, "sender_r": sender_r,
        "unix_sec": unix_sec, "nano": nano,
        "initiation": m1.hex(),
        "response": m2.hex(),
        "initiator_send_key": t1.hex(),  # initiator: send=t1, recv=t2
        "initiator_recv_key": t2.hex(),
        "initial_chain_key": blake2s(CONSTRUCTION).hex(),
        "initial_hash": blake2s(blake2s(CONSTRUCTION), IDENTIFIER).hex(),
    }
    json.dump(vec, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

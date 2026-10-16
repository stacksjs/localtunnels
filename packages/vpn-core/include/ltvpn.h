/*
 * libltvpn, for callers that link it rather than dlopen it.
 *
 * The desktop app reaches this library through bun:ffi, which reads the
 * symbols out of a shared object and needs no header at all. An iOS Network
 * Extension cannot: it is Swift in a separate process with no dynamic loading
 * worth the name, so it links a static archive and needs this to know what is
 * in it.
 *
 * Keep in step with `src/lib.zig`. The one guard against drift is
 * `ltvpn_version`, which answers `LTVPN_ABI_VERSION` below; a caller that
 * checks it at startup finds a mismatch immediately rather than through a
 * wrong-sized struct much later.
 *
 * ── What is deliberately absent ────────────────────────────────────────
 *
 * The `ltvpn_tun_*` family. Those open and drive a utun device, which is how
 * the macOS build gets its packets, and an extension on iOS never does: the
 * system hands it a `packetFlow` to read from and write to, and there is no
 * file descriptor to give this library. Declaring them here would invite
 * exactly the wrong call.
 */
#ifndef LTVPN_H
#define LTVPN_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** The ABI this header describes. `ltvpn_version()` must agree. */
#define LTVPN_ABI_VERSION 4

/** Wire sizes, fixed by the protocol. */
#define LTVPN_KEY_LEN 32
#define LTVPN_INITIATION_LEN 148
#define LTVPN_RESPONSE_LEN 92
#define LTVPN_MAX_PLAINTEXT_LEN 4096

/** Opaque handshake state. Freed with `ltvpn_hs_free`. */
typedef struct LtvpnHandshake LtvpnHandshake;
/** Opaque transport session. Freed with `ltvpn_session_free`. */
typedef struct LtvpnSession LtvpnSession;

/** The ABI version this library was built with. */
uint32_t ltvpn_version(void);

/* ── Keys ──────────────────────────────────────────────────────────────── */

/** A fresh static keypair. Returns 0, or a negative error code. */
int32_t ltvpn_keypair(uint8_t out_priv[LTVPN_KEY_LEN], uint8_t out_pub[LTVPN_KEY_LEN]);

/** The public key for a private one. Returns 0, or a negative error code. */
int32_t ltvpn_pubkey(const uint8_t priv[LTVPN_KEY_LEN], uint8_t out_pub[LTVPN_KEY_LEN]);

/* ── Handshake ─────────────────────────────────────────────────────────── */

/**
 * Begin a handshake. `psk` may be NULL. Returns NULL on bad arguments.
 * The result is owned by the caller until `ltvpn_hs_free`, or until
 * `ltvpn_session_from_handshake` consumes it.
 */
LtvpnHandshake *ltvpn_hs_new(uint8_t is_initiator,
                             const uint8_t static_priv[LTVPN_KEY_LEN],
                             const uint8_t peer_static_pub[LTVPN_KEY_LEN],
                             const uint8_t psk[LTVPN_KEY_LEN]);

void ltvpn_hs_free(LtvpnHandshake *hs);

/** Returns 0, or a negative error code. */
int32_t ltvpn_hs_create_initiation(LtvpnHandshake *hs, uint32_t sender_index,
                                   uint64_t unix_sec, uint8_t out[LTVPN_INITIATION_LEN]);

int32_t ltvpn_hs_consume_initiation(LtvpnHandshake *hs, const uint8_t msg[LTVPN_INITIATION_LEN]);

int32_t ltvpn_hs_create_response(LtvpnHandshake *hs, uint32_t sender_index,
                                 uint8_t out[LTVPN_RESPONSE_LEN]);

int32_t ltvpn_hs_consume_response(LtvpnHandshake *hs, const uint8_t msg[LTVPN_RESPONSE_LEN]);

uint32_t ltvpn_hs_peer_index(const LtvpnHandshake *hs);

/* ── Transport ─────────────────────────────────────────────────────────── */

/** Derive a session from a completed handshake. The handshake is consumed. */
LtvpnSession *ltvpn_session_from_handshake(LtvpnHandshake *hs);

LtvpnSession *ltvpn_session_new(const uint8_t send_key[LTVPN_KEY_LEN],
                                const uint8_t recv_key[LTVPN_KEY_LEN],
                                uint32_t local_index, uint32_t peer_index);

void ltvpn_session_free(LtvpnSession *s);

/** Messages sent so far, which is what decides when to rekey. */
uint64_t ltvpn_session_send_counter(const LtvpnSession *s);

/** Bytes needed for `plain_len` of plaintext, or 0 if that is too long. */
size_t ltvpn_encrypted_len(size_t plain_len);

/**
 * Encrypt one packet. Returns bytes written, or a negative error code.
 * `plaintext` may be NULL only when `plain_len` is 0, which is a keepalive.
 */
int64_t ltvpn_session_encrypt(LtvpnSession *s, const uint8_t *plaintext, size_t plain_len,
                              uint8_t *out, size_t out_cap);

/** Decrypt one packet. Returns bytes written, or a negative error code. */
int64_t ltvpn_session_decrypt(LtvpnSession *s, const uint8_t *msg, size_t msg_len,
                              uint8_t *out, size_t out_cap);

#ifdef __cplusplus
}
#endif

#endif /* LTVPN_H */

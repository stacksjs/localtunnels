//! WireGuard cookie-reply (type 3) and mac2 — the DoS-mitigation path from the
//! whitepaper §5.4.7. Under load a responder replies with an encrypted cookie
//! instead of doing expensive crypto; the initiator then stamps mac2 onto its
//! retry so the responder can cheaply verify the sender controls its claimed
//! source address before committing work.
const std = @import("std");
const kdf = @import("kdf.zig");
const rand = @import("rand.zig");

const XChaCha20Poly1305 = std.crypto.aead.chacha_poly.XChaCha20Poly1305;

pub const label_cookie = "cookie--";
pub const message_type_cookie_reply: u8 = 3;

pub const cookie_reply_len = 64; // type(1)+res(3) | receiver(4) | nonce(24) | enc_cookie(16+16)

pub const Error = error{ InvalidMessage, DecryptFailed, EntropyUnavailable };

/// Cookie key = HASH(LABEL_COOKIE ‖ responder_static_pub) — the XAEAD key
/// protecting the cookie reply on the wire. This is derivable from public
/// data by design (the initiator must be able to open the reply); it must
/// NOT be used as the secret that mints cookies — see `computeCookie`.
pub fn cookieKey(out: *[32]u8, responder_static_pub: *const [32]u8) void {
    kdf.hash(out, &.{ label_cookie, responder_static_pub });
}

/// τ = MAC(R_m, source_endpoint_bytes) — the responder's per-source cookie.
/// `secret` is R_m from the whitepaper: a random value the responder
/// generates itself and rotates every two minutes. It must never be derived
/// from public data (e.g. the `cookieKey` output), or anyone could mint
/// valid cookies for spoofed addresses and defeat the DoS protection.
/// `endpoint` is any stable encoding of the initiator's address.
pub fn computeCookie(out: *[16]u8, secret: *const [32]u8, endpoint: []const u8) void {
    kdf.mac(out, secret, endpoint);
}

/// mac2 = MAC(cookie, msg[0..offsetof(mac2)]). The 16-byte cookie is the MAC
/// key (keyed BLAKE2s-128). When the sender holds no cookie, mac2 is all zero.
pub fn computeMac2(out: *[16]u8, cookie: *const [16]u8, msg: []const u8) void {
    kdf.Blake2s128.hash(msg, out, .{ .key = cookie });
}

/// Constant-time check of a message's mac2 against the expected cookie.
/// `msg_alpha` is the message bytes up to (excluding) the mac2 field.
pub fn verifyMac2(cookie: *const [16]u8, msg_alpha: []const u8, mac2: *const [16]u8) bool {
    var expected: [16]u8 = undefined;
    computeMac2(&expected, cookie, msg_alpha);
    return std.crypto.timing_safe.eql([16]u8, expected, mac2.*);
}

/// Build a cookie-reply message. `trigger_mac1` is the mac1 of the message that
/// prompted this reply (used as AEAD associated data).
pub fn buildCookieReply(
    out: *[cookie_reply_len]u8,
    receiver_index: u32,
    cookie_key: *const [32]u8,
    cookie: *const [16]u8,
    trigger_mac1: *const [16]u8,
) Error!void {
    @memset(out[0..4], 0);
    out[0] = message_type_cookie_reply;
    std.mem.writeInt(u32, out[4..8], receiver_index, .little);

    var nonce: [24]u8 = undefined;
    rand.bytes(&nonce) catch return error.EntropyUnavailable;
    @memcpy(out[8..32], &nonce);

    // enc_cookie = XAEAD(cookie_key, nonce, cookie, aad = trigger_mac1)
    XChaCha20Poly1305.encrypt(out[32..48], out[48..64], cookie, trigger_mac1, nonce, cookie_key.*);
}

/// Recover the cookie τ from a reply. `trigger_mac1` must be the mac1 of the
/// message the initiator originally sent.
pub fn openCookieReply(
    out_cookie: *[16]u8,
    msg: *const [cookie_reply_len]u8,
    cookie_key: *const [32]u8,
    trigger_mac1: *const [16]u8,
) Error!void {
    if (msg[0] != message_type_cookie_reply or msg[1] != 0 or msg[2] != 0 or msg[3] != 0) {
        return error.InvalidMessage;
    }
    var nonce: [24]u8 = undefined;
    @memcpy(&nonce, msg[8..32]);
    var tag: [16]u8 = undefined;
    @memcpy(&tag, msg[48..64]);
    XChaCha20Poly1305.decrypt(out_cookie, msg[32..48], tag, trigger_mac1, nonce, cookie_key.*) catch
        return error.DecryptFailed;
}

const testing = std.testing;

test "cookie reply roundtrip and mac2 agreement" {
    const responder_pub: [32]u8 = @splat(0xab);
    const endpoint = "203.0.113.7:51820";
    // mac1 of whatever message triggered the cookie.
    const trigger_mac1: [16]u8 = @splat(0x11);

    // Responder side: a private rotating secret mints the cookie; the
    // public-derived cookie key only encrypts the reply.
    var secret: [32]u8 = undefined;
    try rand.bytes(&secret);
    var key: [32]u8 = undefined;
    cookieKey(&key, &responder_pub);
    var tau: [16]u8 = undefined;
    computeCookie(&tau, &secret, endpoint);

    var reply: [cookie_reply_len]u8 = undefined;
    try buildCookieReply(&reply, 0xDEADBEEF, &key, &tau, &trigger_mac1);
    try testing.expectEqual(message_type_cookie_reply, reply[0]);
    try testing.expectEqual(@as(u32, 0xDEADBEEF), std.mem.readInt(u32, reply[4..8], .little));

    // Initiator side: same cookie_key (knows responder's static pub), opens it.
    var recovered: [16]u8 = undefined;
    try openCookieReply(&recovered, &reply, &key, &trigger_mac1);
    try testing.expectEqualSlices(u8, &tau, &recovered);

    // Initiator stamps mac2 on its next message; responder validates.
    const beta = "next handshake message bytes up to mac2";
    var mac2_initiator: [16]u8 = undefined;
    computeMac2(&mac2_initiator, &recovered, beta);
    try testing.expect(verifyMac2(&tau, beta, &mac2_initiator));
    // A stale or foreign cookie fails validation.
    const wrong_cookie: [16]u8 = @splat(0xee);
    try testing.expect(!verifyMac2(&wrong_cookie, beta, &mac2_initiator));
}

test "cookie reply with wrong trigger mac1 fails to open" {
    const responder_pub: [32]u8 = @splat(7);
    const secret: [32]u8 = @splat(0x42);
    var key: [32]u8 = undefined;
    cookieKey(&key, &responder_pub);
    var tau: [16]u8 = undefined;
    computeCookie(&tau, &secret, "endpoint");
    const good_mac1: [16]u8 = @splat(1);
    const bad_mac1: [16]u8 = @splat(2);

    var reply: [cookie_reply_len]u8 = undefined;
    try buildCookieReply(&reply, 1, &key, &tau, &good_mac1);

    var out: [16]u8 = undefined;
    try testing.expectError(error.DecryptFailed, openCookieReply(&out, &reply, &key, &bad_mac1));
}

test "cookie differs per endpoint and per secret rotation" {
    const secret_a: [32]u8 = @splat(9);
    const secret_b: [32]u8 = @splat(10);
    var a: [16]u8 = undefined;
    var b: [16]u8 = undefined;
    computeCookie(&a, &secret_a, "1.2.3.4:1");
    computeCookie(&b, &secret_a, "1.2.3.4:2");
    try testing.expect(!std.mem.eql(u8, &a, &b));
    // Rotating R_m invalidates previously minted cookies.
    computeCookie(&b, &secret_b, "1.2.3.4:1");
    try testing.expect(!std.mem.eql(u8, &a, &b));
}

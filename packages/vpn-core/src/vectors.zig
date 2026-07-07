//! Known-answer tests for the WireGuard v1 handshake.
//!
//! The vectors below are produced by an INDEPENDENT reference implementation
//! (`testvectors/wg_ref.py`) written in Python with hand-rolled X25519
//! and ChaCha20-Poly1305 that are themselves validated against the RFC 7748 /
//! RFC 8439 / RFC 7693 test vectors. Byte-for-byte agreement between that
//! reference and this Zig core is strong evidence of wire-correctness — the
//! same guarantee the official WireGuard test vectors provide.
//!
//! Regenerate with:  python3 testvectors/wg_ref.py
const std = @import("std");
const kdf = @import("kdf.zig");
const keys = @import("keys.zig");
const noise = @import("noise.zig");
const transport = @import("transport.zig");

const testing = std.testing;

// Canonical WireGuard constants — identical across every conforming impl.
const INITIAL_CHAIN_KEY = "60e26daef327efc02ec335e2a025d2d016eb4206f87277f52d38d1988b78cd36";
const INITIAL_HASH = "2211b361081ac566691243db458ad5322d9c6c662293e8b70ee19c65ba079ef3";

// Fixed handshake inputs.
const S_PRIV_I = "1111111111111111111111111111111111111111111111111111111111111111";
const S_PUB_I = "7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13";
const S_PRIV_R = "2222222222222222222222222222222222222222222222222222222222222222";
const E_PRIV_I = "3333333333333333333333333333333333333333333333333333333333333333";
const E_PRIV_R = "4444444444444444444444444444444444444444444444444444444444444444";
const PSK = "5555555555555555555555555555555555555555555555555555555555555555";
const SENDER_I: u32 = 16909060;
const SENDER_R: u32 = 168496141;
const UNIX_SEC: u64 = 1700000000;
const NANO: u32 = 42;

// Expected outputs.
const INITIATION = "01000000040302017b0d47d93427f8311160781c7c733fd89f88970aef490d8aa0ee19a4cb8a1b1481e498317da959fba46669572516a5e6c021bfa620bb6c56ca0082e1feae14988c2c64d024c617734a263f76a008df04d0f94bad8ee75ec8e1c2697fa182811f564c843ddb4513a21d8d5af4b07fa685e5343b0427212030e0de1e6100000000000000000000000000000000";
const RESPONSE = "020000000d0c0b0a04030201ff2ee45601ec1b67310c7790404585ae697331eee1c1f8cf2419731c1fff3e6bcb8edaa29bd1262cc9d09bbd6f6473b05258104e4c52f2783addcc73afd9df5b00000000000000000000000000000000";
const INITIATOR_SEND_KEY = "a007faf842d83f5bd3be20a14e0ffcec34c84867b78b051980602713205922de";
const INITIATOR_RECV_KEY = "d982d5cd10d34a7802b6c19fa441cd9164d70e4f4d62007ab416879ee8bd1b99";
// First data packet initiator → responder (counter 0, "ping-from-initiator!")
// and a responder → initiator keepalive, over the transport keys above.
const TRANSPORT_FIRST_PACKET = "040000000d0c0b0a00000000000000007c3924f9324b9da2d0706f221e65422c6b218482c97a8d49d501917cb576355356a7e2473ca4dd2ea312f843419f5597";
const TRANSPORT_KEEPALIVE = "040000000403020100000000000000004546b4bebf67c6c95055c71188ff8c4e";

fn unhex(comptime hexstr: []const u8) [hexstr.len / 2]u8 {
    var out: [hexstr.len / 2]u8 = undefined;
    _ = std.fmt.hexToBytes(&out, hexstr) catch unreachable;
    return out;
}

test "initial chain key and hash match the canonical WireGuard values" {
    var c: [32]u8 = undefined;
    kdf.hash(&c, &.{noise.construction});
    try testing.expectEqualSlices(u8, &unhex(INITIAL_CHAIN_KEY), &c);

    var h: [32]u8 = undefined;
    kdf.hash(&h, &.{ &c, noise.identifier });
    try testing.expectEqualSlices(u8, &unhex(INITIAL_HASH), &h);
}

test "derived static public keys match the reference" {
    var pub_i: [32]u8 = undefined;
    try keys.publicFromPrivate(&unhex(S_PRIV_I), &pub_i);
    try testing.expectEqualSlices(u8, &unhex(S_PUB_I), &pub_i);
}

test "handshake produces byte-identical messages and transport keys" {
    const s_priv_i = unhex(S_PRIV_I);
    const s_priv_r = unhex(S_PRIV_R);
    const s_pub_r = unhex("0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20");
    const e_priv_i = unhex(E_PRIV_I);
    const e_priv_r = unhex(E_PRIV_R);
    const psk = unhex(PSK);

    var ini = try noise.HandshakeState.init(.initiator, &s_priv_i, &s_pub_r, &psk);
    var res = try noise.HandshakeState.init(.responder, &s_priv_r, null, &psk);
    defer ini.deinit();
    defer res.deinit();

    // Initiation must match the reference byte-for-byte.
    var m1: [noise.initiation_len]u8 = undefined;
    try ini.createInitiationWithEphemeral(SENDER_I, &e_priv_i, UNIX_SEC, NANO, &m1);
    try testing.expectEqualSlices(u8, &unhex(INITIATION), &m1);

    // Responder consumes it and its response must match too.
    try res.consumeInitiation(&m1);
    try testing.expectEqualSlices(u8, &unhex(S_PUB_I), &res.peer_static_pub);

    var m2: [noise.response_len]u8 = undefined;
    try res.createResponseWithEphemeral(SENDER_R, &e_priv_r, &m2);
    try testing.expectEqualSlices(u8, &unhex(RESPONSE), &m2);

    // Initiator completes and both derive the exact reference transport keys.
    try ini.consumeResponse(&m2);
    var i_send: [32]u8 = undefined;
    var i_recv: [32]u8 = undefined;
    try ini.deriveTransportKeys(&i_send, &i_recv);
    try testing.expectEqualSlices(u8, &unhex(INITIATOR_SEND_KEY), &i_send);
    try testing.expectEqualSlices(u8, &unhex(INITIATOR_RECV_KEY), &i_recv);

    var r_send: [32]u8 = undefined;
    var r_recv: [32]u8 = undefined;
    try res.deriveTransportKeys(&r_send, &r_recv);
    try testing.expectEqualSlices(u8, &i_send, &r_recv);
    try testing.expectEqualSlices(u8, &i_recv, &r_send);
}

test "transport data messages match the reference byte-for-byte" {
    const send_key = unhex(INITIATOR_SEND_KEY);
    const recv_key = unhex(INITIATOR_RECV_KEY);
    var ini = transport.Session.init(&send_key, &recv_key, SENDER_I, SENDER_R);
    var res = transport.Session.init(&recv_key, &send_key, SENDER_R, SENDER_I);

    // First initiator → responder packet (counter 0) is byte-exact.
    const payload = "ping-from-initiator!";
    var wire: [transport.encryptedLen(payload.len)]u8 = undefined;
    const n = try ini.encrypt(payload, &wire);
    try testing.expectEqualSlices(u8, &unhex(TRANSPORT_FIRST_PACKET), wire[0..n]);
    var plain: [64]u8 = undefined;
    const pn = try res.decrypt(wire[0..n], &plain);
    try testing.expect(pn >= payload.len);
    try testing.expectEqualSlices(u8, payload, plain[0..payload.len]);

    // Responder → initiator keepalive (counter 0) is byte-exact too.
    var ka: [transport.encryptedLen(0)]u8 = undefined;
    const kn = try res.encrypt(&.{}, &ka);
    try testing.expectEqualSlices(u8, &unhex(TRANSPORT_KEEPALIVE), ka[0..kn]);
    try testing.expectEqual(@as(usize, 0), try ini.decrypt(ka[0..kn], &plain));
}

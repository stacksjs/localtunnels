//! WireGuard v1 Noise IKpsk2 handshake (whitepaper §5.4).
//!
//! Message layouts (all integers little-endian):
//!   initiation (148 B): type(1)+res(3) | sender(4) | ephemeral(32) |
//!                       enc_static(32+16) | enc_timestamp(12+16) | mac1(16) | mac2(16)
//!   response   (92 B):  type(2)+res(3) | sender(4) | receiver(4) | ephemeral(32) |
//!                       enc_empty(0+16) | mac1(16) | mac2(16)
const std = @import("std");
const kdf = @import("kdf.zig");
const keys = @import("keys.zig");
const tai64n = @import("tai64n.zig");

const ChaCha20Poly1305 = std.crypto.aead.chacha_poly.ChaCha20Poly1305;

pub const construction = "Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s";
pub const identifier = "WireGuard v1 zx2c4 Jason@zx2c4.com";
pub const label_mac1 = "mac1----";
pub const label_cookie = "cookie--";

pub const message_type_initiation: u8 = 1;
pub const message_type_response: u8 = 2;
pub const message_type_cookie_reply: u8 = 3;
pub const message_type_data: u8 = 4;

pub const initiation_len = 148;
pub const response_len = 92;

pub const Error = error{
    WrongState,
    InvalidMessage,
    InvalidMac,
    DecryptFailed,
    WeakKey,
    EntropyUnavailable,
};

pub const Role = enum { initiator, responder };

const State = enum {
    fresh,
    created_initiation,
    consumed_initiation,
    created_response,
    consumed_response,
};

fn aeadSeal(out: []u8, key: *const [32]u8, counter: u64, plaintext: []const u8, ad: []const u8) void {
    std.debug.assert(out.len == plaintext.len + 16);
    var nonce: [12]u8 = @splat(0);
    std.mem.writeInt(u64, nonce[4..12], counter, .little);
    ChaCha20Poly1305.encrypt(out[0..plaintext.len], out[plaintext.len..][0..16], plaintext, ad, nonce, key.*);
}

fn aeadOpen(out: []u8, key: *const [32]u8, counter: u64, ciphertext: []const u8, ad: []const u8) Error!void {
    std.debug.assert(ciphertext.len == out.len + 16);
    var nonce: [12]u8 = @splat(0);
    std.mem.writeInt(u64, nonce[4..12], counter, .little);
    var tag: [16]u8 = undefined;
    @memcpy(&tag, ciphertext[out.len..][0..16]);
    ChaCha20Poly1305.decrypt(out, ciphertext[0..out.len], tag, ad, nonce, key.*) catch return error.DecryptFailed;
}

fn mac1Key(out: *[32]u8, static_pub: *const [32]u8) void {
    kdf.hash(out, &.{ label_mac1, static_pub });
}

pub const HandshakeState = struct {
    role: Role,
    state: State = .fresh,

    static_priv: [32]u8,
    static_pub: [32]u8,
    /// Responder learns this from the initiation message.
    peer_static_pub: [32]u8 = @splat(0),
    psk: [32]u8,

    eph_priv: [32]u8 = undefined,
    eph_pub: [32]u8 = undefined,
    peer_eph_pub: [32]u8 = undefined,

    /// Chaining key (C) and hash transcript (H).
    c: [32]u8 = undefined,
    h: [32]u8 = undefined,

    local_index: u32 = 0,
    peer_index: u32 = 0,

    /// Decrypted TAI64N from a consumed initiation (responder side); the
    /// session manager must enforce per-peer monotonicity.
    peer_timestamp: [12]u8 = @splat(0),

    pub fn init(role: Role, static_priv: *const [32]u8, peer_static_pub: ?*const [32]u8, psk: ?*const [32]u8) Error!HandshakeState {
        var hs = HandshakeState{
            .role = role,
            .static_priv = static_priv.*,
            .static_pub = undefined,
            .psk = if (psk) |p| p.* else @as([32]u8, @splat(0)),
        };
        keys.publicFromPrivate(&hs.static_priv, &hs.static_pub) catch return error.WeakKey;
        if (peer_static_pub) |p| hs.peer_static_pub = p.*;

        // C = HASH(construction); H = HASH(C || identifier || Spub_responder)
        const responder_pub = switch (role) {
            .initiator => &hs.peer_static_pub,
            .responder => &hs.static_pub,
        };
        if (role == .initiator and peer_static_pub == null) return error.InvalidMessage;
        kdf.hash(&hs.c, &.{construction});
        var tmp: [32]u8 = undefined;
        kdf.hash(&tmp, &.{ &hs.c, identifier });
        kdf.hash(&hs.h, &.{ &tmp, responder_pub });
        return hs;
    }

    /// Wipe secret material.
    pub fn deinit(self: *HandshakeState) void {
        std.crypto.secureZero(u8, &self.static_priv);
        std.crypto.secureZero(u8, &self.eph_priv);
        std.crypto.secureZero(u8, &self.psk);
        std.crypto.secureZero(u8, &self.c);
    }

    fn mixHash(self: *HandshakeState, data: []const u8) void {
        kdf.hash(&self.h, &.{ &self.h, data });
    }

    /// Initiator → responder, first message (type 1).
    pub fn createInitiation(self: *HandshakeState, sender_index: u32, unix_sec: u64, nano: u32, out: *[initiation_len]u8) Error!void {
        if (self.role != .initiator or self.state != .fresh) return error.WrongState;
        self.local_index = sender_index;

        var eph_pub: [32]u8 = undefined;
        try keys.generate(&self.eph_priv, &eph_pub);
        self.eph_pub = eph_pub;

        @memset(out[0..4], 0);
        out[0] = message_type_initiation;
        std.mem.writeInt(u32, out[4..8], sender_index, .little);

        // Ephemeral
        kdf.kdf1(&self.c, &self.c, &self.eph_pub);
        @memcpy(out[8..40], &self.eph_pub);
        self.mixHash(out[8..40]);

        // Encrypted static
        var k: [32]u8 = undefined;
        var dh1 = keys.dh(&self.eph_priv, &self.peer_static_pub) catch return error.WeakKey;
        kdf.kdf2(&self.c, &k, &self.c, &dh1);
        std.crypto.secureZero(u8, &dh1);
        aeadSeal(out[40..88], &k, 0, &self.static_pub, &self.h);
        self.mixHash(out[40..88]);

        // Encrypted timestamp
        var dh2 = keys.dh(&self.static_priv, &self.peer_static_pub) catch return error.WeakKey;
        kdf.kdf2(&self.c, &k, &self.c, &dh2);
        std.crypto.secureZero(u8, &dh2);
        var ts: [12]u8 = undefined;
        tai64n.encode(&ts, unix_sec, nano);
        aeadSeal(out[88..116], &k, 0, &ts, &self.h);
        self.mixHash(out[88..116]);
        std.crypto.secureZero(u8, &k);

        // mac1 (keyed by receiver's static public key), mac2 = 0 (no cookie)
        var m1key: [32]u8 = undefined;
        mac1Key(&m1key, &self.peer_static_pub);
        kdf.mac(out[116..132], &m1key, out[0..116]);
        @memset(out[132..148], 0);

        self.state = .created_initiation;
    }

    /// Responder consumes the initiation, learning the initiator's static key
    /// (exposed as `peer_static_pub` — the caller MUST verify it is an
    /// authorized peer) and timestamp (`peer_timestamp`).
    pub fn consumeInitiation(self: *HandshakeState, msg: *const [initiation_len]u8) Error!void {
        if (self.role != .responder or self.state != .fresh) return error.WrongState;
        if (msg[0] != message_type_initiation or msg[1] != 0 or msg[2] != 0 or msg[3] != 0) {
            return error.InvalidMessage;
        }

        // Verify mac1 before any expensive DH work.
        var m1key: [32]u8 = undefined;
        mac1Key(&m1key, &self.static_pub);
        var expected_mac1: [16]u8 = undefined;
        kdf.mac(&expected_mac1, &m1key, msg[0..116]);
        if (!std.crypto.timing_safe.eql([16]u8, expected_mac1, msg[116..132].*)) {
            return error.InvalidMac;
        }

        self.peer_index = std.mem.readInt(u32, msg[4..8], .little);

        // Ephemeral
        @memcpy(&self.peer_eph_pub, msg[8..40]);
        kdf.kdf1(&self.c, &self.c, &self.peer_eph_pub);
        self.mixHash(msg[8..40]);

        // Decrypt static
        var k: [32]u8 = undefined;
        var dh1 = keys.dh(&self.static_priv, &self.peer_eph_pub) catch return error.WeakKey;
        kdf.kdf2(&self.c, &k, &self.c, &dh1);
        std.crypto.secureZero(u8, &dh1);
        var peer_static: [32]u8 = undefined;
        try aeadOpen(&peer_static, &k, 0, msg[40..88], &self.h);
        self.peer_static_pub = peer_static;
        self.mixHash(msg[40..88]);

        // Decrypt timestamp
        var dh2 = keys.dh(&self.static_priv, &self.peer_static_pub) catch return error.WeakKey;
        kdf.kdf2(&self.c, &k, &self.c, &dh2);
        std.crypto.secureZero(u8, &dh2);
        try aeadOpen(&self.peer_timestamp, &k, 0, msg[88..116], &self.h);
        self.mixHash(msg[88..116]);
        std.crypto.secureZero(u8, &k);

        self.state = .consumed_initiation;
    }

    /// Responder → initiator, second message (type 2).
    pub fn createResponse(self: *HandshakeState, sender_index: u32, out: *[response_len]u8) Error!void {
        if (self.role != .responder or self.state != .consumed_initiation) return error.WrongState;
        self.local_index = sender_index;

        var eph_pub: [32]u8 = undefined;
        try keys.generate(&self.eph_priv, &eph_pub);
        self.eph_pub = eph_pub;

        @memset(out[0..4], 0);
        out[0] = message_type_response;
        std.mem.writeInt(u32, out[4..8], sender_index, .little);
        std.mem.writeInt(u32, out[8..12], self.peer_index, .little);

        // Ephemeral
        kdf.kdf1(&self.c, &self.c, &self.eph_pub);
        @memcpy(out[12..44], &self.eph_pub);
        self.mixHash(out[12..44]);

        // ee and se
        var dh1 = keys.dh(&self.eph_priv, &self.peer_eph_pub) catch return error.WeakKey;
        kdf.kdf1(&self.c, &self.c, &dh1);
        std.crypto.secureZero(u8, &dh1);
        var dh2 = keys.dh(&self.eph_priv, &self.peer_static_pub) catch return error.WeakKey;
        kdf.kdf1(&self.c, &self.c, &dh2);
        std.crypto.secureZero(u8, &dh2);

        // psk2
        var tau: [32]u8 = undefined;
        var k: [32]u8 = undefined;
        kdf.kdf3(&self.c, &tau, &k, &self.c, &self.psk);
        self.mixHash(&tau);
        std.crypto.secureZero(u8, &tau);

        // Encrypted empty payload
        aeadSeal(out[44..60], &k, 0, &.{}, &self.h);
        self.mixHash(out[44..60]);
        std.crypto.secureZero(u8, &k);

        // mac1 keyed by the initiator's static public key
        var m1key: [32]u8 = undefined;
        mac1Key(&m1key, &self.peer_static_pub);
        kdf.mac(out[60..76], &m1key, out[0..60]);
        @memset(out[76..92], 0);

        self.state = .created_response;
    }

    /// Initiator consumes the response (type 2).
    pub fn consumeResponse(self: *HandshakeState, msg: *const [response_len]u8) Error!void {
        if (self.role != .initiator or self.state != .created_initiation) return error.WrongState;
        if (msg[0] != message_type_response or msg[1] != 0 or msg[2] != 0 or msg[3] != 0) {
            return error.InvalidMessage;
        }
        if (std.mem.readInt(u32, msg[8..12], .little) != self.local_index) {
            return error.InvalidMessage;
        }

        var m1key: [32]u8 = undefined;
        mac1Key(&m1key, &self.static_pub);
        var expected_mac1: [16]u8 = undefined;
        kdf.mac(&expected_mac1, &m1key, msg[0..60]);
        if (!std.crypto.timing_safe.eql([16]u8, expected_mac1, msg[60..76].*)) {
            return error.InvalidMac;
        }

        self.peer_index = std.mem.readInt(u32, msg[4..8], .little);

        @memcpy(&self.peer_eph_pub, msg[12..44]);
        kdf.kdf1(&self.c, &self.c, &self.peer_eph_pub);
        self.mixHash(msg[12..44]);

        var dh1 = keys.dh(&self.eph_priv, &self.peer_eph_pub) catch return error.WeakKey;
        kdf.kdf1(&self.c, &self.c, &dh1);
        std.crypto.secureZero(u8, &dh1);
        var dh2 = keys.dh(&self.static_priv, &self.peer_eph_pub) catch return error.WeakKey;
        kdf.kdf1(&self.c, &self.c, &dh2);
        std.crypto.secureZero(u8, &dh2);

        var tau: [32]u8 = undefined;
        var k: [32]u8 = undefined;
        kdf.kdf3(&self.c, &tau, &k, &self.c, &self.psk);
        self.mixHash(&tau);
        std.crypto.secureZero(u8, &tau);

        var empty: [0]u8 = undefined;
        try aeadOpen(&empty, &k, 0, msg[44..60], &self.h);
        self.mixHash(msg[44..60]);
        std.crypto.secureZero(u8, &k);

        self.state = .consumed_response;
    }

    /// Derive transport keys after the handshake completes.
    /// (T_send, T_recv) = KDF2(C, ε), swapped for the responder.
    pub fn deriveTransportKeys(self: *HandshakeState, out_send: *[32]u8, out_recv: *[32]u8) Error!void {
        const done = (self.role == .initiator and self.state == .consumed_response) or
            (self.role == .responder and self.state == .created_response);
        if (!done) return error.WrongState;
        var t1: [32]u8 = undefined;
        var t2: [32]u8 = undefined;
        kdf.kdf2(&t1, &t2, &self.c, &.{});
        switch (self.role) {
            .initiator => {
                out_send.* = t1;
                out_recv.* = t2;
            },
            .responder => {
                out_send.* = t2;
                out_recv.* = t1;
            },
        }
        std.crypto.secureZero(u8, &t1);
        std.crypto.secureZero(u8, &t2);
    }
};

const testing = std.testing;

fn testKeypair(seed_byte: u8) !struct { priv: [32]u8, pub_key: [32]u8 } {
    const seed: [32]u8 = @splat(seed_byte);
    const kp = try keys.X25519.KeyPair.generateDeterministic(seed);
    return .{ .priv = kp.secret_key, .pub_key = kp.public_key };
}

test "full IKpsk2 handshake: key agreement both directions" {
    const ikp = try testKeypair(1);
    const rkp = try testKeypair(2);
    const psk: [32]u8 = @splat(9);

    var ini = try HandshakeState.init(.initiator, &ikp.priv, &rkp.pub_key, &psk);
    var res = try HandshakeState.init(.responder, &rkp.priv, null, &psk);
    defer ini.deinit();
    defer res.deinit();

    var m1: [initiation_len]u8 = undefined;
    try ini.createInitiation(0x11111111, 1_700_000_000, 42, &m1);
    try res.consumeInitiation(&m1);

    // Responder learned the initiator's identity and timestamp.
    try testing.expectEqualSlices(u8, &ikp.pub_key, &res.peer_static_pub);
    var expected_ts: [12]u8 = undefined;
    tai64n.encode(&expected_ts, 1_700_000_000, 42);
    try testing.expectEqualSlices(u8, &expected_ts, &res.peer_timestamp);
    try testing.expectEqual(@as(u32, 0x11111111), res.peer_index);

    var m2: [response_len]u8 = undefined;
    try res.createResponse(0x22222222, &m2);
    try ini.consumeResponse(&m2);
    try testing.expectEqual(@as(u32, 0x22222222), ini.peer_index);

    var i_send: [32]u8 = undefined;
    var i_recv: [32]u8 = undefined;
    var r_send: [32]u8 = undefined;
    var r_recv: [32]u8 = undefined;
    try ini.deriveTransportKeys(&i_send, &i_recv);
    try res.deriveTransportKeys(&r_send, &r_recv);

    try testing.expectEqualSlices(u8, &i_send, &r_recv);
    try testing.expectEqualSlices(u8, &i_recv, &r_send);
    try testing.expect(!std.mem.eql(u8, &i_send, &i_recv));
}

test "handshake without psk also agrees" {
    const ikp = try testKeypair(3);
    const rkp = try testKeypair(4);

    var ini = try HandshakeState.init(.initiator, &ikp.priv, &rkp.pub_key, null);
    var res = try HandshakeState.init(.responder, &rkp.priv, null, null);
    defer ini.deinit();
    defer res.deinit();

    var m1: [initiation_len]u8 = undefined;
    try ini.createInitiation(1, 1_700_000_000, 0, &m1);
    try res.consumeInitiation(&m1);
    var m2: [response_len]u8 = undefined;
    try res.createResponse(2, &m2);
    try ini.consumeResponse(&m2);

    var i_send: [32]u8 = undefined;
    var i_recv: [32]u8 = undefined;
    var r_send: [32]u8 = undefined;
    var r_recv: [32]u8 = undefined;
    try ini.deriveTransportKeys(&i_send, &i_recv);
    try res.deriveTransportKeys(&r_send, &r_recv);
    try testing.expectEqualSlices(u8, &i_send, &r_recv);
    try testing.expectEqualSlices(u8, &i_recv, &r_send);
}

test "psk mismatch fails response decryption" {
    const ikp = try testKeypair(5);
    const rkp = try testKeypair(6);
    const psk_a: [32]u8 = @splat(1);
    const psk_b: [32]u8 = @splat(2);

    var ini = try HandshakeState.init(.initiator, &ikp.priv, &rkp.pub_key, &psk_a);
    var res = try HandshakeState.init(.responder, &rkp.priv, null, &psk_b);
    defer ini.deinit();
    defer res.deinit();

    var m1: [initiation_len]u8 = undefined;
    try ini.createInitiation(1, 1_700_000_000, 0, &m1);
    // psk2 does not affect the initiation, only the response.
    try res.consumeInitiation(&m1);
    var m2: [response_len]u8 = undefined;
    try res.createResponse(2, &m2);
    try testing.expectError(error.DecryptFailed, ini.consumeResponse(&m2));
}

test "tampered initiation is rejected by mac1 before decryption" {
    const ikp = try testKeypair(7);
    const rkp = try testKeypair(8);

    var ini = try HandshakeState.init(.initiator, &ikp.priv, &rkp.pub_key, null);
    var res = try HandshakeState.init(.responder, &rkp.priv, null, null);
    defer ini.deinit();
    defer res.deinit();

    var m1: [initiation_len]u8 = undefined;
    try ini.createInitiation(1, 1_700_000_000, 0, &m1);
    m1[50] ^= 0xff;
    try testing.expectError(error.InvalidMac, res.consumeInitiation(&m1));
}

test "initiation for a different responder key is rejected" {
    const ikp = try testKeypair(9);
    const rkp = try testKeypair(10);
    const other = try testKeypair(11);

    var ini = try HandshakeState.init(.initiator, &ikp.priv, &rkp.pub_key, null);
    var wrong = try HandshakeState.init(.responder, &other.priv, null, null);
    defer ini.deinit();
    defer wrong.deinit();

    var m1: [initiation_len]u8 = undefined;
    try ini.createInitiation(1, 1_700_000_000, 0, &m1);
    try testing.expectError(error.InvalidMac, wrong.consumeInitiation(&m1));
}

//! Curve25519 static/ephemeral key handling.
const std = @import("std");
const rand = @import("rand.zig");

pub const X25519 = std.crypto.dh.X25519;

pub const KeyError = error{ WeakKey, EntropyUnavailable };

pub fn generate(out_priv: *[32]u8, out_pub: *[32]u8) KeyError!void {
    var seed: [32]u8 = undefined;
    rand.bytes(&seed) catch return error.EntropyUnavailable;
    const kp = X25519.KeyPair.generateDeterministic(seed) catch return error.WeakKey;
    std.crypto.secureZero(u8, &seed);
    out_priv.* = kp.secret_key;
    out_pub.* = kp.public_key;
}

pub fn publicFromPrivate(priv: *const [32]u8, out_pub: *[32]u8) KeyError!void {
    out_pub.* = X25519.recoverPublicKey(priv.*) catch return error.WeakKey;
}

/// DH(priv, pub) — X25519 scalar multiplication (clamped internally).
pub fn dh(priv: *const [32]u8, pub_key: *const [32]u8) KeyError![32]u8 {
    return X25519.scalarmult(priv.*, pub_key.*) catch error.WeakKey;
}

test "keypair generation and DH agreement" {
    var a_priv: [32]u8 = undefined;
    var a_pub: [32]u8 = undefined;
    var b_priv: [32]u8 = undefined;
    var b_pub: [32]u8 = undefined;
    try generate(&a_priv, &a_pub);
    try generate(&b_priv, &b_pub);

    var derived: [32]u8 = undefined;
    try publicFromPrivate(&a_priv, &derived);
    try std.testing.expectEqualSlices(u8, &a_pub, &derived);

    const s1 = try dh(&a_priv, &b_pub);
    const s2 = try dh(&b_priv, &a_pub);
    try std.testing.expectEqualSlices(u8, &s1, &s2);
}

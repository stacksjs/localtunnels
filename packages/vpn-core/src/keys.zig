//! Curve25519 static/ephemeral key handling.
const std = @import("std");
const rand = @import("rand.zig");

pub const X25519 = std.crypto.dh.X25519;

pub const KeyError = error{ WeakKey, EntropyUnavailable };

pub fn generate(out_priv: *[32]u8, out_pub: *[32]u8) KeyError!void {
    // This used to retry. `generateDeterministic` returned
    // `IdentityElementError!KeyPair`, so a weak seed — public key derivation
    // landing on the identity element, a ~2^-250 accident of the draw — was
    // redrawn rather than failed, with a bound so a broken RNG could not loop
    // forever.
    //
    // Zig made it infallible (0.18.0-dev): clamping guarantees a usable
    // scalar, so the condition the loop existed for cannot arise and a retry
    // would only ever repeat identical work. Entropy is still fallible, which
    // is the one way this can fail now.
    var seed: [32]u8 = undefined;
    defer std.crypto.secureZero(u8, &seed);
    rand.bytes(&seed) catch return error.EntropyUnavailable;

    var kp = X25519.KeyPair.generateDeterministic(seed);
    defer std.crypto.secureZero(u8, &kp.secret_key);
    out_priv.* = kp.secret_key;
    out_pub.* = kp.public_key;
}

pub fn publicFromPrivate(priv: *const [32]u8, out_pub: *[32]u8) KeyError!void {
    // Also infallible since 0.18.0-dev, for the same reason: a clamped scalar
    // cannot derive the identity element.
    //
    // The error union stays. Eight call sites and the FFI boundary in
    // `lib.zig` are written against it, and `KeyError` has to keep `WeakKey`
    // regardless — `dh` below is still fallible, because there the public key
    // comes from the peer and an attacker may choose one that does land on
    // the identity element. That is the case the error exists for.
    out_pub.* = X25519.recoverPublicKey(priv.*);
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

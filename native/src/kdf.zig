//! WireGuard KDF primitives: BLAKE2s-256 HASH, keyed BLAKE2s-128 MAC, and the
//! HMAC(BLAKE2s)-based HKDF chain (KDF1/KDF2/KDF3) from the whitepaper §5.4.
const std = @import("std");

pub const Blake2s256 = std.crypto.hash.blake2.Blake2s256;
pub const Blake2s128 = std.crypto.hash.blake2.Blake2s128;
pub const HmacBlake2s = std.crypto.auth.hmac.Hmac(Blake2s256);

/// HASH(a || b || ...) — BLAKE2s-256 over the concatenation of `parts`.
pub fn hash(out: *[32]u8, parts: []const []const u8) void {
    var h = Blake2s256.init(.{});
    for (parts) |p| h.update(p);
    h.final(out);
}

/// MAC(key, data) — keyed BLAKE2s with 16-byte output (used for mac1/mac2).
pub fn mac(out: *[16]u8, key: *const [32]u8, data: []const u8) void {
    Blake2s128.hash(data, out, .{ .key = key });
}

fn hmac(out: *[32]u8, key: []const u8, data: []const u8) void {
    HmacBlake2s.create(out, data, key);
}

/// KDF1: (t1) = HKDF(key, input)
pub fn kdf1(t1: *[32]u8, key: *const [32]u8, input: []const u8) void {
    var t0: [32]u8 = undefined;
    hmac(&t0, key, input);
    hmac(t1, &t0, &[_]u8{0x01});
    std.crypto.secureZero(u8, &t0);
}

/// KDF2: (t1, t2) = HKDF(key, input)
pub fn kdf2(t1: *[32]u8, t2: *[32]u8, key: *const [32]u8, input: []const u8) void {
    var t0: [32]u8 = undefined;
    hmac(&t0, key, input);
    hmac(t1, &t0, &[_]u8{0x01});
    var buf: [33]u8 = undefined;
    @memcpy(buf[0..32], t1);
    buf[32] = 0x02;
    hmac(t2, &t0, &buf);
    std.crypto.secureZero(u8, &t0);
    std.crypto.secureZero(u8, &buf);
}

/// KDF3: (t1, t2, t3) = HKDF(key, input)
pub fn kdf3(t1: *[32]u8, t2: *[32]u8, t3: *[32]u8, key: *const [32]u8, input: []const u8) void {
    var t0: [32]u8 = undefined;
    hmac(&t0, key, input);
    hmac(t1, &t0, &[_]u8{0x01});
    var buf: [33]u8 = undefined;
    @memcpy(buf[0..32], t1);
    buf[32] = 0x02;
    hmac(t2, &t0, &buf);
    @memcpy(buf[0..32], t2);
    buf[32] = 0x03;
    hmac(t3, &t0, &buf);
    std.crypto.secureZero(u8, &t0);
    std.crypto.secureZero(u8, &buf);
}

test "kdf chain produces distinct deterministic outputs" {
    const key: [32]u8 = @splat(7);
    var a1: [32]u8 = undefined;
    var b1: [32]u8 = undefined;
    var b2: [32]u8 = undefined;
    var c1: [32]u8 = undefined;
    var c2: [32]u8 = undefined;
    var c3: [32]u8 = undefined;

    kdf1(&a1, &key, "input");
    kdf2(&b1, &b2, &key, "input");
    kdf3(&c1, &c2, &c3, &key, "input");

    // The first output of each KDF is identical by construction.
    try std.testing.expectEqualSlices(u8, &a1, &b1);
    try std.testing.expectEqualSlices(u8, &b1, &c1);
    try std.testing.expectEqualSlices(u8, &b2, &c2);
    // ... but each derived slot differs.
    try std.testing.expect(!std.mem.eql(u8, &c1, &c2));
    try std.testing.expect(!std.mem.eql(u8, &c2, &c3));
}

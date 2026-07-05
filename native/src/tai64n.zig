//! TAI64N timestamps (12 bytes, big-endian) used in handshake initiation
//! messages for replay protection (whitepaper §5.4.2).
const std = @import("std");

/// TAI64 label base: 2^62 + 10 (TAI was 10s ahead of UTC at the 1970 epoch;
/// later leap seconds are ignored — only monotonicity matters).
const base: u64 = 0x400000000000000a;

pub fn encode(out: *[12]u8, unix_sec: u64, nano: u32) void {
    std.mem.writeInt(u64, out[0..8], base + unix_sec, .big);
    std.mem.writeInt(u32, out[8..12], nano, .big);
}

/// Compare two TAI64N timestamps: returns true when `a` is strictly after `b`.
pub fn isAfter(a: *const [12]u8, b: *const [12]u8) bool {
    return std.mem.order(u8, a, b) == .gt;
}

test "tai64n encoding is monotonic and big-endian" {
    var t1: [12]u8 = undefined;
    var t2: [12]u8 = undefined;
    encode(&t1, 1_700_000_000, 5);
    encode(&t2, 1_700_000_000, 6);
    try std.testing.expect(isAfter(&t2, &t1));
    try std.testing.expect(!isAfter(&t1, &t2));
    try std.testing.expect(!isAfter(&t1, &t1));

    encode(&t2, 1_700_000_001, 0);
    try std.testing.expect(isAfter(&t2, &t1));

    // Label base per spec: 0x4000000000000000 + unix + 10.
    const secs = std.mem.readInt(u64, t1[0..8], .big);
    try std.testing.expectEqual(@as(u64, 0x4000000000000000) + 1_700_000_000 + 10, secs);
}

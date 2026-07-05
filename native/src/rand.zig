//! OS cryptographically-secure randomness.
//!
//! This build of Zig routes randomness through `std.Io`, which an FFI library
//! has no handle to, so we call libc `getentropy(2)` directly (available on
//! macOS and Linux/glibc ≥ 2.25). Windows will use BCryptGenRandom later.
const std = @import("std");
const builtin = @import("builtin");

extern "c" fn getentropy(buf: [*]u8, len: usize) c_int;

pub const Error = error{EntropyUnavailable};

/// Fill `buf` with secure random bytes. `getentropy` caps a single call at
/// 256 bytes, so larger buffers are filled in chunks.
pub fn bytes(buf: []u8) Error!void {
    var off: usize = 0;
    while (off < buf.len) {
        const chunk = @min(buf.len - off, 256);
        if (getentropy(buf.ptr + off, chunk) != 0) return error.EntropyUnavailable;
        off += chunk;
    }
}

test "getrandom fills the buffer and is not trivially constant" {
    var a: [64]u8 = @splat(0);
    var b: [64]u8 = @splat(0);
    try bytes(&a);
    try bytes(&b);
    // Two draws should differ (P(collision) ≈ 0).
    try std.testing.expect(!std.mem.eql(u8, &a, &b));
}

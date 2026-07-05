//! OS cryptographically-secure randomness.
//!
//! This build of Zig routes randomness through `std.Io`, which an FFI library
//! has no handle to, so we call the OS entropy source directly:
//!   - Linux:   the `getrandom(2)` syscall (no libc — keeps the .so portable)
//!   - macOS:   libc `getentropy(2)`
//!   - Windows: `BCryptGenRandom` with the system-preferred RNG
const std = @import("std");
const builtin = @import("builtin");

extern "c" fn getentropy(buf: [*]u8, len: usize) c_int;

// BCryptGenRandom(hAlgorithm, pbBuffer, cbBuffer, dwFlags) → NTSTATUS (0 = ok).
const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x00000002;
extern "bcrypt" fn BCryptGenRandom(hAlgorithm: ?*anyopaque, pbBuffer: [*]u8, cbBuffer: u32, dwFlags: u32) i32;

pub const Error = error{EntropyUnavailable};

/// Fill `buf` with secure random bytes.
pub fn bytes(buf: []u8) Error!void {
    switch (builtin.os.tag) {
        .linux => {
            var off: usize = 0;
            while (off < buf.len) {
                const rc = std.os.linux.getrandom(buf.ptr + off, buf.len - off, 0);
                const signed: isize = @bitCast(rc);
                if (signed < 0) return error.EntropyUnavailable;
                if (signed == 0) return error.EntropyUnavailable;
                off += @intCast(signed);
            }
        },
        .windows => {
            if (BCryptGenRandom(null, buf.ptr, @intCast(buf.len), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
                return error.EntropyUnavailable;
        },
        else => {
            // macOS: getentropy caps a single call at 256 bytes; fill in chunks.
            var off: usize = 0;
            while (off < buf.len) {
                const chunk = @min(buf.len - off, 256);
                if (getentropy(buf.ptr + off, chunk) != 0) return error.EntropyUnavailable;
                off += chunk;
            }
        },
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

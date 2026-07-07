//! Minimal blocking mutex for the FFI core.
//!
//! This build of Zig routes its blocking sync primitives through `std.Io`,
//! which an FFI library has no handle to — the same reason rand.zig calls
//! the OS entropy source directly. So we build on the lock-free primitive
//! std still ships (`std.atomic.Mutex`) and add a spin-then-yield wait
//! loop. Critical sections in this library are microseconds long and
//! contention is rare (one session per tunnel), so this behaves like a
//! futex lock in practice while staying libc-free on Linux.
const std = @import("std");
const builtin = @import("builtin");

// libc — referenced only on non-Linux targets.
extern "c" fn sched_yield() c_int;

fn osYield() void {
    switch (builtin.os.tag) {
        .linux => _ = std.os.linux.sched_yield(),
        // Windows: no cheap yield without pulling in kernel32; the spin
        // hint below is sufficient for this library's tiny hold times.
        .windows => std.atomic.spinLoopHint(),
        else => _ = sched_yield(),
    }
}

pub const Mutex = struct {
    inner: std.atomic.Mutex = .unlocked,

    pub fn lock(self: *Mutex) void {
        var spins: u32 = 0;
        while (!self.inner.tryLock()) {
            if (spins < 64) {
                spins += 1;
                std.atomic.spinLoopHint();
            } else {
                osYield();
            }
        }
    }

    pub fn unlock(self: *Mutex) void {
        self.inner.unlock();
    }
};

const testing = std.testing;

test "mutex serializes a non-atomic counter across threads" {
    var m = Mutex{};
    var counter: u64 = 0;

    const worker = struct {
        fn run(mu: *Mutex, c: *u64) void {
            var i: usize = 0;
            while (i < 10_000) : (i += 1) {
                mu.lock();
                defer mu.unlock();
                c.* += 1;
            }
        }
    };

    var handles: [4]std.Thread = undefined;
    for (&handles) |*h| {
        h.* = try std.Thread.spawn(.{}, worker.run, .{ &m, &counter });
    }
    for (&handles) |*h| h.join();

    try testing.expectEqual(@as(u64, 40_000), counter);
}

//! Native batch packet pump — the hot path from milestone M5. Instead of one
//! FFI crossing per packet (TS reads a packet, calls encrypt, sends it), a
//! single call drains many packets from an input fd, encrypts/decrypts them,
//! and writes them straight to an output fd, entirely in native code.
//!
//! `in_fd`/`out_fd` are raw file descriptors — a TUN device and a connected
//! UDP socket in production, or pipes in tests. Reads are expected to be
//! message-oriented (one packet per read), as with TUN and datagram sockets.
const std = @import("std");
const builtin = @import("builtin");
const transport = @import("transport.zig");
const linux_os = std.os.linux;

extern "c" fn read(fd: c_int, buf: [*]u8, n: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, n: usize) isize;

// fd I/O — raw syscalls on Linux (no libc), libc elsewhere.
fn sysRead(fd: c_int, buf: [*]u8, n: usize) isize {
    return switch (builtin.os.tag) {
        .linux => @bitCast(linux_os.read(fd, buf, n)),
        else => read(fd, buf, n),
    };
}
fn sysWrite(fd: c_int, buf: [*]const u8, n: usize) isize {
    return switch (builtin.os.tag) {
        .linux => @bitCast(linux_os.write(fd, buf, n)),
        else => write(fd, buf, n),
    };
}

const max_wire = transport.header_len + transport.max_plaintext_len + transport.tag_len;

/// Read up to `max_packets` plaintext packets from `in_fd`, encrypt each, and
/// write the wire messages to `out_fd`. Returns the number of packets
/// forwarded (stops early when a read yields no data or a write fails).
pub fn forwardEncrypt(session: *transport.Session, in_fd: c_int, out_fd: c_int, max_packets: usize) usize {
    var plain: [transport.max_plaintext_len]u8 = undefined;
    var wire: [max_wire]u8 = undefined;
    var count: usize = 0;
    while (count < max_packets) {
        const n = sysRead(in_fd, &plain, plain.len);
        if (n <= 0) break;
        const wn = session.encrypt(plain[0..@intCast(n)], &wire) catch break;
        if (sysWrite(out_fd, &wire, wn) < 0) break;
        count += 1;
    }
    return count;
}

/// Read up to `max_packets` wire messages from `in_fd`, decrypt each, and write
/// the recovered plaintext to `out_fd`. Packets that fail to decrypt (replay,
/// tamper) are skipped without aborting the batch. Returns packets written.
pub fn forwardDecrypt(session: *transport.Session, in_fd: c_int, out_fd: c_int, max_packets: usize) usize {
    var wire: [max_wire]u8 = undefined;
    var plain: [transport.max_plaintext_len]u8 = undefined;
    var count: usize = 0;
    var attempts: usize = 0;
    while (attempts < max_packets) {
        const n = sysRead(in_fd, &wire, wire.len);
        if (n <= 0) break;
        attempts += 1;
        const pn = session.decrypt(wire[0..@intCast(n)], &plain) catch continue;
        if (pn == 0) continue; // keepalive
        if (sysWrite(out_fd, &plain, pn) < 0) break;
        count += 1;
    }
    return count;
}

const testing = std.testing;

extern "c" fn pipe(fds: [*]c_int) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn socketpair(domain: c_int, sock_type: c_int, protocol: c_int, sv: [*]c_int) c_int;
extern "c" fn fcntl(fd: c_int, cmd: c_int, ...) c_int;

/// Mark a descriptor non-blocking so a drained read returns EAGAIN (→ the pump
/// stops) instead of blocking — matching production TUN/UDP sockets.
fn setNonBlocking(fd: c_int) void {
    const F_SETFL: c_int = 4;
    const O_NONBLOCK: c_int = switch (builtin.os.tag) {
        .macos => 0x0004,
        else => 0o4000,
    };
    _ = fcntl(fd, F_SETFL, O_NONBLOCK);
}

fn testSessions() struct { a: transport.Session, b: transport.Session } {
    const k1: [32]u8 = @splat(0x33);
    const k2: [32]u8 = @splat(0x44);
    return .{
        .a = transport.Session.init(&k1, &k2, 1, 2),
        .b = transport.Session.init(&k2, &k1, 2, 1),
    };
}

test "forwardEncrypt moves a packet from one fd to another, encrypted" {
    var s = testSessions();

    var in_pipe: [2]c_int = undefined;
    var out_pipe: [2]c_int = undefined;
    try testing.expect(pipe(&in_pipe) == 0);
    try testing.expect(pipe(&out_pipe) == 0);
    defer for ([_]c_int{ in_pipe[0], in_pipe[1], out_pipe[0], out_pipe[1] }) |fd| {
        _ = close(fd);
    };

    const payload = "an IP packet would go here";
    try testing.expect(write(in_pipe[1], payload, payload.len) == payload.len);

    const moved = forwardEncrypt(&s.a, in_pipe[0], out_pipe[1], 1);
    try testing.expectEqual(@as(usize, 1), moved);

    // Read the wire message back out and decrypt it with the peer session.
    var wire: [256]u8 = undefined;
    const wn = read(out_pipe[0], &wire, wire.len);
    try testing.expect(wn > 0);
    var plain: [256]u8 = undefined;
    const pn = try s.b.decrypt(wire[0..@intCast(wn)], &plain);
    try testing.expect(pn >= payload.len);
    try testing.expectEqualSlices(u8, payload, plain[0..payload.len]);
}

test "pump works over real datagram sockets (production-like)" {
    var s = testSessions();

    // AF_UNIX SOCK_DGRAM socketpair — message boundaries like UDP, no root.
    const AF_UNIX: c_int = 1;
    const SOCK_DGRAM: c_int = 2;
    var raw: [2]c_int = undefined;
    var wire: [2]c_int = undefined;
    var out: [2]c_int = undefined;
    try testing.expect(socketpair(AF_UNIX, SOCK_DGRAM, 0, &raw) == 0);
    try testing.expect(socketpair(AF_UNIX, SOCK_DGRAM, 0, &wire) == 0);
    try testing.expect(socketpair(AF_UNIX, SOCK_DGRAM, 0, &out) == 0);
    defer for ([_]c_int{ raw[0], raw[1], wire[0], wire[1], out[0], out[1] }) |fd| {
        _ = close(fd);
    };
    // The pump reads until EAGAIN, so its input fds must be non-blocking.
    setNonBlocking(raw[0]);
    setNonBlocking(wire[0]);

    // Push three distinct packets through the encrypt pump, then the decrypt pump.
    const packets = [_][]const u8{ "packet-one", "second-packet-here", "3" };
    for (packets) |p| try testing.expect(write(raw[1], p.ptr, p.len) == @as(isize, @intCast(p.len)));

    // A generous max_packets (16) drains all 3 then stops cleanly on EAGAIN.
    try testing.expectEqual(@as(usize, 3), forwardEncrypt(&s.a, raw[0], wire[1], 16));
    try testing.expectEqual(@as(usize, 3), forwardDecrypt(&s.b, wire[0], out[1], 16));

    for (packets) |p| {
        var buf: [128]u8 = undefined;
        const n = read(out[0], &buf, buf.len);
        try testing.expect(n >= @as(isize, @intCast(p.len)));
        try testing.expectEqualSlices(u8, p, buf[0..p.len]);
    }
}

test "forwardDecrypt reverses forwardEncrypt end to end" {
    var s = testSessions();

    var raw_pipe: [2]c_int = undefined; // plaintext in
    var wire_pipe: [2]c_int = undefined; // encrypted middle
    var out_pipe: [2]c_int = undefined; // plaintext out
    try testing.expect(pipe(&raw_pipe) == 0);
    try testing.expect(pipe(&wire_pipe) == 0);
    try testing.expect(pipe(&out_pipe) == 0);
    defer for ([_]c_int{ raw_pipe[0], raw_pipe[1], wire_pipe[0], wire_pipe[1], out_pipe[0], out_pipe[1] }) |fd| {
        _ = close(fd);
    };

    const payload = "roundtrip through the native pump";
    try testing.expect(write(raw_pipe[1], payload, payload.len) == payload.len);

    try testing.expectEqual(@as(usize, 1), forwardEncrypt(&s.a, raw_pipe[0], wire_pipe[1], 1));
    try testing.expectEqual(@as(usize, 1), forwardDecrypt(&s.b, wire_pipe[0], out_pipe[1], 1));

    var out: [256]u8 = undefined;
    const on = read(out_pipe[0], &out, out.len);
    try testing.expect(on >= payload.len);
    try testing.expectEqualSlices(u8, payload, out[0..payload.len]);
}

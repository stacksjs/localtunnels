//! libltvpn — C ABI surface consumed from Bun via bun:ffi.
//!
//! All functions return 0 on success and a negative LtvpnError code on
//! failure (or a byte count where documented). Handles are opaque pointers
//! owned by this library; free them with the matching *_free function.
const std = @import("std");
const keys = @import("keys.zig");
const noise = @import("noise.zig");
const transport = @import("transport.zig");
const tun = @import("tun.zig");
const pump = @import("pump.zig");

pub const kdf = @import("kdf.zig");
pub const replay = @import("replay.zig");
pub const tai64n = @import("tai64n.zig");
pub const rand = @import("rand.zig");
pub const cookie = @import("cookie.zig");

const allocator = std.heap.smp_allocator;

/// ABI version — bump on any breaking change to this surface.
const abi_version: u32 = 3;

const LtvpnError = enum(i32) {
    ok = 0,
    wrong_state = -1,
    invalid_message = -2,
    invalid_mac = -3,
    decrypt_failed = -4,
    weak_key = -5,
    buffer_too_small = -6,
    payload_too_large = -7,
    wrong_receiver = -8,
    replay = -9,
    counter_exhausted = -10,
    out_of_memory = -11,
    entropy_unavailable = -12,
};

fn noiseErrCode(err: noise.Error) i32 {
    return @intFromEnum(@as(LtvpnError, switch (err) {
        error.WrongState => .wrong_state,
        error.InvalidMessage => .invalid_message,
        error.InvalidMac => .invalid_mac,
        error.DecryptFailed => .decrypt_failed,
        error.WeakKey => .weak_key,
        error.EntropyUnavailable => .entropy_unavailable,
    }));
}

fn transportErrCode(err: transport.Error) i32 {
    return @intFromEnum(@as(LtvpnError, switch (err) {
        error.PayloadTooLarge => .payload_too_large,
        error.BufferTooSmall => .buffer_too_small,
        error.InvalidMessage => .invalid_message,
        error.WrongReceiver => .wrong_receiver,
        error.DecryptFailed => .decrypt_failed,
        error.Replay => .replay,
        error.CounterExhausted => .counter_exhausted,
    }));
}

export fn ltvpn_version() u32 {
    return abi_version;
}

// ── Keys ────────────────────────────────────────────────────────────────────

export fn ltvpn_keypair(out_priv: *[32]u8, out_pub: *[32]u8) i32 {
    keys.generate(out_priv, out_pub) catch |e| return @intFromEnum(@as(LtvpnError, switch (e) {
        error.WeakKey => .weak_key,
        error.EntropyUnavailable => .entropy_unavailable,
    }));
    return 0;
}

export fn ltvpn_pubkey(priv: *const [32]u8, out_pub: *[32]u8) i32 {
    keys.publicFromPrivate(priv, out_pub) catch return @intFromEnum(LtvpnError.weak_key);
    return 0;
}

// ── Handshake ───────────────────────────────────────────────────────────────

export fn ltvpn_hs_new(
    is_initiator: u8,
    static_priv: *const [32]u8,
    peer_static_pub: ?*const [32]u8,
    psk: ?*const [32]u8,
) ?*noise.HandshakeState {
    const role: noise.Role = if (is_initiator != 0) .initiator else .responder;
    const hs = allocator.create(noise.HandshakeState) catch return null;
    hs.* = noise.HandshakeState.init(role, static_priv, peer_static_pub, psk) catch {
        allocator.destroy(hs);
        return null;
    };
    return hs;
}

export fn ltvpn_hs_free(hs: *noise.HandshakeState) void {
    hs.deinit();
    allocator.destroy(hs);
}

export fn ltvpn_hs_create_initiation(
    hs: *noise.HandshakeState,
    sender_index: u32,
    unix_sec: u64,
    nano: u32,
    out: *[noise.initiation_len]u8,
) i32 {
    hs.createInitiation(sender_index, unix_sec, nano, out) catch |e| return noiseErrCode(e);
    return 0;
}

export fn ltvpn_hs_consume_initiation(
    hs: *noise.HandshakeState,
    msg: *const [noise.initiation_len]u8,
    out_peer_pub: *[32]u8,
    out_peer_index: *u32,
    out_timestamp: *[12]u8,
) i32 {
    hs.consumeInitiation(msg) catch |e| return noiseErrCode(e);
    out_peer_pub.* = hs.peer_static_pub;
    out_peer_index.* = hs.peer_index;
    out_timestamp.* = hs.peer_timestamp;
    return 0;
}

export fn ltvpn_hs_create_response(
    hs: *noise.HandshakeState,
    sender_index: u32,
    out: *[noise.response_len]u8,
) i32 {
    hs.createResponse(sender_index, out) catch |e| return noiseErrCode(e);
    return 0;
}

export fn ltvpn_hs_consume_response(hs: *noise.HandshakeState, msg: *const [noise.response_len]u8) i32 {
    hs.consumeResponse(msg) catch |e| return noiseErrCode(e);
    return 0;
}

export fn ltvpn_hs_peer_index(hs: *const noise.HandshakeState) u32 {
    return hs.peer_index;
}

// ── Transport sessions ──────────────────────────────────────────────────────

/// Create a transport session directly from a completed handshake.
export fn ltvpn_session_from_handshake(hs: *noise.HandshakeState) ?*transport.Session {
    var send_key: [32]u8 = undefined;
    var recv_key: [32]u8 = undefined;
    hs.deriveTransportKeys(&send_key, &recv_key) catch return null;
    const s = allocator.create(transport.Session) catch return null;
    s.* = transport.Session.init(&send_key, &recv_key, hs.local_index, hs.peer_index);
    std.crypto.secureZero(u8, &send_key);
    std.crypto.secureZero(u8, &recv_key);
    return s;
}

export fn ltvpn_session_new(
    send_key: *const [32]u8,
    recv_key: *const [32]u8,
    local_index: u32,
    peer_index: u32,
) ?*transport.Session {
    const s = allocator.create(transport.Session) catch return null;
    s.* = transport.Session.init(send_key, recv_key, local_index, peer_index);
    return s;
}

export fn ltvpn_session_free(s: *transport.Session) void {
    s.deinit();
    allocator.destroy(s);
}

/// Bytes required to hold an encrypted packet for `plain_len` plaintext bytes.
export fn ltvpn_encrypted_len(plain_len: usize) usize {
    return transport.encryptedLen(plain_len);
}

/// Returns bytes written (> 0) or a negative error code.
export fn ltvpn_session_encrypt(
    s: *transport.Session,
    plaintext: [*]const u8,
    plain_len: usize,
    out: [*]u8,
    out_cap: usize,
) isize {
    const n = s.encrypt(plaintext[0..plain_len], out[0..out_cap]) catch |e| return transportErrCode(e);
    return @intCast(n);
}

/// Returns padded plaintext bytes written (>= 0) or a negative error code.
export fn ltvpn_session_decrypt(
    s: *transport.Session,
    msg: [*]const u8,
    msg_len: usize,
    out: [*]u8,
    out_cap: usize,
) isize {
    const n = s.decrypt(msg[0..msg_len], out[0..out_cap]) catch |e| return transportErrCode(e);
    return @intCast(n);
}

// ── TUN device ──────────────────────────────────────────────────────────────

/// Open a TUN device. On success writes the interface name (NUL-terminated,
/// e.g. "utun4") into `name_out` and returns the file descriptor (>= 0). On
/// failure returns a negative errno.
export fn ltvpn_tun_open(name_out: [*]u8, name_cap: usize) i32 {
    var dev: tun.Device = undefined;
    const rc = tun.open_device(&dev);
    if (rc != 0) return rc;
    const name = dev.nameSlice();
    const copy = @min(name.len, if (name_cap == 0) 0 else name_cap - 1);
    @memcpy(name_out[0..copy], name[0..copy]);
    if (name_cap > 0) name_out[copy] = 0;
    return dev.fd;
}

/// Read one IP packet (non-blocking). Returns bytes read, 0 if none pending,
/// or a negative errno.
export fn ltvpn_tun_read(fd: i32, buf: [*]u8, cap: usize) isize {
    return tun.read_packet(fd, buf, cap);
}

/// Write one IP packet. Returns bytes written or a negative errno.
export fn ltvpn_tun_write(fd: i32, buf: [*]const u8, len: usize) isize {
    return tun.write_packet(fd, buf, len);
}

export fn ltvpn_tun_close(fd: i32) void {
    tun.close_device(fd);
}

// ── Native packet pump (M5) ──────────────────────────────────────────────────

/// Drain up to `max_packets` plaintext packets from `in_fd`, encrypt each with
/// `session`, and write them to `out_fd`. Returns packets forwarded.
export fn ltvpn_forward_encrypt(s: *transport.Session, in_fd: i32, out_fd: i32, max_packets: usize) usize {
    return pump.forwardEncrypt(s, in_fd, out_fd, max_packets);
}

/// Drain up to `max_packets` wire messages from `in_fd`, decrypt each with
/// `session`, and write the plaintext to `out_fd`. Returns packets written.
export fn ltvpn_forward_decrypt(s: *transport.Session, in_fd: i32, out_fd: i32, max_packets: usize) usize {
    return pump.forwardDecrypt(s, in_fd, out_fd, max_packets);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test {
    _ = kdf;
    _ = keys;
    _ = noise;
    _ = transport;
    _ = replay;
    _ = tai64n;
    _ = rand;
    _ = tun;
    _ = pump;
    _ = cookie;
    _ = @import("vectors.zig");
}

test "C ABI end-to-end: keypair → handshake → transport" {
    const testing = std.testing;

    var i_priv: [32]u8 = undefined;
    var i_pub: [32]u8 = undefined;
    var r_priv: [32]u8 = undefined;
    var r_pub: [32]u8 = undefined;
    try testing.expectEqual(@as(i32, 0), ltvpn_keypair(&i_priv, &i_pub));
    try testing.expectEqual(@as(i32, 0), ltvpn_keypair(&r_priv, &r_pub));

    const ini = ltvpn_hs_new(1, &i_priv, &r_pub, null) orelse return error.TestUnexpectedResult;
    const res = ltvpn_hs_new(0, &r_priv, null, null) orelse return error.TestUnexpectedResult;
    defer ltvpn_hs_free(ini);
    defer ltvpn_hs_free(res);

    var m1: [noise.initiation_len]u8 = undefined;
    try testing.expectEqual(@as(i32, 0), ltvpn_hs_create_initiation(ini, 7, 1_700_000_000, 0, &m1));

    var learned_pub: [32]u8 = undefined;
    var learned_index: u32 = 0;
    var ts: [12]u8 = undefined;
    try testing.expectEqual(@as(i32, 0), ltvpn_hs_consume_initiation(res, &m1, &learned_pub, &learned_index, &ts));
    try testing.expectEqualSlices(u8, &i_pub, &learned_pub);
    try testing.expectEqual(@as(u32, 7), learned_index);

    var m2: [noise.response_len]u8 = undefined;
    try testing.expectEqual(@as(i32, 0), ltvpn_hs_create_response(res, 9, &m2));
    try testing.expectEqual(@as(i32, 0), ltvpn_hs_consume_response(ini, &m2));

    const si = ltvpn_session_from_handshake(ini) orelse return error.TestUnexpectedResult;
    const sr = ltvpn_session_from_handshake(res) orelse return error.TestUnexpectedResult;
    defer ltvpn_session_free(si);
    defer ltvpn_session_free(sr);

    const payload = "ip packet goes here";
    var wire: [256]u8 = undefined;
    const wn = ltvpn_session_encrypt(si, payload.ptr, payload.len, &wire, wire.len);
    try testing.expect(wn > 0);
    try testing.expectEqual(transport.encryptedLen(payload.len), @as(usize, @intCast(wn)));

    var plain: [256]u8 = undefined;
    const pn = ltvpn_session_decrypt(sr, &wire, @intCast(wn), &plain, plain.len);
    try testing.expect(pn >= payload.len);
    try testing.expectEqualSlices(u8, payload, plain[0..payload.len]);

    // Replay is rejected with the dedicated error code.
    const again = ltvpn_session_decrypt(sr, &wire, @intCast(wn), &plain, plain.len);
    try testing.expectEqual(@as(isize, @intFromEnum(LtvpnError.replay)), again);
}

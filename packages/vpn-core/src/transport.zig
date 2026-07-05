//! WireGuard transport data messages (type 4, whitepaper §5.4.6) with
//! sliding-window replay protection.
const std = @import("std");
const noise = @import("noise.zig");
const replay = @import("replay.zig");

const ChaCha20Poly1305 = std.crypto.aead.chacha_poly.ChaCha20Poly1305;

pub const header_len = 16;
pub const tag_len = 16;
/// Largest plaintext we accept per packet (well above any sane tunnel MTU).
pub const max_plaintext_len = 4096;

pub const Error = error{
    PayloadTooLarge,
    BufferTooSmall,
    InvalidMessage,
    WrongReceiver,
    DecryptFailed,
    Replay,
    CounterExhausted,
};

fn paddedLen(len: usize) usize {
    return (len + 15) & ~@as(usize, 15);
}

/// Bytes needed to encrypt a plaintext of `plain_len`.
pub fn encryptedLen(plain_len: usize) usize {
    return header_len + paddedLen(plain_len) + tag_len;
}

pub const Session = struct {
    send_key: [32]u8,
    recv_key: [32]u8,
    /// Index peers put in messages addressed to us.
    local_index: u32,
    /// Index we put in messages addressed to the peer.
    peer_index: u32,
    send_counter: u64 = 0,
    recv_window: replay.ReplayWindow = .{},

    pub fn init(send_key: *const [32]u8, recv_key: *const [32]u8, local_index: u32, peer_index: u32) Session {
        return .{
            .send_key = send_key.*,
            .recv_key = recv_key.*,
            .local_index = local_index,
            .peer_index = peer_index,
        };
    }

    pub fn deinit(self: *Session) void {
        std.crypto.secureZero(u8, &self.send_key);
        std.crypto.secureZero(u8, &self.recv_key);
    }

    /// Encrypt one packet (empty plaintext = keepalive). Returns bytes written.
    pub fn encrypt(self: *Session, plaintext: []const u8, out: []u8) Error!usize {
        if (plaintext.len > max_plaintext_len) return error.PayloadTooLarge;
        const total = encryptedLen(plaintext.len);
        if (out.len < total) return error.BufferTooSmall;
        if (self.send_counter >= replay.reject_after_messages) return error.CounterExhausted;

        const counter = self.send_counter;
        self.send_counter += 1;

        @memset(out[0..4], 0);
        out[0] = noise.message_type_data;
        std.mem.writeInt(u32, out[4..8], self.peer_index, .little);
        std.mem.writeInt(u64, out[8..16], counter, .little);

        // Zero-pad the plaintext to a 16-byte multiple (whitepaper §5.4.6).
        var padded: [max_plaintext_len]u8 = undefined;
        const plen = paddedLen(plaintext.len);
        @memcpy(padded[0..plaintext.len], plaintext);
        @memset(padded[plaintext.len..plen], 0);

        var nonce: [12]u8 = @splat(0);
        std.mem.writeInt(u64, nonce[4..12], counter, .little);
        ChaCha20Poly1305.encrypt(
            out[header_len..][0..plen],
            out[header_len + plen ..][0..tag_len],
            padded[0..plen],
            &.{},
            nonce,
            self.send_key,
        );
        std.crypto.secureZero(u8, padded[0..plen]);
        return total;
    }

    /// Decrypt one packet. Returns the padded plaintext length written to
    /// `out` (0 for keepalives). Callers recover the true length from the
    /// inner IP header's total-length field.
    pub fn decrypt(self: *Session, msg: []const u8, out: []u8) Error!usize {
        if (msg.len < header_len + tag_len) return error.InvalidMessage;
        if (msg[0] != noise.message_type_data or msg[1] != 0 or msg[2] != 0 or msg[3] != 0) {
            return error.InvalidMessage;
        }
        if (std.mem.readInt(u32, msg[4..8], .little) != self.local_index) {
            return error.WrongReceiver;
        }
        const counter = std.mem.readInt(u64, msg[8..16], .little);
        if (!self.recv_window.isFresh(counter)) return error.Replay;

        const plen = msg.len - header_len - tag_len;
        if (plen % 16 != 0 or plen > max_plaintext_len) return error.InvalidMessage;
        if (out.len < plen) return error.BufferTooSmall;

        var nonce: [12]u8 = @splat(0);
        std.mem.writeInt(u64, nonce[4..12], counter, .little);
        var tag: [16]u8 = undefined;
        @memcpy(&tag, msg[header_len + plen ..][0..tag_len]);
        ChaCha20Poly1305.decrypt(
            out[0..plen],
            msg[header_len..][0..plen],
            tag,
            &.{},
            nonce,
            self.recv_key,
        ) catch return error.DecryptFailed;

        // Only mark the counter after successful authentication.
        if (!self.recv_window.update(counter)) return error.Replay;
        return plen;
    }
};

const testing = std.testing;

fn testSessions() struct { a: Session, b: Session } {
    const k1: [32]u8 = @splat(0xaa);
    const k2: [32]u8 = @splat(0xbb);
    return .{
        .a = Session.init(&k1, &k2, 0x01, 0x02),
        .b = Session.init(&k2, &k1, 0x02, 0x01),
    };
}

test "transport roundtrip with padding" {
    var s = testSessions();
    const payload = "hello wireguard, this is not a multiple of sixteen";
    var wire: [encryptedLen(payload.len)]u8 = undefined;
    const n = try s.a.encrypt(payload, &wire);
    try testing.expectEqual(wire.len, n);

    var plain: [max_plaintext_len]u8 = undefined;
    const m = try s.b.decrypt(wire[0..n], &plain);
    try testing.expectEqual(paddedLen(payload.len), m);
    try testing.expectEqualSlices(u8, payload, plain[0..payload.len]);
    // Padding is zeroed.
    for (plain[payload.len..m]) |b| try testing.expectEqual(@as(u8, 0), b);
}

test "keepalive (empty) packets work" {
    var s = testSessions();
    var wire: [header_len + tag_len]u8 = undefined;
    const n = try s.a.encrypt(&.{}, &wire);
    try testing.expectEqual(wire.len, n);
    var plain: [16]u8 = undefined;
    try testing.expectEqual(@as(usize, 0), try s.b.decrypt(wire[0..n], &plain));
}

test "replayed packet is rejected" {
    var s = testSessions();
    var wire: [encryptedLen(4)]u8 = undefined;
    const n = try s.a.encrypt("ping", &wire);
    var plain: [64]u8 = undefined;
    _ = try s.b.decrypt(wire[0..n], &plain);
    try testing.expectError(error.Replay, s.b.decrypt(wire[0..n], &plain));
}

test "tampered packet fails authentication without poisoning the window" {
    var s = testSessions();
    var wire: [encryptedLen(4)]u8 = undefined;
    const n = try s.a.encrypt("ping", &wire);
    var evil = wire;
    evil[header_len] ^= 0x01;
    var plain: [64]u8 = undefined;
    try testing.expectError(error.DecryptFailed, s.b.decrypt(evil[0..n], &plain));
    // The genuine packet still decrypts: failed auth must not mark the counter.
    _ = try s.b.decrypt(wire[0..n], &plain);
}

test "wrong receiver index is rejected" {
    var s = testSessions();
    var wire: [encryptedLen(4)]u8 = undefined;
    const n = try s.a.encrypt("ping", &wire);
    var plain: [64]u8 = undefined;
    var other = Session.init(&s.b.send_key, &s.b.recv_key, 0x99, 0x01);
    try testing.expectError(error.WrongReceiver, other.decrypt(wire[0..n], &plain));
}

test "counters increment across packets" {
    var s = testSessions();
    var wire: [encryptedLen(1)]u8 = undefined;
    var plain: [16]u8 = undefined;
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        const n = try s.a.encrypt("x", &wire);
        _ = try s.b.decrypt(wire[0..n], &plain);
    }
    try testing.expectEqual(@as(u64, 100), s.a.send_counter);
}

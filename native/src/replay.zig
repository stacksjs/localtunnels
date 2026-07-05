//! RFC 6479-style sliding-window nonce replay protection (whitepaper §5.4.6).
const std = @import("std");

/// REJECT_AFTER_MESSAGES = 2^64 - 2^13 - 1
pub const reject_after_messages: u64 = std.math.maxInt(u64) - 8192 - 1;

pub const ReplayWindow = struct {
    const num_words = 32;
    const word_bits = 64;
    /// Usable window size; one word is sacrificed for the shifting scheme.
    pub const window_size: u64 = (num_words - 1) * word_bits;

    bitmap: [num_words]u64 = @splat(0),
    max_counter: u64 = 0,

    /// Read-only freshness check (no state change).
    pub fn isFresh(self: *const ReplayWindow, counter: u64) bool {
        if (counter >= reject_after_messages) return false;
        if (counter > self.max_counter) return true;
        if (self.max_counter - counter > window_size) return false;
        const word = (counter / word_bits) % num_words;
        const bit: u6 = @intCast(counter % word_bits);
        return (self.bitmap[word] >> bit) & 1 == 0;
    }

    /// Check freshness and mark the counter as seen. Returns false on replay
    /// or out-of-window counters. Call only after packet authentication.
    pub fn update(self: *ReplayWindow, counter: u64) bool {
        if (!self.isFresh(counter)) return false;
        if (counter > self.max_counter) {
            const cur_word = self.max_counter / word_bits;
            const new_word = counter / word_bits;
            const diff = @min(new_word - cur_word, num_words);
            var i: u64 = 1;
            while (i <= diff) : (i += 1) {
                self.bitmap[(cur_word + i) % num_words] = 0;
            }
            self.max_counter = counter;
        }
        const word = (counter / word_bits) % num_words;
        const bit: u6 = @intCast(counter % word_bits);
        self.bitmap[word] |= @as(u64, 1) << bit;
        return true;
    }
};

test "accepts first counter zero and rejects its replay" {
    var w = ReplayWindow{};
    try std.testing.expect(w.update(0));
    try std.testing.expect(!w.update(0));
    try std.testing.expect(w.update(1));
    try std.testing.expect(!w.update(1));
}

test "accepts out-of-order within window, rejects too-old" {
    var w = ReplayWindow{};
    try std.testing.expect(w.update(5000));
    // In-window, unseen, older counter is fine.
    try std.testing.expect(w.update(4000));
    try std.testing.expect(!w.update(4000));
    // Far beyond the window is rejected.
    try std.testing.expect(!w.update(5000 - ReplayWindow.window_size - 1));
    // Window edge is accepted.
    try std.testing.expect(w.update(5000 - ReplayWindow.window_size));
}

test "window slides forward and clears stale bits" {
    var w = ReplayWindow{};
    var c: u64 = 0;
    while (c < 10_000) : (c += 1) {
        try std.testing.expect(w.update(c));
    }
    try std.testing.expect(!w.update(9_999));
    try std.testing.expect(w.update(1_000_000));
    try std.testing.expect(!w.update(9_000));
}

test "rejects counters past REJECT_AFTER_MESSAGES" {
    var w = ReplayWindow{};
    try std.testing.expect(!w.update(reject_after_messages));
    try std.testing.expect(!w.update(std.math.maxInt(u64)));
}

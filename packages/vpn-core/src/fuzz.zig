//! Randomized / property tests, in the spirit of WireGuard's own fuzzers: feed
//! adversarial and random input to every parser and invariant and assert they
//! reject cleanly (never trap, never double-accept), plus deterministic PRNG
//! property tests for the replay window.
const std = @import("std");
const noise = @import("noise.zig");
const transport = @import("transport.zig");
const replay = @import("replay.zig");
const cookie = @import("cookie.zig");
const keys = @import("keys.zig");

const testing = std.testing;

fn kp(seed_byte: u8) !keys.X25519.KeyPair {
    const seed: [32]u8 = @splat(seed_byte);
    return keys.X25519.KeyPair.generateDeterministic(seed);
}

test "fuzz: replay window never double-accepts an authenticated counter" {
    var prng = std.Random.DefaultPrng.init(0x1234_5678_9abc_def0);
    const rng = prng.random();
    var w = replay.ReplayWindow{};
    var seen = std.AutoHashMap(u64, void).init(testing.allocator);
    defer seen.deinit();

    var i: usize = 0;
    while (i < 50_000) : (i += 1) {
        // Counters clustered in a moving band to exercise slide + in-window hits.
        const c = rng.intRangeAtMost(u64, 0, 8000);
        if (w.update(c)) {
            // Invariant: a counter accepted by update() must be brand new.
            try testing.expect(!seen.contains(c));
            try seen.put(c, {});
        }
    }
}

test "fuzz: strictly increasing counters are always accepted; repeats never" {
    var w = replay.ReplayWindow{};
    var c: u64 = 0;
    while (c < 20_000) : (c += 3) {
        try testing.expect(w.update(c));
        try testing.expect(!w.update(c));
    }
}

test "fuzz: consumeInitiation rejects random input without trapping" {
    var prng = std.Random.DefaultPrng.init(0xdead_beef_0000_0001);
    const rng = prng.random();
    const rkp = try kp(200);

    // A failed consumeInitiation leaves the state `.fresh`, so one responder
    // can screen every random message (fast, and still valid fuzzing).
    var res = try noise.HandshakeState.init(.responder, &rkp.secret_key, null, null);
    defer res.deinit();

    var i: usize = 0;
    while (i < 4000) : (i += 1) {
        var msg: [noise.initiation_len]u8 = undefined;
        rng.bytes(&msg);
        // Half the time force a valid header so we exercise deeper parsing.
        if (i % 2 == 0) {
            msg[0] = noise.message_type_initiation;
            msg[1] = 0;
            msg[2] = 0;
            msg[3] = 0;
        }
        // Must return an error (bad mac1 / decrypt), never crash or accept.
        if (res.consumeInitiation(&msg)) |_| {
            return error.UnexpectedAcceptance;
        } else |_| {}
    }
}

test "fuzz: consumeResponse rejects random input without trapping" {
    var prng = std.Random.DefaultPrng.init(0xfeed_face_0000_0002);
    const rng = prng.random();
    const ikp = try kp(201);
    const rkp = try kp(202);

    // A failed consumeResponse leaves the state `.created_initiation`, so one
    // initiator (with a single real initiation) can screen every random reply.
    var ini = try noise.HandshakeState.init(.initiator, &ikp.secret_key, &rkp.public_key, null);
    defer ini.deinit();
    var m1: [noise.initiation_len]u8 = undefined;
    try ini.createInitiation(1, 1_700_000_000, 0, &m1);

    var i: usize = 0;
    while (i < 4000) : (i += 1) {
        var m2: [noise.response_len]u8 = undefined;
        rng.bytes(&m2);
        if (i % 2 == 0) {
            m2[0] = noise.message_type_response;
            m2[1] = 0;
            m2[2] = 0;
            m2[3] = 0;
            // Point the receiver index at our real local index so parsing
            // proceeds past that check into the crypto.
            std.mem.writeInt(u32, m2[8..12], 1, .little);
        }
        if (ini.consumeResponse(&m2)) |_| {
            return error.UnexpectedAcceptance;
        } else |_| {}
    }
}

test "fuzz: transport decrypt rejects random / arbitrary-length input" {
    var prng = std.Random.DefaultPrng.init(0x0bad_c0de_0000_0003);
    const rng = prng.random();
    const k1: [32]u8 = @splat(0x5a);
    const k2: [32]u8 = @splat(0xa5);
    var s = transport.Session.init(&k1, &k2, 0x11223344, 0x55667788);

    var buf: [transport.max_plaintext_len + 64]u8 = undefined;
    var out: [transport.max_plaintext_len + 64]u8 = undefined;
    var i: usize = 0;
    while (i < 5000) : (i += 1) {
        const len = rng.intRangeAtMost(usize, 0, buf.len);
        rng.bytes(buf[0..len]);
        if (i % 3 == 0 and len >= 16) {
            buf[0] = noise.message_type_data;
            buf[1] = 0;
            buf[2] = 0;
            buf[3] = 0;
            std.mem.writeInt(u32, buf[4..8], s.local_index, .little);
        }
        if (s.decrypt(buf[0..len], &out)) |_| {
            return error.UnexpectedAcceptance;
        } else |_| {}
    }
}

test "fuzz: cookie reply open rejects random input" {
    var prng = std.Random.DefaultPrng.init(0xc001_d00d_0000_0004);
    const rng = prng.random();
    const rpub: [32]u8 = @splat(0x3c);
    var key: [32]u8 = undefined;
    cookie.cookieKey(&key, &rpub);
    const mac1: [16]u8 = @splat(0x77);

    var i: usize = 0;
    while (i < 3000) : (i += 1) {
        var msg: [cookie.cookie_reply_len]u8 = undefined;
        rng.bytes(&msg);
        if (i % 2 == 0) {
            msg[0] = cookie.message_type_cookie_reply;
            msg[1] = 0;
            msg[2] = 0;
            msg[3] = 0;
        }
        var out: [16]u8 = undefined;
        if (cookie.openCookieReply(&out, &msg, &key, &mac1)) |_| {
            return error.UnexpectedAcceptance;
        } else |_| {}
    }
}

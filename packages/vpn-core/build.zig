const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    // Default the shipped library to ReleaseFast. standardOptimizeOption's
    // preferred mode only applies when `--release` is passed, so a bare
    // `zig build` (what `bun run build:native` runs) would ship a Debug
    // crypto hot path. -Doptimize=... still overrides for debugging.
    //
    // Spelled as a qualified reference rather than the `.ReleaseFast` enum
    // literal because CI tracks zig master, which renamed these fields to
    // debug/safe/fast/small (0.17.0-dev.1786). `ReleaseFast` survives there as
    // a deprecated `pub const ReleaseFast: @This() = .fast`, so a qualified
    // lookup resolves on both sides of the rename while a literal resolves on
    // neither: `.fast` is not a field before it and `.ReleaseFast` is not a
    // field after it. Switch to `.fast` once the floor is past the rename --
    // upstream keeps the alias until after 0.18.0.
    const optimize = b.option(std.builtin.OptimizeMode, "optimize", "Optimization mode (default: ReleaseFast)") orelse std.builtin.OptimizeMode.ReleaseFast;

    // Link libc everywhere, Linux included.
    //
    // macOS and Windows need it outright (getentropy and utun via libSystem,
    // BCryptGenRandom). Linux does not — everything there goes through raw
    // syscalls via `std.os.linux` — and this used to say so, building the
    // Linux library libc-free on the reasoning that a self-contained object
    // loads on any glibc or musl host without a `libc.so` dependency.
    //
    // It does not load at all. A dynamic library built libc-free comes out
    // static-PIE, and a static-PIE object is built to relocate *itself* the
    // way an executable does at startup. Nothing does that for it when the
    // dynamic loader maps it into an existing process, so the first call into
    // it touches unrelocated addresses and the host process takes a SIGSEGV —
    // which is what every Linux deploy did, on the first FFI call, with the
    // crash reported against Bun rather than against this library.
    //
    // Portability across host libc versions is a cross-compile concern, not a
    // linkage one: build against an old glibc (`-Dtarget=x86_64-linux-gnu.2.31`)
    // and the result runs on anything newer.
    const link_libc = true;
    const mod = b.createModule(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = link_libc,
    });

    const lib = b.addLibrary(.{
        .name = "ltvpn",
        .root_module = mod,
        .linkage = .dynamic,
    });
    b.installArtifact(lib);

    // Tests always link libc: the test helpers use C ABI calls (pipe,
    // socketpair) on every OS, and zig 0.17+ requires the libc dependency to
    // be explicit. The shipped library module above stays libc-free on Linux.
    // Tests build Debug regardless of the library mode so assertions and
    // safety checks (overflow, OOB) stay active.
    const test_mod = b.createModule(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = .Debug,
        .link_libc = true,
    });
    const tests = b.addTest(.{ .root_module = test_mod });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run libltvpn unit tests");
    test_step.dependOn(&run_tests.step);
}

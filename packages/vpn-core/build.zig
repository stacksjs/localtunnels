const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .ReleaseFast });

    // Link libc on macOS (getentropy + utun via libSystem) and Windows
    // (BCryptGenRandom). On Linux everything goes through raw syscalls
    // (`std.os.linux`), so the shared library is self-contained and loads on
    // any glibc/musl host without a `libc.so` dependency.
    const link_libc = target.result.os.tag != .linux;
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

    const tests = b.addTest(.{ .root_module = mod });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run libltvpn unit tests");
    test_step.dependOn(&run_tests.step);
}

//! Cross-platform TUN (layer-3) device support.
//!
//! macOS: a `utun` control socket (PF_SYSTEM / SYSPROTO_CONTROL) via libc. Each
//!        frame carries a 4-byte address-family header we strip/prepend so
//!        callers only ever see bare IP packets.
//! Linux: `/dev/net/tun` via raw syscalls (`std.os.linux`) — no libc, so the
//!        shared library is fully self-contained and loads on any glibc/musl
//!        box. TUNSETIFF (IFF_TUN | IFF_NO_PI) yields bare IP packets.
//!
//! Opening a TUN device requires elevated privileges; without them `open`
//! returns a negative errno (e.g. -1 EPERM / -13 EACCES) rather than trapping.
const std = @import("std");
const builtin = @import("builtin");
const linux_os = std.os.linux;

// libc — referenced only on the macOS path (pruned entirely on other targets).
extern "c" fn socket(domain: c_int, sock_type: c_int, protocol: c_int) c_int;
extern "c" fn connect(fd: c_int, addr: *const anyopaque, len: u32) c_int;
extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
extern "c" fn getsockopt(fd: c_int, level: c_int, optname: c_int, optval: *anyopaque, optlen: *u32) c_int;
extern "c" fn getpeername(fd: c_int, addr: *anyopaque, len: *u32) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, n: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, n: usize) isize;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn fcntl(fd: c_int, cmd: c_int, ...) c_int;
extern "c" fn __error() *c_int; // macOS errno

/// Current errno on macOS (also used by pump.zig for its raw fd I/O).
pub fn macErrno() i32 {
    return @intCast(__error().*);
}

/// Largest IP packet we move in one read/write — bound to the transport
/// layer's per-packet maximum so anything the tunnel can carry fits through
/// the TUN layer too (they drifted apart at 2048 vs 4096 before).
pub const max_packet = @import("transport.zig").max_plaintext_len;

pub const Error = error{
    Unsupported,
    OpenFailed,
    ConfigFailed,
};

// ── constants ────────────────────────────────────────────────────────────────

const F_SETFL: c_int = 4;

const macos = struct {
    const AF_SYSTEM: c_int = 32;
    const PF_SYSTEM: c_int = AF_SYSTEM;
    const AF_SYS_CONTROL: u16 = 2;
    const SYSPROTO_CONTROL: c_int = 2;
    const SOCK_DGRAM: c_int = 2;
    const UTUN_OPT_IFNAME: c_int = 2;
    const O_NONBLOCK: c_int = 0x0004;
    const EINTR = 4;
    const EAGAIN = 35;
    const EMSGSIZE = 40;
    const utun_control_name = "com.apple.net.utun_control";

    // CTLIOCGINFO = _IOWR('N', 3, struct ctl_info); computed to avoid a header.
    const IOCPARM_MASK: c_ulong = 0x1fff;
    const IOC_OUT: c_ulong = 0x40000000;
    const IOC_IN: c_ulong = 0x80000000;
    const CTLIOCGINFO: c_ulong = (IOC_IN | IOC_OUT) |
        ((@as(c_ulong, @sizeOf(ctl_info)) & IOCPARM_MASK) << 16) |
        (@as(c_ulong, 'N') << 8) | 3;

    const ctl_info = extern struct {
        ctl_id: u32 = 0,
        ctl_name: [96]u8 = @splat(0),
    };

    const sockaddr_ctl = extern struct {
        sc_len: u8,
        sc_family: u8,
        ss_sysaddr: u16,
        sc_id: u32,
        sc_unit: u32,
        sc_reserved: [5]u32 = @splat(0),
    };
};

const linux = struct {
    const IFF_TUN: c_short = 0x0001;
    const IFF_NO_PI: c_short = 0x1000;
    // TUNSETIFF = _IOW('T', 202, int)
    const TUNSETIFF: u32 = 0x400454ca;
    const EINTR = 4;
    const EAGAIN = 11;

    const ifreq = extern struct {
        ifr_name: [16]u8 = @splat(0),
        ifr_flags: c_short = 0,
        _pad: [22]u8 = @splat(0),
    };

    /// Decode a raw syscall return: negative on error (-errno), else the value.
    fn signed(rc: usize) isize {
        return @bitCast(rc);
    }
};

// ── device ───────────────────────────────────────────────────────────────────

pub const Device = struct {
    fd: c_int,
    /// Interface name (e.g. "utun4" or "tun0"), NUL-terminated.
    name: [32]u8,

    pub fn nameSlice(self: *const Device) []const u8 {
        const len = std.mem.indexOfScalar(u8, &self.name, 0) orelse self.name.len;
        return self.name[0..len];
    }
};

/// Open a TUN device. Returns a negative errno on failure.
pub fn open_device(dev: *Device) i32 {
    switch (builtin.os.tag) {
        .macos => return openMacos(dev),
        .linux => return openLinux(dev),
        else => return -1,
    }
}

fn openMacos(dev: *Device) i32 {
    const fd = socket(macos.PF_SYSTEM, macos.SOCK_DGRAM, macos.SYSPROTO_CONTROL);
    if (fd < 0) return -macErrno();

    var info = macos.ctl_info{};
    @memcpy(info.ctl_name[0..macos.utun_control_name.len], macos.utun_control_name);
    if (ioctl(fd, macos.CTLIOCGINFO, &info) != 0) {
        const e = -macErrno();
        _ = close(fd);
        return e;
    }

    // sc_unit 0 lets the kernel pick the next free utun number.
    var addr = macos.sockaddr_ctl{
        .sc_len = @sizeOf(macos.sockaddr_ctl),
        .sc_family = macos.AF_SYSTEM,
        .ss_sysaddr = macos.AF_SYS_CONTROL,
        .sc_id = info.ctl_id,
        .sc_unit = 0,
    };
    if (connect(fd, &addr, @sizeOf(macos.sockaddr_ctl)) != 0) {
        const e = -macErrno();
        _ = close(fd);
        return e;
    }

    @memset(&dev.name, 0);
    var name_len: u32 = @intCast(dev.name.len);
    if (getsockopt(fd, macos.SYSPROTO_CONTROL, macos.UTUN_OPT_IFNAME, &dev.name, &name_len) != 0) {
        const e = -macErrno();
        _ = close(fd);
        return e;
    }

    _ = fcntl(fd, F_SETFL, macos.O_NONBLOCK);
    dev.fd = fd;
    return 0;
}

fn openLinux(dev: *Device) i32 {
    // Open /dev/net/tun read-write and non-blocking in one syscall.
    const flags = linux_os.O{ .ACCMODE = .RDWR, .NONBLOCK = true };
    const orc = linux.signed(linux_os.open("/dev/net/tun", flags, 0));
    if (orc < 0) return @intCast(orc);
    const fd: i32 = @intCast(orc);

    var req = linux.ifreq{};
    req.ifr_flags = linux.IFF_TUN | linux.IFF_NO_PI;
    const irc = linux.signed(linux_os.ioctl(fd, linux.TUNSETIFF, @intFromPtr(&req)));
    if (irc < 0) {
        _ = linux_os.close(fd);
        return @intCast(irc);
    }

    @memset(&dev.name, 0);
    const n = std.mem.indexOfScalar(u8, &req.ifr_name, 0) orelse req.ifr_name.len;
    @memcpy(dev.name[0..n], req.ifr_name[0..n]);

    dev.fd = fd;
    return 0;
}

/// True when `fd` is a TUN device whose frames carry framing beyond the bare
/// IP packet (the macOS utun 4-byte AF header). A utun fd is a connected
/// PF_SYSTEM control socket, so we require the peer family to be AF_SYSTEM
/// and UTUN_OPT_IFNAME to yield a "utun*" name — getsockopt alone is not
/// discriminating enough (it also succeeds on e.g. AF_UNIX sockets). Linux
/// TUN (IFF_TUN | IFF_NO_PI) and every other descriptor move bare IP packets.
pub fn is_framed_tun(fd: c_int) bool {
    switch (builtin.os.tag) {
        .macos => {
            // sockaddr layout on macOS: sa_len(u8), sa_family(u8), data...
            var addr: [128]u8 = undefined;
            var addr_len: u32 = @intCast(addr.len);
            if (getpeername(fd, &addr, &addr_len) != 0) return false;
            if (addr_len < 2 or addr[1] != macos.AF_SYSTEM) return false;
            var name: [32]u8 = undefined;
            var name_len: u32 = @intCast(name.len);
            if (getsockopt(fd, macos.SYSPROTO_CONTROL, macos.UTUN_OPT_IFNAME, &name, &name_len) != 0) return false;
            return std.mem.startsWith(u8, &name, "utun");
        },
        else => return false,
    }
}

/// Read one IP packet into `buf`. Returns bytes read, 0 if none available
/// (non-blocking), or a negative errno. On macOS the 4-byte AF header is
/// stripped so `buf` holds a bare IP packet, and a packet larger than `cap`
/// is consumed and reported as -EMSGSIZE rather than silently truncated
/// into a corrupt prefix. EINTR is retried.
pub fn read_packet(fd: c_int, buf: [*]u8, cap: usize) isize {
    // A zero-capacity read must not consume (and thereby drop) a packet.
    if (cap == 0) return 0;
    switch (builtin.os.tag) {
        .macos => {
            var scratch: [max_packet + 4]u8 = undefined;
            while (true) {
                const n = read(fd, &scratch, scratch.len);
                if (n < 0) {
                    const e = macErrno();
                    if (e == macos.EINTR) continue;
                    return if (e == macos.EAGAIN) 0 else -e;
                }
                if (n <= 4) return 0;
                const payload: usize = @intCast(n - 4);
                if (payload > cap) return -macos.EMSGSIZE;
                @memcpy(buf[0..payload], scratch[4 .. 4 + payload]);
                return @intCast(payload);
            }
        },
        .linux => {
            while (true) {
                const n = linux.signed(linux_os.read(fd, buf, cap));
                if (n == -linux.EINTR) continue;
                if (n < 0)
                    return if (n == -linux.EAGAIN) 0 else n;
                return n;
            }
        },
        else => return -1,
    }
}

/// Write one IP packet. Returns bytes written (packet length) or -errno. On
/// macOS the required 4-byte AF header is prepended based on the IP version.
/// EINTR is retried.
pub fn write_packet(fd: c_int, buf: [*]const u8, len: usize) isize {
    if (len == 0) return 0;
    switch (builtin.os.tag) {
        .macos => {
            if (len > max_packet) return -macos.EMSGSIZE;
            var scratch: [max_packet + 4]u8 = undefined;
            const version = buf[0] >> 4;
            const af: u32 = if (version == 6) 30 else 2; // AF_INET6 / AF_INET
            std.mem.writeInt(u32, scratch[0..4], af, .big);
            @memcpy(scratch[4 .. 4 + len], buf[0..len]);
            while (true) {
                const n = write(fd, &scratch, len + 4);
                if (n < 0) {
                    const e = macErrno();
                    if (e == macos.EINTR) continue;
                    return -e;
                }
                if (n < 4) return 0;
                return @intCast(@as(usize, @intCast(n)) - 4);
            }
        },
        .linux => {
            while (true) {
                const n = linux.signed(linux_os.write(fd, buf, len));
                if (n == -linux.EINTR) continue;
                return n;
            }
        },
        else => return -1,
    }
}

pub fn close_device(fd: c_int) void {
    switch (builtin.os.tag) {
        .linux => _ = linux_os.close(fd),
        .macos => _ = close(fd),
        else => {},
    }
}

test "ctl ioctl number matches the documented CTLIOCGINFO value" {
    // _IOWR('N', 3, struct ctl_info) with sizeof(ctl_info) == 100.
    try std.testing.expectEqual(@as(usize, 100), @sizeOf(macos.ctl_info));
    try std.testing.expectEqual(@as(c_ulong, 0xC0644E03), macos.CTLIOCGINFO);
}

test "linux tun structs have the expected sizes" {
    // ifreq is 40 bytes on Linux; TUNSETIFF flags are IFF_TUN|IFF_NO_PI.
    try std.testing.expectEqual(@as(usize, 40), @sizeOf(linux.ifreq));
    try std.testing.expectEqual(@as(c_short, 0x1001), linux.IFF_TUN | linux.IFF_NO_PI);
}

test "opening a tun device without privileges fails cleanly" {
    // In CI / normal test runs we are unprivileged: open_device must return a
    // negative errno, never trap. If we happen to be root, it may succeed —
    // verify the framing probe recognizes it, then close it again.
    var dev: Device = undefined;
    const rc = open_device(&dev);
    if (rc == 0) {
        if (builtin.os.tag == .macos) try std.testing.expect(is_framed_tun(dev.fd));
        close_device(dev.fd);
    } else {
        try std.testing.expect(rc < 0);
    }
}

extern "c" fn pipe(fds: [*]c_int) c_int;
extern "c" fn socketpair(domain: c_int, sock_type: c_int, protocol: c_int, sv: [*]c_int) c_int;

test "is_framed_tun is false for ordinary descriptors" {
    var fds: [2]c_int = undefined;
    try std.testing.expect(pipe(&fds) == 0);
    defer for (fds) |fd| {
        _ = close(fd);
    };
    try std.testing.expect(!is_framed_tun(fds[0]));
    try std.testing.expect(!is_framed_tun(fds[1]));
    try std.testing.expect(!is_framed_tun(-1));

    // Connected AF_UNIX datagram sockets (the pump's test transport, and the
    // closest lookalike to a utun control socket) must not probe as TUN.
    const AF_UNIX: c_int = 1;
    var sv: [2]c_int = undefined;
    try std.testing.expect(socketpair(AF_UNIX, macos.SOCK_DGRAM, 0, &sv) == 0);
    defer for (sv) |fd| {
        _ = close(fd);
    };
    try std.testing.expect(!is_framed_tun(sv[0]));
}

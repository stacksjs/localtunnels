//! Cross-platform TUN (layer-3) device support.
//!
//! macOS: a `utun` control socket (PF_SYSTEM / SYSPROTO_CONTROL). Each frame
//!        is prefixed on the wire with a 4-byte address family; we strip it on
//!        read and prepend it on write so callers only ever see raw IP packets.
//! Linux: `/dev/net/tun` configured with TUNSETIFF (IFF_TUN | IFF_NO_PI), which
//!        already yields bare IP packets (no header).
//!
//! Opening a TUN device requires elevated privileges; without them `open`
//! returns a negative errno (e.g. -1 EPERM / -13 EACCES) rather than trapping.
const std = @import("std");
const builtin = @import("builtin");

extern "c" fn socket(domain: c_int, sock_type: c_int, protocol: c_int) c_int;
extern "c" fn connect(fd: c_int, addr: *const anyopaque, len: u32) c_int;
extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
extern "c" fn getsockopt(fd: c_int, level: c_int, optname: c_int, optval: *anyopaque, optlen: *u32) c_int;
extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, n: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, n: usize) isize;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn fcntl(fd: c_int, cmd: c_int, ...) c_int;

const errno_location = switch (builtin.os.tag) {
    .macos => struct {
        extern "c" fn __error() *c_int;
    }.__error,
    .linux => struct {
        extern "c" fn __errno_location() *c_int;
    }.__errno_location,
    else => struct {
        fn stub() *c_int {
            const s = struct {
                var e: c_int = 0;
            };
            return &s.e;
        }
    }.stub,
};

fn errno() i32 {
    return @intCast(errno_location().*);
}

/// EAGAIN/EWOULDBLOCK differ by platform (35 on macOS, 11 on Linux).
fn wouldBlock(e: i32) bool {
    return switch (builtin.os.tag) {
        .macos => e == 35,
        .linux => e == 11,
        else => false,
    };
}

/// Largest IP packet we move in one read/write (jumbo-safe headroom).
pub const max_packet = 2048;

pub const Error = error{
    Unsupported,
    OpenFailed,
    ConfigFailed,
};

// ── constants ────────────────────────────────────────────────────────────────

const O_RDWR: c_int = 0x0002;
const F_SETFL: c_int = 4;

const macos = struct {
    const AF_SYSTEM: c_int = 32;
    const PF_SYSTEM: c_int = AF_SYSTEM;
    const AF_SYS_CONTROL: u16 = 2;
    const SYSPROTO_CONTROL: c_int = 2;
    const SOCK_DGRAM: c_int = 2;
    const UTUN_OPT_IFNAME: c_int = 2;
    const O_NONBLOCK: c_int = 0x0004;
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
    const O_NONBLOCK: c_int = 0o4000;
    const IFF_TUN: c_short = 0x0001;
    const IFF_NO_PI: c_short = 0x1000;
    // TUNSETIFF = _IOW('T', 202, int)
    const TUNSETIFF: c_ulong = 0x400454ca;
    const dev_path = "/dev/net/tun";

    const ifreq = extern struct {
        ifr_name: [16]u8 = @splat(0),
        ifr_flags: c_short = 0,
        _pad: [22]u8 = @splat(0),
    };
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

fn setNonBlocking(fd: c_int) void {
    const flag = switch (builtin.os.tag) {
        .macos => macos.O_NONBLOCK,
        .linux => linux.O_NONBLOCK,
        else => 0,
    };
    _ = fcntl(fd, F_SETFL, flag);
}

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
    if (fd < 0) return -errno();

    var info = macos.ctl_info{};
    @memcpy(info.ctl_name[0..macos.utun_control_name.len], macos.utun_control_name);
    if (ioctl(fd, macos.CTLIOCGINFO, &info) != 0) {
        const e = -errno();
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
        const e = -errno();
        _ = close(fd);
        return e;
    }

    @memset(&dev.name, 0);
    var name_len: u32 = @intCast(dev.name.len);
    if (getsockopt(fd, macos.SYSPROTO_CONTROL, macos.UTUN_OPT_IFNAME, &dev.name, &name_len) != 0) {
        const e = -errno();
        _ = close(fd);
        return e;
    }

    setNonBlocking(fd);
    dev.fd = fd;
    return 0;
}

fn openLinux(dev: *Device) i32 {
    const fd = open(linux.dev_path, O_RDWR);
    if (fd < 0) return -errno();

    var req = linux.ifreq{};
    req.ifr_flags = linux.IFF_TUN | linux.IFF_NO_PI;
    if (ioctl(fd, linux.TUNSETIFF, &req) != 0) {
        const e = -errno();
        _ = close(fd);
        return e;
    }

    @memset(&dev.name, 0);
    const n = std.mem.indexOfScalar(u8, &req.ifr_name, 0) orelse req.ifr_name.len;
    @memcpy(dev.name[0..n], req.ifr_name[0..n]);

    setNonBlocking(fd);
    dev.fd = fd;
    return 0;
}

/// Read one IP packet into `buf`. Returns bytes read, 0 if none available
/// (non-blocking), or a negative errno. On macOS the 4-byte AF header is
/// stripped so `buf` holds a bare IP packet.
pub fn read_packet(fd: c_int, buf: [*]u8, cap: usize) isize {
    switch (builtin.os.tag) {
        .macos => {
            var scratch: [max_packet + 4]u8 = undefined;
            const want = @min(cap + 4, scratch.len);
            const n = read(fd, &scratch, want);
            if (n < 0) {
                const e = errno();
                return if (wouldBlock(e)) 0 else -e;
            }
            if (n <= 4) return 0;
            const payload: usize = @intCast(n - 4);
            const copy = @min(payload, cap);
            @memcpy(buf[0..copy], scratch[4 .. 4 + copy]);
            return @intCast(copy);
        },
        .linux => {
            const n = read(fd, buf, cap);
            if (n < 0) {
                const e = errno();
                return if (wouldBlock(e)) 0 else -e;
            }
            return n;
        },
        else => return -1,
    }
}

/// Write one IP packet. Returns bytes written (packet length) or -errno. On
/// macOS the required 4-byte AF header is prepended based on the IP version.
pub fn write_packet(fd: c_int, buf: [*]const u8, len: usize) isize {
    if (len == 0) return 0;
    switch (builtin.os.tag) {
        .macos => {
            if (len > max_packet) return -1;
            var scratch: [max_packet + 4]u8 = undefined;
            const version = buf[0] >> 4;
            const af: u32 = if (version == 6) 30 else 2; // AF_INET6 / AF_INET
            std.mem.writeInt(u32, scratch[0..4], af, .big);
            @memcpy(scratch[4 .. 4 + len], buf[0..len]);
            const n = write(fd, &scratch, len + 4);
            if (n < 0) return -errno();
            if (n < 4) return 0;
            return @intCast(@as(usize, @intCast(n)) - 4);
        },
        .linux => {
            const n = write(fd, buf, len);
            if (n < 0) return -errno();
            return n;
        },
        else => return -1,
    }
}

pub fn close_device(fd: c_int) void {
    _ = close(fd);
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
    // in that case just close it again.
    var dev: Device = undefined;
    const rc = open_device(&dev);
    if (rc == 0) {
        close_device(dev.fd);
    } else {
        try std.testing.expect(rc < 0);
    }
}

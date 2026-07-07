/* eslint-disable node/prefer-global/process */
import { TypedEventEmitter } from '../types'
import { loadNative } from './ffi'

/** Errno values worth naming when a TUN device fails to open. */
const ERRNO: Record<number, string> = {
  1: 'EPERM (operation not permitted — run as root)',
  2: 'ENOENT (/dev/net/tun missing — is the tun module loaded?)',
  13: 'EACCES (permission denied — run as root)',
  16: 'EBUSY (device busy)',
}

export class TunError extends Error {
  readonly code: number
  constructor(code: number, message?: string) {
    super(message ?? `tun open failed: ${ERRNO[code] ?? `errno ${code}`}`)
    this.name = 'TunError'
    this.code = code
  }
}

export interface TunDeviceEvents {
  /** A raw IP packet arrived from the kernel. */
  packet: (packet: Uint8Array) => void
  error: (error: Error) => void
}

/**
 * Largest IP packet the native layer will move in one read/write. Mirrors
 * `tun.max_packet` in the Zig core (== `transport.max_plaintext_len`).
 */
const MAX_PACKET = 4096

/**
 * A layer-3 TUN device. Opening one requires root; without privileges
 * {@link open} throws a {@link TunError} rather than crashing.
 *
 * Reads are drained by polling the non-blocking fd — a deliberately simple
 * first cut. The zero-copy native event loop (issue #28, M5) replaces this.
 */
export class TunDevice extends TypedEventEmitter<TunDeviceEvents> {
  readonly fd: number
  readonly name: string
  private readonly readBuf = new Uint8Array(MAX_PACKET)
  private poller: ReturnType<typeof setInterval> | null = null
  private closed = false

  private constructor(fd: number, name: string) {
    super()
    this.fd = fd
    this.name = name
  }

  /** Open a new TUN device. Throws {@link TunError} on failure. */
  static open(): TunDevice {
    if (process.platform === 'win32') {
      throw new TunError(-95, 'TUN devices are not supported on Windows. The UDP '
        + 'datapath (lt vpn demo/mesh-demo, VpnPeer/VpnNode) works; for a routed '
        + 'interface, use a WireGuard client — the wire protocol is compatible.')
    }
    const lib = loadNative()
    const nameBuf = new Uint8Array(32)
    const fd = lib.ltvpn_tun_open(nameBuf, BigInt(nameBuf.length))
    if (fd < 0)
      throw new TunError(-fd)
    const end = nameBuf.indexOf(0)
    const name = new TextDecoder().decode(nameBuf.subarray(0, end < 0 ? nameBuf.length : end))
    return new TunDevice(fd, name)
  }

  /** Begin draining packets, emitting `packet` for each one. */
  start(pollIntervalMs = 1): void {
    if (this.poller || this.closed)
      return
    const lib = loadNative()
    this.poller = setInterval(() => {
      // Drain everything currently queued before yielding.
      for (let i = 0; i < 128; i++) {
        const n = Number(lib.ltvpn_tun_read(this.fd, this.readBuf, BigInt(this.readBuf.length)))
        if (n === 0)
          break
        if (n < 0) {
          this.emit('error', new Error(`tun read failed: errno ${-n}`))
          break
        }
        this.emit('packet', this.readBuf.slice(0, n))
      }
    }, pollIntervalMs)
  }

  /** Write one raw IP packet to the kernel. Returns bytes written. */
  write(packet: Uint8Array): number {
    if (this.closed)
      throw new Error('tun device closed')
    if (packet.length === 0 || packet.length > MAX_PACKET)
      throw new RangeError(`packet length must be 1..${MAX_PACKET}`)
    const lib = loadNative()
    const n = Number(lib.ltvpn_tun_write(this.fd, packet, BigInt(packet.length)))
    if (n < 0)
      throw new Error(`tun write failed: errno ${-n}`)
    return n
  }

  close(): void {
    if (this.closed)
      return
    this.closed = true
    if (this.poller) {
      clearInterval(this.poller)
      this.poller = null
    }
    loadNative().ltvpn_tun_close(this.fd)
  }
}

/**
 * Assign an address to a TUN interface and bring it up, shelling out to the
 * platform tools (`ifconfig` on macOS, `ip` on Linux). Requires root.
 *
 * `address` is this node's tunnel IP; `peer` is the point-to-point remote
 * (macOS utun requires it); `cidrPrefix` sizes the route (default /16).
 */
export async function configureInterface(
  name: string,
  address: string,
  peer: string,
  cidrPrefix?: number,
): Promise<void> {
  for (const cmd of configureInterfaceCommands(name, address, peer, cidrPrefix)) {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    if (code !== 0) {
      const err = await new Response(proc.stderr).text()
      throw new Error(`\`${cmd.join(' ')}\` failed (exit ${code}): ${err.trim()}`)
    }
  }
}

/**
 * The platform commands `configureInterface` runs, as data (pure — testable
 * without root). Handles both IPv4 and IPv6 (detected by a ':' in `address`).
 */
export function configureInterfaceCommands(
  name: string,
  address: string,
  peer: string,
  cidrPrefix?: number,
): string[][] {
  const v6 = address.includes(':')
  const prefix = cidrPrefix ?? (v6 ? 64 : 16)

  if (process.platform === 'darwin') {
    if (v6) {
      return [
        ['ifconfig', name, 'inet6', address, 'prefixlen', String(prefix), 'up'],
      ]
    }
    return [
      ['ifconfig', name, address, peer, 'up'],
      ['route', '-n', 'add', '-net', networkOf(address, prefix), '-interface', name],
    ]
  }

  // Linux
  if (v6) {
    return [
      ['ip', '-6', 'addr', 'add', `${address}/${prefix}`, 'dev', name],
      ['ip', 'link', 'set', 'dev', name, 'up'],
    ]
  }
  return [
    ['ip', 'addr', 'add', `${address}/${prefix}`, 'dev', name],
    ['ip', 'link', 'set', 'dev', name, 'up'],
  ]
}

/**
 * Commands that turn this host into an exit node for `tunName`: enable kernel
 * IP forwarding and NAT (masquerade) outbound traffic to `wanInterface`. Pure
 * (returns the commands) so it is testable; execute with {@link enableExitNode}.
 * Requires root when run.
 */
export function exitNodeCommands(tunName: string, wanInterface: string): string[][] {
  if (process.platform === 'darwin') {
    // macOS uses pf; forwarding via sysctl, NAT via a pf anchor the caller loads.
    return [
      ['sysctl', '-w', 'net.inet.ip.forwarding=1'],
      ['sysctl', '-w', 'net.inet6.ip6.forwarding=1'],
    ]
  }
  // Linux: sysctl forwarding + iptables/ip6tables masquerade.
  return [
    ['sysctl', '-w', 'net.ipv4.ip_forward=1'],
    ['sysctl', '-w', 'net.ipv6.conf.all.forwarding=1'],
    ['iptables', '-t', 'nat', '-A', 'POSTROUTING', '-o', wanInterface, '-j', 'MASQUERADE'],
    ['iptables', '-A', 'FORWARD', '-i', tunName, '-o', wanInterface, '-j', 'ACCEPT'],
    ['iptables', '-A', 'FORWARD', '-i', wanInterface, '-o', tunName, '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'],
  ]
}

/** Run {@link exitNodeCommands}. Requires root; throws on the first failure. */
export async function enableExitNode(tunName: string, wanInterface: string): Promise<void> {
  for (const cmd of exitNodeCommands(tunName, wanInterface)) {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    if (code !== 0) {
      const err = await new Response(proc.stderr).text()
      throw new Error(`\`${cmd.join(' ')}\` failed (exit ${code}): ${err.trim()}`)
    }
  }
}

/** Compute the network address (host bits zeroed) for an IPv4 addr + prefix. */
function networkOf(address: string, prefix: number): string {
  const octets = address.split('.').map(Number)
  const ip = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0
  const net = (ip & mask) >>> 0
  return `${(net >>> 24) & 0xFF}.${(net >>> 16) & 0xFF}.${(net >>> 8) & 0xFF}.${net & 0xFF}/${prefix}`
}

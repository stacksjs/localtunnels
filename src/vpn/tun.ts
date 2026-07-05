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
  constructor(code: number) {
    super(`tun open failed: ${ERRNO[code] ?? `errno ${code}`}`)
    this.name = 'TunError'
    this.code = code
  }
}

export interface TunDeviceEvents {
  /** A raw IP packet arrived from the kernel. */
  packet: (packet: Uint8Array) => void
  error: (error: Error) => void
}

/** Largest IP packet the native layer will move in one read/write. */
const MAX_PACKET = 2048

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
  cidrPrefix = 16,
): Promise<void> {
  const platform = process.platform
  const runs: string[][] = platform === 'darwin'
    ? [
        ['ifconfig', name, address, peer, 'up'],
        ['route', '-n', 'add', '-net', networkOf(address, cidrPrefix), '-interface', name],
      ]
    : [
        ['ip', 'addr', 'add', `${address}/${cidrPrefix}`, 'dev', name],
        ['ip', 'link', 'set', 'dev', name, 'up'],
      ]

  for (const cmd of runs) {
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

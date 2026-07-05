/**
 * Cryptokey routing (WireGuard's allowed-ips): a mapping from IP CIDR ranges
 * (IPv4 or IPv6) to the peer public key responsible for them. It answers:
 *   - outbound: which peer should a packet destined for X be sent to?
 *   - inbound:  is peer P allowed to source a packet claiming address X?
 *
 * Longest-prefix match wins, exactly as in a routing table. A default route
 * (`0.0.0.0/0` or `::/0`) makes a peer an exit node for that family. IPv4 and
 * IPv6 routes never match across families.
 */

type Family = 4 | 6

interface Route {
  family: Family
  base: bigint
  prefix: number
  mask: bigint
  peer: string
}

export class RoutingTable {
  private routes: Route[] = []

  /** Associate a set of CIDRs with a peer's base64 public key. */
  addPeer(peerPublicKey: string, allowedIps: string[]): void {
    for (const cidr of allowedIps) {
      const { family, base, prefix, mask } = parseCidr(cidr)
      this.routes.push({ family, base: base & mask, prefix, mask, peer: peerPublicKey })
    }
    // Longest prefix first so lookups can return the first match.
    this.routes.sort((a, b) => b.prefix - a.prefix)
  }

  /** Remove every route belonging to a peer. */
  removePeer(peerPublicKey: string): void {
    this.routes = this.routes.filter(r => r.peer !== peerPublicKey)
  }

  /** The peer that should carry a packet destined for `ip`, or null. */
  route(ip: string): string | null {
    const { family, value } = parseIp(ip)
    for (const r of this.routes) {
      if (r.family === family && (value & r.mask) === r.base)
        return r.peer
    }
    return null
  }

  /** Whether `peerPublicKey` is permitted to source a packet from `ip`. */
  isAllowed(peerPublicKey: string, ip: string): boolean {
    return this.route(ip) === peerPublicKey
  }
}

/** IP version of a raw packet (4, 6, or null if unrecognized). */
export function packetVersion(packet: Uint8Array): Family | null {
  if (packet.length < 1)
    return null
  const v = packet[0] >> 4
  return v === 4 || v === 6 ? (v as Family) : null
}

/**
 * The true length of an IP packet from its header, used to trim the zero
 * padding WireGuard's transport adds. Returns 0 if `packet` isn't a valid
 * IPv4/IPv6 header (e.g. a keepalive's all-zero padding).
 */
export function ipPacketLength(packet: Uint8Array): number {
  const v = packetVersion(packet)
  if (v === 4 && packet.length >= 20) {
    // IPv4 total length (header + data), bytes 2..4, big-endian.
    return (packet[2] << 8) | packet[3]
  }
  if (v === 6 && packet.length >= 40) {
    // IPv6 fixed 40-byte header + payload length (bytes 4..6).
    return 40 + ((packet[4] << 8) | packet[5])
  }
  return 0
}

/** Extract the source address from a raw IPv4/IPv6 packet, or null. */
export function packetSource(packet: Uint8Array): string | null {
  const v = packetVersion(packet)
  if (v === 4 && packet.length >= 20)
    return `${packet[12]}.${packet[13]}.${packet[14]}.${packet[15]}`
  if (v === 6 && packet.length >= 40)
    return formatIpv6(bytesToBig(packet.subarray(8, 24)))
  return null
}

/** Extract the destination address from a raw IPv4/IPv6 packet, or null. */
export function packetDestination(packet: Uint8Array): string | null {
  const v = packetVersion(packet)
  if (v === 4 && packet.length >= 20)
    return `${packet[16]}.${packet[17]}.${packet[18]}.${packet[19]}`
  if (v === 6 && packet.length >= 40)
    return formatIpv6(bytesToBig(packet.subarray(24, 40)))
  return null
}

// ── address parsing ──────────────────────────────────────────────────────────

function parseCidr(cidr: string): { family: Family, base: bigint, prefix: number, mask: bigint } {
  const slash = cidr.lastIndexOf('/')
  const addr = slash === -1 ? cidr : cidr.slice(0, slash)
  const { family, value } = parseIp(addr)
  const bits = family === 4 ? 32 : 128
  const prefix = slash === -1 ? bits : Number.parseInt(cidr.slice(slash + 1))
  if (Number.isNaN(prefix) || prefix < 0 || prefix > bits)
    throw new RangeError(`invalid CIDR prefix: ${cidr}`)
  const full = (1n << BigInt(bits)) - 1n
  const mask = prefix === 0 ? 0n : (full << BigInt(bits - prefix)) & full
  return { family, base: value, prefix, mask }
}

function parseIp(ip: string): { family: Family, value: bigint } {
  if (ip.includes(':'))
    return { family: 6, value: parseIpv6(ip) }
  return { family: 4, value: parseIpv4(ip) }
}

function parseIpv4(ip: string): bigint {
  const o = ip.split('.').map(Number)
  if (o.length !== 4 || o.some(n => Number.isNaN(n) || n < 0 || n > 255))
    throw new TypeError(`invalid IPv4 address: ${ip}`)
  return (BigInt(o[0]) << 24n) | (BigInt(o[1]) << 16n) | (BigInt(o[2]) << 8n) | BigInt(o[3])
}

function parseIpv6(ip: string): bigint {
  const halves = ip.split('::')
  if (halves.length > 2)
    throw new TypeError(`invalid IPv6 address: ${ip}`)

  const head = halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : null

  let groups: string[]
  if (tail === null) {
    groups = head
  }
  else {
    const missing = 8 - head.length - tail.length
    if (missing < 0)
      throw new TypeError(`invalid IPv6 address: ${ip}`)
    groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
  }
  if (groups.length !== 8)
    throw new TypeError(`invalid IPv6 address: ${ip}`)

  let value = 0n
  for (const g of groups) {
    const n = Number.parseInt(g || '0', 16)
    if (Number.isNaN(n) || n < 0 || n > 0xFFFF)
      throw new TypeError(`invalid IPv6 group "${g}" in ${ip}`)
    value = (value << 16n) | BigInt(n)
  }
  return value
}

function bytesToBig(bytes: Uint8Array): bigint {
  let v = 0n
  for (const b of bytes)
    v = (v << 8n) | BigInt(b)
  return v
}

/** Format a 128-bit value as a compressed IPv6 string (RFC 5952-ish). */
function formatIpv6(value: bigint): string {
  const groups: number[] = []
  for (let i = 7; i >= 0; i--)
    groups.push(Number((value >> BigInt(i * 16)) & 0xFFFFn))

  // Find the longest run of consecutive zero groups (length >= 2) to compress.
  let bestStart = -1
  let bestLen = 0
  let curStart = -1
  let curLen = 0
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart === -1)
        curStart = i
      curLen++
      if (curLen > bestLen) {
        bestLen = curLen
        bestStart = curStart
      }
    }
    else {
      curStart = -1
      curLen = 0
    }
  }

  if (bestLen < 2) {
    return groups.map(g => g.toString(16)).join(':')
  }

  const head = groups.slice(0, bestStart).map(g => g.toString(16)).join(':')
  const tail = groups.slice(bestStart + bestLen).map(g => g.toString(16)).join(':')
  return `${head}::${tail}`
}

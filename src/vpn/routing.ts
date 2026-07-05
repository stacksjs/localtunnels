/**
 * Cryptokey routing (WireGuard's allowed-ips): a mapping from IPv4 CIDR ranges
 * to the peer public key responsible for them. It answers two questions:
 *   - outbound: which peer should a packet destined for X be sent to?
 *   - inbound:  is peer P allowed to source a packet claiming address X?
 *
 * Longest-prefix match wins, exactly as in a routing table.
 */

interface Route {
  base: number
  prefix: number
  mask: number
  peer: string
}

export class RoutingTable {
  private routes: Route[] = []

  /** Associate a set of CIDRs with a peer's base64 public key. */
  addPeer(peerPublicKey: string, allowedIps: string[]): void {
    for (const cidr of allowedIps) {
      const { base, prefix, mask } = parseCidr(cidr)
      this.routes.push({ base: (base & mask) >>> 0, prefix, mask, peer: peerPublicKey })
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
    const addr = ipToInt(ip)
    for (const r of this.routes) {
      if ((addr & r.mask) >>> 0 === r.base)
        return r.peer
    }
    return null
  }

  /** Whether `peerPublicKey` is permitted to source a packet from `ip`. */
  isAllowed(peerPublicKey: string, ip: string): boolean {
    return this.route(ip) === peerPublicKey
  }
}

/** Extract the source IPv4 address from a raw IP packet, or null if not IPv4. */
export function packetSource(packet: Uint8Array): string | null {
  if (packet.length < 20 || (packet[0] >> 4) !== 4)
    return null
  return `${packet[12]}.${packet[13]}.${packet[14]}.${packet[15]}`
}

/** Extract the destination IPv4 address from a raw IP packet, or null. */
export function packetDestination(packet: Uint8Array): string | null {
  if (packet.length < 20 || (packet[0] >> 4) !== 4)
    return null
  return `${packet[16]}.${packet[17]}.${packet[18]}.${packet[19]}`
}

function parseCidr(cidr: string): { base: number, prefix: number, mask: number } {
  const [addr, prefixStr] = cidr.split('/')
  const prefix = prefixStr === undefined ? 32 : Number.parseInt(prefixStr)
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32)
    throw new RangeError(`invalid CIDR prefix: ${cidr}`)
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0
  return { base: ipToInt(addr), prefix, mask }
}

function ipToInt(ip: string): number {
  const o = ip.split('.').map(Number)
  if (o.length !== 4 || o.some(n => Number.isNaN(n) || n < 0 || n > 255))
    throw new TypeError(`invalid IPv4 address: ${ip}`)
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0
}

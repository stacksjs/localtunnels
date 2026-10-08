/**
 * The bridge between a TUN device and an encrypted peer datapath — the piece
 * that makes this a VPN rather than a message bus.
 *
 * Two directions, each with a policy decision:
 *
 *  - **Kernel → peers.** A packet the kernel routed into the interface is sent
 *    to whichever peer owns its destination address (cryptokey routing). No
 *    owner means no route, and the packet is dropped rather than broadcast.
 *  - **Peers → kernel.** A decrypted packet is written to the interface only if
 *    the peer that sent it is allowed to source that address. WireGuard calls
 *    this the inbound half of cryptokey routing, and skipping it is what lets
 *    an authorized-but-hostile peer inject traffic that appears to come from
 *    somewhere else on the network — including addresses it was never granted.
 *
 * Both directions are plain methods rather than inline listeners so the policy
 * can be tested without root, a TUN device, or the native library.
 */
import type { RoutingTable } from './routing'
import { packetDestination, packetSource } from './routing'

/** Why a packet did not make it across the bridge. */
export type DropReason
  /** Not a parseable IPv4/IPv6 packet (a runt, or transport padding). */
  = | 'malformed'
  /** Kernel → peers: no peer claims the destination address. */
    | 'no-route'
  /** Peers → kernel: the sender is not allowed to source that address. */
    | 'spoofed'
  /** Kernel → peers: the datapath refused it, usually no link yet. */
    | 'send-failed'
  /** Peers → kernel: the interface refused it, usually oversized. */
    | 'write-failed'

/** The part of a TUN device the bridge needs. */
export interface BridgeTun {
  write: (packet: Uint8Array) => number
  on: (event: 'packet', listener: (packet: Uint8Array) => void) => void
}

/** The part of an encrypted datapath the bridge needs. */
export interface BridgePeer {
  send: (peerPublicKeyB64: string, data: Uint8Array) => void
  on: (event: 'message', listener: (data: Uint8Array, from: string) => void) => void
}

export interface TunBridgeOptions {
  tun: BridgeTun
  peer: BridgePeer
  /** Cryptokey routing table. Shared with whoever adds and removes peers. */
  routes: RoutingTable
  /**
   * Verify that an inbound packet's source belongs to the peer that sent it.
   * Defaults to true and should stay that way: turning it off trusts every
   * authorized peer to address packets as anyone.
   *
   * It costs nothing in the exit-node case, which looks like it might break:
   * a client that routes `0.0.0.0/0` to its server already routes every source
   * address back to that server, so replies from the whole internet verify.
   */
  verifySource?: boolean
  /** Called for every dropped packet — metrics, debugging, tests. */
  onDrop?: (reason: DropReason, packet: Uint8Array, from?: string) => void
}

export interface BridgeStats {
  /** Packets written into the kernel. */
  toKernel: number
  /** Packets handed to the datapath for a peer. */
  toPeers: number
  dropped: Record<DropReason, number>
}

/** What happened to one packet. `'ok'` means it crossed. */
export type BridgeResult = 'ok' | DropReason

export class TunBridge {
  private readonly tun: BridgeTun
  private readonly peer: BridgePeer
  private readonly routes: RoutingTable
  private readonly verifySource: boolean
  private readonly onDrop?: (reason: DropReason, packet: Uint8Array, from?: string) => void
  private wired = false

  readonly stats: BridgeStats = {
    toKernel: 0,
    toPeers: 0,
    dropped: { 'malformed': 0, 'no-route': 0, 'spoofed': 0, 'send-failed': 0, 'write-failed': 0 },
  }

  constructor(options: TunBridgeOptions) {
    this.tun = options.tun
    this.peer = options.peer
    this.routes = options.routes
    this.verifySource = options.verifySource ?? true
    this.onDrop = options.onDrop
  }

  /** Subscribe both directions. Idempotent. */
  start(): void {
    if (this.wired)
      return
    this.wired = true
    this.peer.on('message', (packet, from) => this.inbound(packet, from))
    this.tun.on('packet', packet => this.outbound(packet))
  }

  /**
   * A decrypted packet from `from` heading for the kernel.
   *
   * The source check uses the same longest-prefix table as routing, so a peer
   * may source exactly the addresses it would receive traffic for.
   */
  inbound(packet: Uint8Array, from: string): BridgeResult {
    const src = packetSource(packet)
    if (!src)
      return this.drop('malformed', packet, from)

    if (this.verifySource && !this.routes.isAllowed(from, src))
      return this.drop('spoofed', packet, from)

    try {
      this.tun.write(packet)
    }
    catch {
      return this.drop('write-failed', packet, from)
    }
    this.stats.toKernel++
    return 'ok'
  }

  /** A packet the kernel put on the interface, heading for a peer. */
  outbound(packet: Uint8Array): BridgeResult {
    const dst = packetDestination(packet)
    if (!dst)
      return this.drop('malformed', packet)

    const target = this.routes.route(dst)
    if (!target)
      return this.drop('no-route', packet)

    try {
      this.peer.send(target, packet)
    }
    catch {
      // No link to that peer yet. The datapath retransmits its handshake, so
      // this resolves on its own; the packet is lost, as on any other link.
      return this.drop('send-failed', packet)
    }
    this.stats.toPeers++
    return 'ok'
  }

  private drop(reason: DropReason, packet: Uint8Array, from?: string): DropReason {
    this.stats.dropped[reason]++
    this.onDrop?.(reason, packet, from)
    return reason
  }
}

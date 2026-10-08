/**
 * A live layer-3 VPN interface: a TUN device, an encrypted datapath, and the
 * cryptokey routing between them, brought up in one call.
 *
 * This is the seam the two halves of the VPN were missing. `VpnPeer` + a TUN
 * device could carry real IP traffic but only to peers configured by hand, and
 * `VpnNode` could discover peers through a coordinator but only ever delivered
 * application messages. Neither was a usable VPN on its own:
 *
 *  - **Static mode** (`address` + `peers`) is the manual configuration: you
 *    know the keys, the endpoints, and which addresses live behind each peer.
 *  - **Coordinator mode** (`coordinatorUrl`) takes the address from the
 *    coordinator's assignment and the routes from its directory, so a node
 *    joins a network without being told anything about its members. Each peer
 *    is routed its own assigned address, which is cryptokey routing derived
 *    from the control plane rather than from flags.
 *
 * Both modes need root, because both create a network interface.
 */
import type { PeerRecord } from './protocol'
import type { VpnKeyPair } from './types'
import { TypedEventEmitter } from '../types'
import { TunBridge } from './bridge'
import { VpnNode } from './node'
import { VpnPeer } from './peer'
import { RoutingTable } from './routing'
import { configureInterface, TunDevice } from './tun'

/** A peer configured by hand, for static mode. */
export interface StaticPeer {
  /** base64 public key */
  publicKey: string
  /** CIDRs this peer is responsible for. `0.0.0.0/0` makes it an exit node. */
  allowedIps: string[]
  /** Dial this endpoint on bring-up. Omit to wait for the peer to dial us. */
  endpoint?: { host: string, port: number }
}

export interface VpnInterfaceOptions {
  keyPair: VpnKeyPair
  /** UDP port for the datapath. Default 51820; 0 picks an ephemeral port. */
  listenPort?: number
  /** Tunnel MTU. Default 1420. */
  mtu?: number
  /** Optional preshared key, applied to every peer. */
  presharedKey?: Uint8Array
  /**
   * Verify that inbound packets' sources belong to the peer that sent them.
   * Defaults to true; see {@link TunBridge}.
   */
  verifySource?: boolean

  /** Coordinator WebSocket URL. Set this for coordinator mode. */
  coordinatorUrl?: string
  /** Shared secret, when the coordinator requires one. */
  authKey?: string
  /**
   * Tell the network this node can carry traffic for the whole internet.
   *
   * This only advertises. Forwarding and NAT are a separate, privileged step
   * — see `enableExitNode` — and advertising without it leaves clients routing
   * their traffic into a node that drops it.
   */
  advertiseExitNode?: boolean
  /**
   * Route everything not bound for a tunnel peer through an exit node.
   *
   * A base64 public key pins one peer. `'auto'` takes the lowest-sorted peer
   * advertising itself as an exit, which is deterministic — so every node
   * agrees and a reconnect does not quietly move traffic to a different
   * volunteer — but it does trust whoever is advertising. Since the
   * coordinator cannot verify that claim, pin the key when it matters.
   *
   * Only the IPv4 default route is installed: coordinator mode assigns a v4
   * address, so the kernel has no reason to put v6 traffic on the interface,
   * and a `::/0` route would only hide that it has nowhere to go.
   */
  useExit?: string | 'auto'

  /** This node's tunnel address as CIDR (`10.8.0.2/24`). Static mode only. */
  address?: string
  /** Peers configured by hand. Static mode only. */
  peers?: StaticPeer[]
}

export interface VpnInterfaceInfo {
  /** Kernel interface name (`utun4`, `tun0`). */
  name: string
  /** This node's tunnel address. */
  address: string
  /** Prefix length of the tunnel network. */
  prefix: number
  /** Tunnel network CIDR, when a coordinator assigned it. */
  network?: string
}

export interface VpnInterfaceEvents {
  /** The interface is configured and carrying traffic. */
  up: (info: VpnInterfaceInfo) => void
  /** A peer gained routes (discovered, or configured at bring-up). */
  peerAdded: (info: { publicKey: string, allowedIps: string[] }) => void
  /** A peer left the directory and its routes were withdrawn. */
  peerRemoved: (info: { publicKey: string }) => void
  /**
   * The peer carrying the default route changed. `publicKey` is null when
   * there is no longer an exit — at which point non-tunnel traffic has no
   * route and is dropped rather than leaking out of the default interface.
   */
  exitChanged: (info: { publicKey: string | null }) => void
  /** An encrypted link to a peer completed its handshake. */
  link: (info: { peerPublicKey: string }) => void
  error: (error: Error) => void
}

export class VpnInterface extends TypedEventEmitter<VpnInterfaceEvents> {
  /** Cryptokey routing table. Readable for diagnostics; owned by this class. */
  readonly routes: RoutingTable = new RoutingTable()

  private readonly options: VpnInterfaceOptions
  private tun: TunDevice | null = null
  private node: VpnNode | null = null
  private peerDatapath: VpnPeer | null = null
  private bridge: TunBridge | null = null
  private info: VpnInterfaceInfo | null = null
  /**
   * Peers currently holding routes, mapped to the routes they hold, so a
   * directory update can tell "already correct" from "moved". Keying on the
   * public key alone is not enough: a coordinator restart clears its leases
   * and reissues addresses, so the same peer can reappear on a new address
   * without ever leaving the directory.
   */
  private routed = new Map<string, string>()
  /** The peer currently holding the default route, if any. */
  private exit: string | null = null

  constructor(options: VpnInterfaceOptions) {
    super()
    if (!options.coordinatorUrl && !options.address)
      throw new Error('VpnInterface needs either a coordinatorUrl or a static address')
    this.options = options
  }

  /** Interface name once up, else null. */
  get name(): string | null {
    return this.info?.name ?? null
  }

  /** This node's tunnel address once up, else null. */
  get address(): string | null {
    return this.info?.address ?? null
  }

  /** Packet counters and drop reasons, once up. */
  get stats(): TunBridge['stats'] | null {
    return this.bridge?.stats ?? null
  }

  /** The datapath carrying traffic — the node's peer in coordinator mode. */
  get datapath(): VpnPeer | null {
    return this.node?.peer ?? this.peerDatapath
  }

  /** The peer currently carrying the default route, or null. */
  get exitNode(): string | null {
    return this.exit
  }

  /**
   * Open the interface, join the network, and start forwarding.
   *
   * The datapath starts before the interface is configured so that, in
   * coordinator mode, the address is known by the time there is an interface
   * to put it on.
   */
  async up(): Promise<VpnInterfaceInfo> {
    const { keyPair, listenPort = 51820, mtu = 1420, presharedKey, verifySource } = this.options

    let address: string
    let prefix: number
    let network: string | undefined
    let datapath: VpnPeer

    if (this.options.coordinatorUrl) {
      const node = new VpnNode({
        keyPair,
        coordinatorUrl: this.options.coordinatorUrl,
        authKey: this.options.authKey,
        exitNode: this.options.advertiseExitNode,
        listenPort,
        presharedKey,
        // The tunnel carries bare IP packets off the TUN device, not framed
        // application messages.
        raw: true,
      })
      this.node = node
      node.on('error', err => this.emit('error', err))
      node.on('link', l => this.emit('link', l))
      // Routes follow the directory, so they are wired before registration
      // completes and the first directory arrives.
      node.on('peers', records => this.applyDirectory(records))

      const assigned = await node.start()
      address = assigned.assignedIp
      network = assigned.network
      prefix = prefixOf(assigned.network)
      datapath = node.peer
    }
    else {
      const [addr, prefixStr = '24'] = this.options.address!.split('/')
      address = addr
      prefix = Number.parseInt(prefixStr) || 24
      const peer = new VpnPeer({ keyPair, port: listenPort, presharedKey, raw: true })
      this.peerDatapath = peer
      peer.on('error', err => this.emit('error', err))
      peer.on('link', l => this.emit('link', { peerPublicKey: l.peerPublicKey }))
      await peer.start()
      datapath = peer
    }

    const tun = TunDevice.open()
    this.tun = tun

    // macOS utun is point-to-point and wants the remote address; the network's
    // first host stands in for "the other end" and is harmless on Linux.
    await configureInterface(tun.name, address, tunnelGateway(address, prefix), prefix, mtu)

    this.bridge = new TunBridge({ tun, peer: datapath, routes: this.routes, verifySource })
    this.bridge.start()
    tun.start()

    // Static peers get their routes once the bridge exists, so nothing is
    // forwarded before there is somewhere to forward it.
    for (const p of this.options.peers ?? []) {
      this.routes.addPeer(p.publicKey, p.allowedIps)
      this.routed.set(p.publicKey, signature(p.allowedIps))
      datapath.addPeer({ publicKey: decode(p.publicKey) })
      this.emit('peerAdded', { publicKey: p.publicKey, allowedIps: p.allowedIps })
    }

    this.info = { name: tun.name, address, prefix, network }
    this.emit('up', this.info)

    // Dial static peers that have an endpoint. Failures surface as events
    // rather than rejecting bring-up: the interface is already usable, and the
    // datapath retransmits its handshake.
    for (const p of this.options.peers ?? []) {
      if (!p.endpoint)
        continue
      datapath.connect(decode(p.publicKey), p.endpoint.host, p.endpoint.port)
        .catch(err => this.emit('error', err instanceof Error ? err : new Error(String(err))))
    }

    return this.info
  }

  /**
   * Reconcile routes against a coordinator directory.
   *
   * Every peer is routed exactly its own assigned address. A peer that has
   * left loses its routes, which also revokes its permission to source that
   * address inbound — the bridge consults the same table.
   *
   * Driven by the coordinator in coordinator mode, and public so a different
   * control plane (or a test) can supply the directory itself.
   */
  applyDirectory(records: PeerRecord[]): void {
    // Decided before any route is touched, because the exit peer's own route
    // set includes the default route: folding that in here means a change of
    // exit is just a change of route set, which the diff below already
    // handles — the old exit loses the default route and keeps its own
    // address in a single step.
    const exit = this.chooseExit(records)

    const present = new Set<string>()
    for (const rec of records) {
      present.add(rec.publicKey)
      const allowedIps = rec.publicKey === exit
        ? [`${rec.assignedIp}/32`, '0.0.0.0/0']
        : [`${rec.assignedIp}/32`]
      const want = signature(allowedIps)
      const have = this.routed.get(rec.publicKey)
      if (have === want)
        continue
      // Moved rather than new: drop the old routes first, or the stale address
      // keeps resolving to this peer and the new one resolves to nobody.
      if (have !== undefined)
        this.routes.removePeer(rec.publicKey)
      this.routes.addPeer(rec.publicKey, allowedIps)
      this.routed.set(rec.publicKey, want)
      this.emit('peerAdded', { publicKey: rec.publicKey, allowedIps })
    }
    for (const pub of [...this.routed.keys()]) {
      if (present.has(pub))
        continue
      this.routes.removePeer(pub)
      this.routed.delete(pub)
      this.emit('peerRemoved', { publicKey: pub })
    }

    // Announced after the table is consistent, so a listener that reads
    // `routes` on this event sees the route it is being told about.
    if (exit !== this.exit) {
      this.exit = exit
      this.emit('exitChanged', { publicKey: exit })
    }
  }

  /**
   * Which peer should carry the default route, given the directory.
   *
   * A pinned key is honoured whenever that peer is present, whether or not it
   * advertises: naming a key is already the decision, and refusing to use it
   * because the flag is missing would be surprising. `'auto'` considers only
   * peers that advertise, and sorts so the choice is stable.
   */
  private chooseExit(records: PeerRecord[]): string | null {
    const want = this.options.useExit
    if (!want)
      return null
    if (want !== 'auto')
      return records.some(r => r.publicKey === want) ? want : null
    return records.filter(r => r.exitNode).map(r => r.publicKey).sort()[0] ?? null
  }

  /** Tear the interface down and leave the network. */
  down(): void {
    this.tun?.close()
    this.tun = null
    this.node?.stop()
    this.node = null
    this.peerDatapath?.stop()
    this.peerDatapath = null
    this.bridge = null
    this.info = null
    this.routed.clear()
    this.exit = null
  }
}

/** Prefix length of a CIDR, defaulting to /16 when it has none. */
function prefixOf(cidr: string): number {
  const slash = cidr.lastIndexOf('/')
  if (slash === -1)
    return 16
  const n = Number.parseInt(cidr.slice(slash + 1))
  return Number.isNaN(n) ? 16 : n
}

/**
 * The first host address of the network `address` sits in — used as the
 * point-to-point remote. IPv6 returns the address itself, since utun does not
 * take a v6 destination.
 */
export function tunnelGateway(address: string, prefix: number): string {
  if (address.includes(':'))
    return address
  const o = address.split('.').map(Number)
  const ip = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0
  const first = ((ip & mask) + 1) >>> 0
  return `${(first >>> 24) & 0xFF}.${(first >>> 16) & 0xFF}.${(first >>> 8) & 0xFF}.${first & 0xFF}`
}

function decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/** A comparable form of a peer's route set. */
function signature(allowedIps: string[]): string {
  return [...allowedIps].sort().join(',')
}

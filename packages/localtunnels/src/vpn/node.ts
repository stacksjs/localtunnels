import type { PeerRecord } from './protocol'
import type { VpnKeyPair } from './types'
import { TypedEventEmitter } from '../types'
import { VpnCoordinatorClient } from './client'
import { decodeKey, encodeKey } from './keys'
import { VpnPeer } from './peer'

export interface VpnNodeOptions {
  keyPair: VpnKeyPair
  /** Coordinator WebSocket URL. */
  coordinatorUrl: string
  /** UDP port for the datapath. 0 (default) picks an ephemeral port. */
  listenPort?: number
  /** Optional preshared key applied to every peer. */
  presharedKey?: Uint8Array
  /**
   * Transport policy for reaching peers:
   *  - `auto` (default): try a direct UDP path, fall back to the relay.
   *  - `always`: always tunnel through the coordinator relay.
   *  - `never`: direct only; fail if unreachable.
   */
  relay?: 'auto' | 'always' | 'never'
  /** Raw (unframed) transport — carry bare IP packets, for TUN datapaths. */
  raw?: boolean
  /** Shared secret, when the coordinator was started with an auth key. */
  authKey?: string
  /** Advertise this node to the network as an exit node. */
  exitNode?: boolean
}

export interface VpnNodeEvents {
  /** Registered with the coordinator and assigned a tunnel IP. */
  ready: (info: { assignedIp: string, network: string }) => void
  /**
   * The coordinator's view of the other members changed. Carries the full
   * directory, not a delta, so a listener can reconcile by replacing its copy
   * — which is what cryptokey routing needs in order to drop routes for peers
   * that have left.
   */
  peers: (peers: PeerRecord[]) => void
  /** An encrypted link to a peer is up. */
  link: (info: { peerPublicKey: string }) => void
  /** An application message arrived from a peer. */
  message: (data: Uint8Array, from: string) => void
  /**
   * The coordinator has gone quiet and this node is about to be forgotten.
   *
   * Forwarded rather than handled, because what to do about it is not the
   * node's call: a long-lived tunnel wants to say so and keep going, and a
   * one-shot command may want to fail. What matters is that it is no longer
   * invisible — a dropped node keeps linking, keeps handshaking and keeps
   * reporting a healthy tunnel while its return route is withdrawn.
   */
  stale: (info: { reason: string, silentForMs: number }) => void
  /** The coordinator is answering again. */
  resumed: (info: { silentForMs: number }) => void
  error: (error: Error) => void
}

/**
 * A self-configuring VPN node: joins a network through a {@link VpnCoordinator},
 * discovers other members, and automatically establishes encrypted links to
 * them — no manual key or endpoint exchange.
 *
 * The node with the smaller public key dials first. Its peer gives it a head
 * start, then dials too if no handshake arrived. This lets a restarted node
 * recover even when an older peer still believes the previous session is live.
 */
export class VpnNode extends TypedEventEmitter<VpnNodeEvents> {
  readonly peer: VpnPeer
  readonly publicKeyB64: string
  private client: VpnCoordinatorClient | null = null
  private readonly keyPair: VpnKeyPair
  private readonly coordinatorUrl: string
  private readonly listenPort: number
  private readonly linked = new Set<string>()
  private readonly connecting = new Set<string>()
  private directory = new Map<string, PeerRecord>()
  private readonly fallbackDials = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly relayPolicy: 'auto' | 'always' | 'never'
  private readonly authKey?: string
  private readonly exitNode: boolean
  assignedIp: string | null = null

  constructor(options: VpnNodeOptions) {
    super()
    this.keyPair = options.keyPair
    this.coordinatorUrl = options.coordinatorUrl
    this.listenPort = options.listenPort ?? 0
    this.relayPolicy = options.relay ?? 'auto'
    this.authKey = options.authKey
    this.exitNode = options.exitNode ?? false
    this.publicKeyB64 = encodeKey(options.keyPair.publicKey)
    this.peer = new VpnPeer({
      keyPair: options.keyPair,
      port: this.listenPort,
      presharedKey: options.presharedKey,
      raw: options.raw ?? false,
    })
  }

  /** Start the datapath, join the coordinator, and begin auto-linking peers. */
  async start(): Promise<{ assignedIp: string, network: string }> {
    this.peer.on('link', (link) => {
      this.linked.add(link.peerPublicKey)
      this.cancelFallback(link.peerPublicKey)
      this.connecting.delete(link.peerPublicKey)
      this.emit('link', { peerPublicKey: link.peerPublicKey })
    })
    this.peer.on('message', (data, from) => this.emit('message', data, from))
    this.peer.on('error', err => this.emit('error', err))
    await this.peer.start()

    this.client = new VpnCoordinatorClient({
      url: this.coordinatorUrl,
      publicKey: this.publicKeyB64,
      listenPort: this.peer.port,
      authKey: this.authKey,
      exitNode: this.exitNode,
    })
    this.client.on('peers', records => this.onPeers(records))

    // A peer asked us to punch toward it: open our NAT mapping so its handshake
    // (or ours) can traverse.
    this.client.on('punch', (_from, endpoint) => this.peer.punch(endpoint.host, endpoint.port))
    // Relay path: hand outbound relayed frames to the coordinator, and feed
    // inbound relayed frames back into the datapath.
    this.peer.setRelay((toPub, frame) => this.client?.sendRelay(toPub, frame))
    this.client.on('relayFrame', (from, frame) => this.peer.receiveRelayFrame(from, frame))
    this.client.on('error', err => this.emit('error', err))
    this.client.on('stale', info => this.emit('stale', info))
    this.client.on('resumed', info => this.emit('resumed', info))

    const info = await this.client.connect()
    this.assignedIp = info.assignedIp
    this.emit('ready', info)
    return info
  }

  /** Send an application message to a peer by its base64 public key. */
  send(peerPublicKeyB64: string, data: Uint8Array): void {
    this.peer.send(peerPublicKeyB64, data)
  }

  private onPeers(records: PeerRecord[]): void {
    const directory = new Map(records.map(record => [record.publicKey, record]))
    for (const key of this.directory.keys()) {
      if (!directory.has(key)) {
        this.linked.delete(key)
        this.cancelFallback(key)
      }
    }
    this.directory = directory
    this.emit('peers', records)
    for (const rec of records) {
      const key = rec.publicKey
      this.peer.addPeer({ publicKey: decodeKey(key), endpoint: rec.endpoint })
      if (this.linked.has(key) || this.connecting.has(key))
        continue

      if (this.publicKeyB64 < key) {
        this.connecting.add(key)
        this.dial(rec)
      }
      else if (!this.fallbackDials.has(key)) {
        const timer = setTimeout(() => {
          this.fallbackDials.delete(key)
          const current = this.directory.get(key)
          if (current && !this.linked.has(key) && !this.connecting.has(key)) {
            this.connecting.add(key)
            this.dial(current)
          }
        }, 750)
        this.fallbackDials.set(key, timer)
      }
    }
  }

  private cancelFallback(key: string): void {
    clearTimeout(this.fallbackDials.get(key))
    this.fallbackDials.delete(key)
  }

  private dial(rec: PeerRecord): void {
    const pub = decodeKey(rec.publicKey)

    if (this.relayPolicy === 'always') {
      this.peer.connectViaRelay(pub).catch(err => this.onDialFailed(rec.publicKey, err))
      return
    }

    // NAT traversal: open our mapping toward the peer and ask it (via the
    // coordinator) to punch back, so its NAT admits our handshake. Then dial.
    this.peer.punch(rec.endpoint.host, rec.endpoint.port)
    this.client?.requestPunch(rec.publicKey)
    this.peer.connect(pub, rec.endpoint.host, rec.endpoint.port)
      .catch((err) => {
        if (this.relayPolicy === 'auto') {
          // Direct path failed (likely symmetric NAT) — fall back to the relay.
          this.peer.connectViaRelay(pub).catch(e => this.onDialFailed(rec.publicKey, e))
        }
        else {
          this.onDialFailed(rec.publicKey, err)
        }
      })
  }

  private onDialFailed(peerPublicKey: string, err: unknown): void {
    this.connecting.delete(peerPublicKey)
    this.emit('error', err instanceof Error ? err : new Error(String(err)))
  }

  stop(): void {
    this.client?.close()
    this.client = null
    this.peer.stop()
    this.linked.clear()
    this.connecting.clear()
    this.directory.clear()
    for (const key of this.fallbackDials.keys())
      this.cancelFallback(key)
  }
}

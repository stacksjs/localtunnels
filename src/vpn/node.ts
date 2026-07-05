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
}

export interface VpnNodeEvents {
  /** Registered with the coordinator and assigned a tunnel IP. */
  ready: (info: { assignedIp: string, network: string }) => void
  /** An encrypted link to a peer is up. */
  link: (info: { peerPublicKey: string }) => void
  /** An application message arrived from a peer. */
  message: (data: Uint8Array, from: string) => void
  error: (error: Error) => void
}

/**
 * A self-configuring VPN node: joins a network through a {@link VpnCoordinator},
 * discovers other members, and automatically establishes encrypted links to
 * them — no manual key or endpoint exchange.
 *
 * To avoid both sides dialing at once, the node with the lexicographically
 * smaller public key initiates; the other waits for the handshake. The
 * datapath's handshake retransmit absorbs the race where a peer learns of the
 * initiator a moment after the first initiation arrives.
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
  assignedIp: string | null = null

  constructor(options: VpnNodeOptions) {
    super()
    this.keyPair = options.keyPair
    this.coordinatorUrl = options.coordinatorUrl
    this.listenPort = options.listenPort ?? 0
    this.publicKeyB64 = encodeKey(options.keyPair.publicKey)
    this.peer = new VpnPeer({
      keyPair: options.keyPair,
      port: this.listenPort,
      presharedKey: options.presharedKey,
    })
  }

  /** Start the datapath, join the coordinator, and begin auto-linking peers. */
  async start(): Promise<{ assignedIp: string, network: string }> {
    this.peer.on('link', (link) => {
      this.linked.add(link.peerPublicKey)
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
    })
    this.client.on('peers', records => this.onPeers(records))
    // A peer asked us to punch toward it: open our NAT mapping so its handshake
    // (or ours) can traverse.
    this.client.on('punch', (_from, endpoint) => this.peer.punch(endpoint.host, endpoint.port))
    this.client.on('error', err => this.emit('error', err))

    const info = await this.client.connect()
    this.assignedIp = info.assignedIp
    this.emit('ready', info)
    return info
  }

  /** Send an application message to a peer by its base64 public key. */
  send(peerPublicKeyB64: string, data: Uint8Array): void {
    this.peer.send(peerPublicKeyB64, data)
  }

  private onPeers(records: { publicKey: string, endpoint: { host: string, port: number } }[]): void {
    for (const rec of records) {
      this.peer.addPeer({ publicKey: decodeKey(rec.publicKey), endpoint: rec.endpoint })

      const shouldInitiate = this.publicKeyB64 < rec.publicKey
      if (!shouldInitiate || this.linked.has(rec.publicKey) || this.connecting.has(rec.publicKey))
        continue

      this.connecting.add(rec.publicKey)
      // NAT traversal: open our mapping toward the peer and ask it (via the
      // coordinator) to punch back, so its NAT admits our handshake. Then dial.
      this.peer.punch(rec.endpoint.host, rec.endpoint.port)
      this.client?.requestPunch(rec.publicKey)
      this.peer.connect(decodeKey(rec.publicKey), rec.endpoint.host, rec.endpoint.port)
        .catch((err) => {
          this.connecting.delete(rec.publicKey)
          this.emit('error', err instanceof Error ? err : new Error(String(err)))
        })
    }
  }

  stop(): void {
    this.client?.close()
    this.client = null
    this.peer.stop()
    this.linked.clear()
    this.connecting.clear()
  }
}

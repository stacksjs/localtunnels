import type { Server, ServerWebSocket } from 'bun'
import type { ClientMessage, PeerRecord, ServerMessage } from './protocol'
import { parseMessage } from './protocol'

interface ConnData {
  publicKey: string | null
}

interface Registered {
  ws: ServerWebSocket<ConnData>
  publicKey: string
  assignedIp: string
  host: string
  port: number
}

export interface VpnCoordinatorOptions {
  /** TCP port for the WebSocket coordinator. 0 picks an ephemeral port. */
  port?: number
  host?: string
  /** Network to allocate tunnel IPs from. Default 100.100.0.0/16. */
  network?: string
  verbose?: boolean
}

/**
 * The VPN coordination server: a WebSocket endpoint where nodes register their
 * public key + UDP port, receive an assigned tunnel IP, and learn every other
 * node's public key and reflected endpoint. It brokers *discovery* only — all
 * traffic is end-to-end encrypted between peers and never passes through here.
 *
 * Endpoint reflection uses the WebSocket source address (the host as seen by
 * the server) combined with the node's self-reported UDP port. This is correct
 * for LAN / same-NAT / localhost; true cross-NAT hole punching is a later
 * milestone.
 */
export class VpnCoordinator {
  private server: Server<ConnData> | null = null
  private readonly peers = new Map<string, Registered>()
  private readonly bindPort: number
  private readonly bindHost?: string
  private readonly network: string
  private readonly baseIp: number
  private readonly prefix: number
  private nextHost = 2 // reserve .0.0 (network) and .0.1 (gateway)

  constructor(options: VpnCoordinatorOptions = {}) {
    this.bindPort = options.port ?? 0
    this.bindHost = options.host
    this.network = options.network ?? '100.100.0.0/16'
    const [addr, prefixStr] = this.network.split('/')
    this.prefix = Number.parseInt(prefixStr) || 16
    this.baseIp = ipToInt(addr)
  }

  get port(): number {
    if (!this.server)
      throw new Error('coordinator not started')
    return this.server.port ?? 0
  }

  /** Snapshot of currently registered peers. */
  get registeredPeers(): PeerRecord[] {
    return [...this.peers.values()].map(toRecord)
  }

  start(): void {
    if (this.server)
      return
    this.server = Bun.serve<ConnData>({
      port: this.bindPort,
      hostname: this.bindHost,
      fetch: (req, server) => {
        if (server.upgrade(req, { data: { publicKey: null } }))
          return undefined
        return new Response('localtunnels vpn coordinator', { status: 200 })
      },
      websocket: {
        message: (ws, raw) => {
          const msg = parseMessage<ClientMessage>(typeof raw === 'string' ? raw : raw.toString())
          if (!msg)
            return
          this.onMessage(ws, msg)
        },
        close: (ws) => {
          if (ws.data.publicKey) {
            this.peers.delete(ws.data.publicKey)
            this.broadcastPeers()
          }
        },
      },
    })
  }

  stop(): void {
    this.server?.stop(true)
    this.server = null
    this.peers.clear()
  }

  private onMessage(ws: ServerWebSocket<ConnData>, msg: ClientMessage): void {
    switch (msg.t) {
      case 'register': {
        if (!msg.publicKey || typeof msg.listenPort !== 'number') {
          send(ws, { t: 'error', message: 'register requires publicKey and listenPort' })
          return
        }
        const host = ws.remoteAddress || '127.0.0.1'
        const assignedIp = this.assignIp(msg.publicKey)
        ws.data.publicKey = msg.publicKey
        this.peers.set(msg.publicKey, { ws, publicKey: msg.publicKey, assignedIp, host, port: msg.listenPort })
        send(ws, { t: 'registered', assignedIp, network: this.network })
        this.broadcastPeers()
        break
      }
      case 'heartbeat':
        break
    }
  }

  /** Stable per-public-key IP assignment from the pool. */
  private assignIp(publicKey: string): string {
    const existing = this.peers.get(publicKey)
    if (existing)
      return existing.assignedIp
    const hostBits = 32 - this.prefix
    const maxHost = (2 ** hostBits) - 2
    if (this.nextHost > maxHost)
      throw new Error('VPN address pool exhausted')
    const ip = intToIp(this.baseIp + this.nextHost)
    this.nextHost += 1
    return ip
  }

  /** Send each peer the directory of *other* peers. */
  private broadcastPeers(): void {
    for (const target of this.peers.values()) {
      const others = [...this.peers.values()]
        .filter(p => p.publicKey !== target.publicKey)
        .map(toRecord)
      send(target.ws, { t: 'peers', peers: others })
    }
  }
}

function toRecord(p: Registered): PeerRecord {
  return { publicKey: p.publicKey, assignedIp: p.assignedIp, endpoint: { host: p.host, port: p.port } }
}

function send(ws: ServerWebSocket<ConnData>, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg))
}

function ipToInt(ip: string): number {
  const o = ip.split('.').map(Number)
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0
}

function intToIp(n: number): string {
  return `${(n >>> 24) & 0xFF}.${(n >>> 16) & 0xFF}.${(n >>> 8) & 0xFF}.${n & 0xFF}`
}

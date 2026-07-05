import type { PeerRecord, RegisteredMessage, ServerMessage } from './protocol'
import { TypedEventEmitter } from '../types'
import { parseMessage } from './protocol'

export interface VpnCoordinatorClientOptions {
  /** Coordinator WebSocket URL, e.g. ws://coordinator.example:51821 */
  url: string
  /** This node's base64 public key. */
  publicKey: string
  /** UDP port this node's datapath listens on. */
  listenPort: number
  /** Seconds between heartbeats. 0 disables. Default 20. */
  heartbeatInterval?: number
}

export interface VpnCoordinatorClientEvents {
  /** The coordinator accepted registration and assigned a tunnel IP. */
  registered: (info: { assignedIp: string, network: string }) => void
  /** The peer directory changed (excludes this node). */
  peers: (peers: PeerRecord[]) => void
  /** A peer asked us to hole-punch toward it. */
  punch: (from: string, endpoint: { host: string, port: number }) => void
  error: (error: Error) => void
  close: () => void
}

/**
 * Client half of the coordination protocol. Connects to a {@link VpnCoordinator},
 * registers this node, and surfaces the evolving peer directory as events.
 */
export class VpnCoordinatorClient extends TypedEventEmitter<VpnCoordinatorClientEvents> {
  private ws: WebSocket | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private readonly url: string
  private readonly publicKey: string
  private readonly listenPort: number
  private readonly heartbeatInterval: number

  assignedIp: string | null = null
  network: string | null = null

  constructor(options: VpnCoordinatorClientOptions) {
    super()
    this.url = options.url
    this.publicKey = options.publicKey
    this.listenPort = options.listenPort
    this.heartbeatInterval = options.heartbeatInterval ?? 20
  }

  /** Connect and register. Resolves once the coordinator assigns an IP. */
  connect(): Promise<{ assignedIp: string, network: string }> {
    return new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ t: 'register', publicKey: this.publicKey, listenPort: this.listenPort }))
      })

      ws.addEventListener('message', (event) => {
        const msg = parseMessage<ServerMessage>(typeof event.data === 'string' ? event.data : String(event.data))
        if (!msg)
          return
        this.onMessage(msg, (info) => {
          if (!settled) {
            settled = true
            resolve(info)
          }
        })
      })

      ws.addEventListener('error', () => {
        const err = new Error(`coordinator connection error (${this.url})`)
        this.emit('error', err)
        if (!settled) {
          settled = true
          reject(err)
        }
      })

      ws.addEventListener('close', () => {
        if (this.heartbeat) {
          clearInterval(this.heartbeat)
          this.heartbeat = null
        }
        this.emit('close')
        if (!settled) {
          settled = true
          reject(new Error('coordinator closed before registration'))
        }
      })
    })
  }

  private onMessage(msg: ServerMessage, onRegistered: (info: RegisteredMessage) => void): void {
    switch (msg.t) {
      case 'registered':
        this.assignedIp = msg.assignedIp
        this.network = msg.network
        this.emit('registered', { assignedIp: msg.assignedIp, network: msg.network })
        this.startHeartbeat()
        onRegistered(msg)
        break
      case 'peers':
        this.emit('peers', msg.peers)
        break
      case 'punch':
        this.emit('punch', msg.from, msg.endpoint)
        break
      case 'error':
        this.emit('error', new Error(msg.message))
        break
    }
  }

  /** Ask the coordinator to have `targetPublicKey` punch back toward us. */
  requestPunch(targetPublicKey: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ t: 'punch', target: targetPublicKey }))
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval <= 0 || this.heartbeat)
      return
    this.heartbeat = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN)
        this.ws.send(JSON.stringify({ t: 'heartbeat' }))
    }, this.heartbeatInterval * 1000)
  }

  close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    this.ws?.close()
    this.ws = null
  }
}

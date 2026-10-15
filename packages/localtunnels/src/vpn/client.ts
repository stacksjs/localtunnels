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
  /** Shared secret, when the coordinator was started with an auth key. */
  authKey?: string
  /** Advertise this node to the network as an exit node. */
  exitNode?: boolean
  /**
   * Seconds of coordinator silence before the session is called stale.
   *
   * Default three heartbeat intervals — 60 seconds at the default rate. The
   * coordinator drops a silent node at around two minutes, so this has to
   * fire well inside that: the point is to say so while the tunnel still
   * works, not to narrate its death.
   */
  staleAfter?: number
}

export interface VpnCoordinatorClientEvents {
  /** The coordinator accepted registration and assigned a tunnel IP. */
  registered: (info: { assignedIp: string, network: string }) => void
  /** The peer directory changed (excludes this node). */
  peers: (peers: PeerRecord[]) => void
  /** A peer asked us to hole-punch toward it. */
  punch: (from: string, endpoint: { host: string, port: number }) => void
  /** A relayed ciphertext frame arrived from peer `from`. */
  relayFrame: (from: string, frame: Uint8Array) => void
  /**
   * The coordinator has gone quiet, and this node is about to be dropped.
   *
   * The failure this exists for: with the kill switch blocking the
   * coordinator's port, heartbeats piled up unsent, the coordinator dropped
   * the node from the directory, and the exit withdrew the route to its
   * tunnel address. The tunnel then carried traffic one way with the
   * interface up, handshakes succeeding and both ends printing `link up`.
   * Nothing in that sequence reaches the node, because being forgotten is
   * not an event anyone sends you.
   *
   * Emitted once per stall, not once per heartbeat.
   */
  stale: (info: { reason: string, silentForMs: number }) => void
  /** The coordinator started answering again. */
  resumed: (info: { silentForMs: number }) => void
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
  private readonly authKey?: string
  private readonly exitNode: boolean
  private readonly staleAfterMs: number
  /**
   * When the coordinator was last heard from at all.
   *
   * Any frame counts, not just an answered heartbeat: a `peers` update is
   * every bit as much proof that the session is live, and treating it as
   * silence would cry stale on a busy network.
   */
  private lastFrameAt = 0
  /** Whether a stall has already been reported, so it is reported once. */
  private stalled = false
  /** The send queue at the previous heartbeat, to see it growing. */
  private lastBuffered = 0
  /**
   * The last `error` frame the coordinator sent. A rejected registration
   * arrives as an error and *then* a close, so without holding onto the reason
   * the connect promise would reject with a bare "closed before registration".
   */
  private lastServerError: string | null = null

  assignedIp: string | null = null
  network: string | null = null

  constructor(options: VpnCoordinatorClientOptions) {
    super()
    this.url = options.url
    this.publicKey = options.publicKey
    this.listenPort = options.listenPort
    this.heartbeatInterval = options.heartbeatInterval ?? 20
    this.authKey = options.authKey
    this.exitNode = options.exitNode ?? false
    this.staleAfterMs = (options.staleAfter ?? this.heartbeatInterval * 3) * 1000
  }

  /** Connect and register. Resolves once the coordinator assigns an IP. */
  connect(): Promise<{ assignedIp: string, network: string }> {
    return new Promise((resolve, reject) => {
      let settled = false
      this.lastServerError = null
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          t: 'register',
          publicKey: this.publicKey,
          listenPort: this.listenPort,
          ...(this.authKey ? { authKey: this.authKey } : {}),
          ...(this.exitNode ? { exitNode: true } : {}),
        }))
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
          reject(new Error(this.lastServerError
            ? `coordinator rejected registration: ${this.lastServerError}`
            : 'coordinator closed before registration'))
        }
      })
    })
  }

  private onMessage(msg: ServerMessage, onRegistered: (info: RegisteredMessage) => void): void {
    // Before the switch, and for every frame including ones with no case
    // here: this is liveness, and a message we do not understand still
    // proves the coordinator is there and talking to us.
    this.lastFrameAt = Date.now()
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
      case 'relay':
        this.emit('relayFrame', msg.from, new Uint8Array(Buffer.from(msg.data, 'base64')))
        break
      case 'error':
        this.lastServerError = msg.message
        this.emit('error', new Error(msg.message))
        break
      case 'heartbeat':
        // The answer itself carries nothing. Having arrived is the whole
        // content, and `lastFrameAt` above already recorded it.
        break
    }
  }

  /** Ask the coordinator to have `targetPublicKey` punch back toward us. */
  requestPunch(targetPublicKey: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ t: 'punch', target: targetPublicKey }))
  }

  /** Relay an opaque ciphertext frame to a peer through the coordinator. */
  sendRelay(toPublicKey: string, frame: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ t: 'relay', to: toPublicKey, data: Buffer.from(frame).toString('base64') }))
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval <= 0 || this.heartbeat)
      return
    this.lastFrameAt = Date.now()
    this.stalled = false
    this.lastBuffered = 0
    this.heartbeat = setInterval(() => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN)
        return
      ws.send(JSON.stringify({ t: 'heartbeat' }))
      this.checkLiveness(ws)
    }, this.heartbeatInterval * 1000)
  }

  /**
   * Decide whether the coordinator has stopped talking to us.
   *
   * Two symptoms, because they are two different failures and the operator
   * can do something different about each. A send queue that never drains
   * means nothing is leaving this machine — a firewall rule, a dead path —
   * and the fix is local. Silence with an empty queue means our heartbeats
   * left and nothing came back, which is the coordinator's end.
   *
   * `readyState` is no help with either: TCP does not notice a blocked path
   * for a very long time, which is exactly how a node gets dropped while its
   * socket still reads as OPEN.
   */
  private checkLiveness(ws: WebSocket): void {
    const silentForMs = Date.now() - this.lastFrameAt
    const buffered = ws.bufferedAmount ?? 0
    const backingUp = buffered > 0 && buffered >= this.lastBuffered
    this.lastBuffered = buffered

    if (silentForMs < this.staleAfterMs) {
      if (this.stalled) {
        this.stalled = false
        this.emit('resumed', { silentForMs })
      }
      return
    }

    if (this.stalled)
      return
    this.stalled = true
    this.emit('stale', {
      reason: backingUp
        ? 'heartbeats are queued unsent — nothing is leaving this machine'
        : 'the coordinator has not answered',
      silentForMs,
    })
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

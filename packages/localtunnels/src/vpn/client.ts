import type { PeerRecord, RegisteredMessage, ServerMessage } from './protocol'
import { TypedEventEmitter } from '../types'
import { ERROR_UNAUTHORIZED, parseMessage } from './protocol'

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
  /**
   * Come back after the connection drops. Default true.
   *
   * Off is for a caller that wants one attempt and an answer — a probe, a
   * test. For anything holding a tunnel up it should stay on: a node that
   * stops heart-beating is dropped from the directory and the exit withdraws
   * the route to its address, so a connection that is not re-established is
   * a tunnel that is quietly dead rather than one that reports an error.
   */
  reconnect?: boolean
  /**
   * Longest wait between attempts, in milliseconds. Default 15 seconds.
   *
   * The ceiling matters more than the first delay. A coordinator refuses a
   * key still held by a connection it believes in, and releases it once that
   * connection has been silent for three heartbeats — a minute at the
   * default rate. Attempts have to keep arriving across that minute, so a
   * cap of fifteen seconds gives four or five tries inside it rather than
   * one unlucky attempt and a long sleep.
   */
  reconnectMaxMs?: number
  /**
   * The first wait, in milliseconds, which then doubles. Default 1 second.
   *
   * A second because a coordinator that just went away is usually a network
   * that is about to come back, and because the first attempt is the one
   * most likely to be refused for a key the coordinator has not released
   * yet. A parameter so a test can watch the doubling without waiting
   * through it — against the default and any sensible ceiling, the ramp
   * finishes before the ceiling is reached and there is nothing to observe.
   */
  reconnectBaseMs?: number
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
  /**
   * The connection dropped and another attempt is scheduled.
   *
   * Emitted so a window or a screen can say "reconnecting" rather than
   * "connected", which is the state it would otherwise still be showing: the
   * tunnel's own interface stays up throughout, and being dropped from a
   * directory is not something anyone sends you.
   */
  reconnecting: (info: { attempt: number, inMs: number, reason: string }) => void
  /**
   * Reconnection has been abandoned, with the reason it will not help.
   *
   * Only for a refusal that cannot come good — an auth key the coordinator
   * does not accept. Everything else is retried, because everything else is
   * a network that may return.
   */
  gaveUp: (info: { reason: string }) => void
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

  private readonly reconnectEnabled: boolean
  private readonly reconnectMaxMs: number
  private readonly reconnectBaseMs: number
  /** Attempts since the last successful registration, for the backoff. */
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Whether `close()` was called.
   *
   * The difference between a connection that dropped and one that was ended
   * on purpose, which look identical from a `close` event and must not be
   * treated the same: reconnecting after a deliberate shutdown is a client
   * that cannot be stopped.
   */
  private closedByUs = false

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
    this.reconnectEnabled = options.reconnect ?? true
    this.reconnectMaxMs = options.reconnectMaxMs ?? 15_000
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1000
  }

  /**
   * How long before the next attempt.
   *
   * Doubling from a second, capped, with a quarter of jitter either way. The
   * jitter is not decoration: every node on a network loses a coordinator at
   * the same instant, and without it they would all come back in step and
   * keep colliding on the same schedule.
   */
  private backoffMs(): number {
    const doubled = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** this.attempt)
    const jitter = doubled * 0.25
    return Math.round(doubled - jitter + Math.random() * jitter * 2)
  }

  /**
   * Connect and register. Resolves once the coordinator assigns an IP.
   *
   * The promise is about the *first* registration only. Every one after it
   * is a reconnection, reported through `registered` like the first and
   * belonging to no caller's `await`.
   */
  connect(): Promise<{ assignedIp: string, network: string }> {
    this.closedByUs = false
    this.attempt = 0
    return new Promise((resolve, reject) => {
      this.openSocket({ resolve, reject })
    })
  }

  /**
   * Open a socket and register on it.
   *
   * `first` is present only for the attempt a caller is waiting on, which is
   * why its rejection path exists at all: a reconnection has nobody to
   * reject to, and a failed one schedules another attempt instead.
   */
  private openSocket(first?: {
    resolve: (info: { assignedIp: string, network: string }) => void
    reject: (error: Error) => void
  }): void {
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
        // A registration that worked ends the backoff: the next drop
        // starts again from a second rather than from wherever this one
        // climbed to.
        this.attempt = 0
        if (first && !settled) {
          settled = true
          first.resolve(info)
        }
      })
    })

    ws.addEventListener('error', () => {
      const err = new Error(`coordinator connection error (${this.url})`)
      this.emit('error', err)
      if (first && !settled) {
        settled = true
        first.reject(err)
      }
    })

    ws.addEventListener('close', () => {
      if (this.heartbeat) {
        clearInterval(this.heartbeat)
        this.heartbeat = null
      }
      this.emit('close')
      const reason = this.lastServerError
        ? `coordinator rejected registration: ${this.lastServerError}`
        : 'coordinator closed the connection'
      if (first && !settled) {
        settled = true
        first.reject(new Error(this.lastServerError
          ? reason
          : 'coordinator closed before registration'))
      }
      this.scheduleReconnect(reason)
    })
  }

  /**
   * Try again, unless trying again cannot help.
   *
   * An auth key the coordinator does not accept is the one refusal that will
   * not come good, and retrying it forever would loop while hiding the only
   * thing anybody could fix. Everything else is retried — including a key
   * still held by a connection the coordinator believes in, which is the
   * common case after a network change and clears itself once that
   * connection has been silent long enough to be displaced.
   */
  private scheduleReconnect(reason: string): void {
    if (this.closedByUs || !this.reconnectEnabled || this.retryTimer)
      return
    if (this.lastServerError === ERROR_UNAUTHORIZED) {
      this.emit('gaveUp', { reason })
      return
    }

    const inMs = this.backoffMs()
    this.attempt += 1
    this.emit('reconnecting', { attempt: this.attempt, inMs, reason })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.closedByUs)
        return
      this.openSocket()
    }, inMs)
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
    // Set before anything else closes: the `close` listener reads it to tell
    // a deliberate shutdown from a connection that dropped, and those two
    // look identical from the event.
    this.closedByUs = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    this.ws?.close()
    this.ws = null
  }
}

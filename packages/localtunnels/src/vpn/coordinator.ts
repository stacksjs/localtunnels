import type { Server, ServerWebSocket } from 'bun'
import type { ClientMessage, PeerRecord, ServerMessage } from './protocol'
import { createHash, timingSafeEqual } from 'node:crypto'
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
  /** The node advertised itself as an exit node. Relayed, never verified. */
  exitNode: boolean
  /**
   * When this connection last proved it was there.
   *
   * Any frame counts, not just a heartbeat. This is the only thing here that
   * distinguishes a live node from an open socket, and the two are not the
   * same: a client whose network vanished leaves a connection this process
   * still believes in for as long as the kernel does.
   */
  lastSeenAt: number
}

/**
 * How often a node is expected to say something.
 *
 * The client's own default, named here because every window below is derived
 * from it and the two halves have to agree. `vpn/client.ts` sends one every
 * `heartbeatInterval` seconds and calls the coordinator stale after three.
 */
export const HEARTBEAT_SECONDS = 20

/**
 * Silence after which a registration may be taken over by a new connection.
 *
 * Three missed heartbeats, the same count the client uses before it calls
 * *this* side stale — so both ends give up on each other at the same moment
 * rather than at two numbers that drifted apart.
 */
export const STALE_AFTER_MS: number = HEARTBEAT_SECONDS * 3 * 1000

/**
 * Silence after which the socket is closed and the node leaves the directory.
 *
 * Set rather than inherited. This was Bun's default for `idleTimeout`, which
 * happens to be 120 seconds, and the entire eviction behaviour the heartbeat
 * exists to prevent rested on it: the client's 20-second heartbeat and
 * 60-second stale threshold are tuned against this number, and nothing
 * anywhere set it or said so. A Bun release changing the default would move
 * it silently — longer, and a node that is gone stays in the directory while
 * the exit goes on routing to it; shorter than three heartbeats, and live
 * nodes are evicted mid-session.
 */
export const IDLE_TIMEOUT_SECONDS: number = HEARTBEAT_SECONDS * 6

export interface VpnCoordinatorOptions {
  /** TCP port for the WebSocket coordinator. 0 picks an ephemeral port. */
  port?: number
  host?: string
  /** Network to allocate tunnel IPs from. Default 100.100.0.0/16. */
  network?: string
  verbose?: boolean
  /**
   * Shared secret every node must present in its `register` frame to join.
   *
   * Omitting it leaves the coordinator **open**: anyone who can reach the port
   * is handed a tunnel IP and the full peer directory. That is acceptable for
   * tests and single-host demos and nowhere else, so `lt vpn:coordinator`
   * generates a key unless `--insecure-no-auth` is passed.
   */
  authKey?: string
  /**
   * Silence after which a registration may be taken over, in milliseconds.
   *
   * Defaults to {@link STALE_AFTER_MS}, which is the number both halves of
   * the protocol are tuned against. A parameter because sixty seconds is not
   * a thing a test can wait for, and because a deployment whose nodes
   * heartbeat at a different rate needs a window that matches theirs.
   */
  staleAfterMs?: number
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
  private readonly authKey: string | null
  private readonly staleAfterMs: number
  /**
   * publicKey → tunnel IP, retained across disconnects so a node that drops
   * and comes back keeps its address. Without this the pool counter climbs on
   * every reconnect and the "stable per-public-key" promise below is a lie.
   */
  private readonly leases = new Map<string, string>()
  private nextHost = 2 // reserve .0.0 (network) and .0.1 (gateway)

  constructor(options: VpnCoordinatorOptions = {}) {
    this.bindPort = options.port ?? 0
    this.bindHost = options.host
    this.authKey = options.authKey || null
    this.staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS
    this.network = options.network ?? '100.100.0.0/16'
    const [addr, prefixStr] = this.network.split('/')
    this.prefix = Number.parseInt(prefixStr) || 16
    this.baseIp = ipToInt(addr)
  }

  /** Whether this coordinator requires an auth key to join. */
  get requiresAuth(): boolean {
    return this.authKey !== null
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
          /*
           * Only if this socket is still the one holding the key.
           *
           * A displaced connection closing must not delete the registration
           * that replaced it — that would turn a reconnect into a node which
           * registers, is acknowledged, and vanishes from the directory a
           * moment later, which is worse than the refusal it fixed.
           *
           * It cannot happen as the code stands: Bun runs this handler
           * synchronously inside `ws.close()`, so the displaced entry is
           * removed before the new one is installed. That ordering is an
           * implementation detail nothing documents — found by probing, not
           * by reading — and this check is what keeps the result from
           * depending on it.
           */
          if (ws.data.publicKey) {
            const held = this.peers.get(ws.data.publicKey)
            if (held?.ws === ws) {
              this.peers.delete(ws.data.publicKey)
              this.broadcastPeers()
            }
          }
        },
      },
      // See `IDLE_TIMEOUT_SECONDS`: the eviction window is a decision, not
      // whatever the framework currently defaults to.
      idleTimeout: IDLE_TIMEOUT_SECONDS,
    })
  }

  stop(): void {
    this.server?.stop(true)
    this.server = null
    this.peers.clear()
    this.leases.clear()
  }

  /**
   * Constant-time check of a presented auth key.
   *
   * Both sides are hashed to a fixed 32 bytes first, so `timingSafeEqual`
   * cannot throw on a length mismatch and the comparison leaks neither the
   * key's content nor its length.
   */
  private authorized(presented: string | undefined): boolean {
    if (!this.authKey)
      return true
    if (typeof presented !== 'string' || presented.length === 0)
      return false
    const a = createHash('sha256').update(presented).digest()
    const b = createHash('sha256').update(this.authKey).digest()
    return timingSafeEqual(a, b)
  }

  private onMessage(ws: ServerWebSocket<ConnData>, msg: ClientMessage): void {
    /*
     * Proof of life, before anything else and for every frame.
     *
     * A message this coordinator has no case for still shows the connection
     * is there, which is the only question `lastSeenAt` answers. Guarded on
     * the socket still being the one that holds the key, so a displaced
     * connection that keeps talking cannot refresh the liveness of the
     * registration that replaced it.
     */
    const current = ws.data.publicKey ? this.peers.get(ws.data.publicKey) : undefined
    if (current?.ws === ws)
      current.lastSeenAt = Date.now()

    switch (msg.t) {
      case 'register': {
        if (!msg.publicKey || typeof msg.listenPort !== 'number') {
          send(ws, { t: 'error', message: 'register requires publicKey and listenPort' })
          return
        }
        if (!this.authorized(msg.authKey)) {
          send(ws, { t: 'error', message: 'missing or invalid auth key' })
          ws.close(1008, 'unauthorized')
          return
        }
        /*
         * A public key is claimed by at most one *live* connection.
         *
         * Without the claim at all, a second node could register someone
         * else's key and take over its directory record — it still could not
         * decrypt that peer's traffic, which is end-to-end encrypted, but it
         * could draw the relay frames addressed to it and strand the real
         * node.
         *
         * "Live" used to mean `readyState === OPEN`, and that is the one
         * thing that lies in the case this matters for. A client whose
         * network disappeared leaves a socket this process goes on believing
         * in until the kernel gives up, so a node reconnecting — the normal
         * event on a phone, which changes network constantly — was refused
         * its own key for as long as the dead connection lingered. It could
         * not get back into the directory, the exit had already withdrawn its
         * route, and the tunnel was dead for the whole window.
         *
         * So liveness is measured instead of assumed: a registration whose
         * connection has not said anything for three heartbeats is displaced
         * rather than defended. The property that is weakened is narrow — a
         * member holding the auth key can now take over a key whose holder
         * has been silent that long, which is a node whose own watchdog has
         * already fired and which is one idle timeout from eviction anyway.
         */
        const held = this.peers.get(msg.publicKey)
        if (held && held.ws !== ws) {
          const silentForMs = Date.now() - held.lastSeenAt
          if (held.ws.readyState === WebSocket.OPEN && silentForMs < this.staleAfterMs) {
            send(ws, { t: 'error', message: 'public key is already registered by a live connection' })
            ws.close(1008, 'duplicate public key')
            return
          }
          try {
            held.ws.close(1000, 'replaced by a newer connection')
          }
          catch {
            // Already gone, which is the case this branch is mostly for.
          }
        }
        const host = ws.remoteAddress || '127.0.0.1'
        const assignedIp = this.assignIp(msg.publicKey)
        ws.data.publicKey = msg.publicKey
        this.peers.set(msg.publicKey, {
          ws,
          publicKey: msg.publicKey,
          assignedIp,
          host,
          port: msg.listenPort,
          exitNode: msg.exitNode === true,
          lastSeenAt: Date.now(),
        })
        send(ws, { t: 'registered', assignedIp, network: this.network })
        this.broadcastPeers()
        break
      }
      case 'heartbeat':
        /*
         * Answered, not just tolerated.
         *
         * The heartbeat keeps this node in the directory; the answer is how
         * the node learns it is still in it. Without one, a client whose
         * heartbeats never arrive — a kill switch blocking the port, a dead
         * path, a wedged send queue — looks identical to a client whose
         * heartbeats arrive fine, right up until the exit stops routing to
         * it. Silence is only evidence if something was expected.
         */
        send(ws, { t: 'heartbeat' })
        break
      case 'punch': {
        if (!ws.data.publicKey)
          return
        // Relay a punch request: tell `target` to punch back toward the
        // requester, so both open their NAT mappings at about the same time.
        const requester = ws.data.publicKey ? this.peers.get(ws.data.publicKey) : undefined
        const target = this.peers.get(msg.target)
        if (requester && target) {
          send(target.ws, {
            t: 'punch',
            from: requester.publicKey,
            endpoint: { host: requester.host, port: requester.port },
          })
        }
        break
      }
      case 'relay': {
        if (!ws.data.publicKey)
          return
        // Forward an opaque encrypted frame to the target. The coordinator
        // never inspects `data` — it is WireGuard ciphertext.
        const from = ws.data.publicKey
        const target = this.peers.get(msg.to)
        if (from && target)
          send(target.ws, { t: 'relay', from, data: msg.data })
        break
      }
    }
  }

  /** Stable per-public-key IP assignment from the pool. */
  private assignIp(publicKey: string): string {
    const leased = this.leases.get(publicKey)
    if (leased)
      return leased
    const hostBits = 32 - this.prefix
    const maxHost = (2 ** hostBits) - 2
    if (this.nextHost > maxHost)
      throw new Error('VPN address pool exhausted')
    const ip = intToIp(this.baseIp + this.nextHost)
    this.nextHost += 1
    this.leases.set(publicKey, ip)
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
  return {
    publicKey: p.publicKey,
    assignedIp: p.assignedIp,
    endpoint: { host: p.host, port: p.port },
    ...(p.exitNode ? { exitNode: true } : {}),
  }
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

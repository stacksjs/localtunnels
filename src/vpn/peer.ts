import type { VpnKeyPair } from './types'
import { TypedEventEmitter } from '../types'
import { encodeKey, publicKeyFromPrivate } from './keys'
import { Handshake, Session } from './session'

type UdpSocket = Bun.udp.Socket<'buffer'>

/** A remote peer this node is allowed to talk to. */
export interface PeerConfig {
  /** The peer's 32-byte static public key. */
  publicKey: Uint8Array
  /** Optional default endpoint to dial (host + UDP port). */
  endpoint?: { host: string, port: number }
}

/** An established, encrypted link to one peer. */
export interface VpnLink {
  /** The peer's public key, base64-encoded. */
  peerPublicKey: string
  /** Our local session index (the receiver field peers put in our packets). */
  localIndex: number
  /** The peer's session index. */
  peerIndex: number
}

export interface VpnPeerOptions {
  keyPair: VpnKeyPair
  /** UDP port to bind. 0 (default) picks an ephemeral port. */
  port?: number
  /** Host/interface to bind. Defaults to all interfaces. */
  host?: string
  /** Optional preshared key (psk2) applied to every peer. */
  presharedKey?: Uint8Array
  /** Seconds between keepalives on an idle link. 0 disables. Default 15. */
  keepaliveInterval?: number
  /**
   * Seconds before an initiated link re-handshakes for fresh keys (WireGuard's
   * REKEY_AFTER_TIME). Only the side that initiated rekeys. 0 disables.
   * Default 120.
   */
  rekeyAfter?: number
}

export interface VpnPeerEvents {
  /** A link finished its handshake and can carry traffic. */
  link: (link: VpnLink) => void
  /** An application message arrived (padding/keepalives already stripped). */
  message: (data: Uint8Array, from: string) => void
  error: (error: Error) => void
}

interface Pending {
  handshake: Handshake
  peerPublicKey: string
  host: string
  port: number
  localIndex: number
  attempts: number
  timer: ReturnType<typeof setTimeout> | null
  resolve: (link: VpnLink) => void
  reject: (err: Error) => void
  initiation: Uint8Array
}

interface Established {
  session: Session
  peerPublicKey: string
  host: string
  port: number
  keepalive: ReturnType<typeof setInterval> | null
  /** True when this node initiated the handshake (and thus drives rekeys). */
  initiatedByUs: boolean
  rekeyTimer: ReturnType<typeof setTimeout> | null
}

/** Grace period an old session keeps decrypting after a rekey, in ms. */
const REKEY_GRACE_MS = 10_000

const MSG_INITIATION = 1
const MSG_RESPONSE = 2
const MSG_DATA = 4

const HANDSHAKE_RETRIES = 5
const HANDSHAKE_RETRY_MS = 1000
/** 2-byte length prefix framing keeps message boundaries and strips padding. */
const LENGTH_PREFIX = 2
const MAX_MESSAGE = 4094

/**
 * A WireGuard-style VPN node: performs handshakes and exchanges encrypted
 * data with authorized peers over real UDP sockets.
 *
 * This is the userspace datapath — it moves opaque application messages, not
 * yet IP packets from a TUN device (that lands in a later milestone). It is
 * enough to prove the protocol works end-to-end over the wire.
 */
export class VpnPeer extends TypedEventEmitter<VpnPeerEvents> {
  readonly publicKey: Uint8Array
  private readonly privateKey: Uint8Array
  private readonly psk?: Uint8Array
  private readonly bindPort: number
  private readonly bindHost?: string
  private readonly keepaliveInterval: number
  private readonly rekeyAfter: number

  private socket: UdpSocket | null = null
  private readonly allowed = new Map<string, PeerConfig>()
  private readonly pending = new Map<number, Pending>()
  private readonly sessions = new Map<number, Established>()
  /** Newest local session index to send on, per peer public key. */
  private readonly sendIndex = new Map<string, number>()

  constructor(options: VpnPeerOptions) {
    super()
    this.privateKey = options.keyPair.privateKey
    this.publicKey = options.keyPair.publicKey
    this.psk = options.presharedKey
    this.bindPort = options.port ?? 0
    this.bindHost = options.host
    this.keepaliveInterval = options.keepaliveInterval ?? 15
    this.rekeyAfter = options.rekeyAfter ?? 120
  }

  /** The bound UDP port (valid after {@link start}). */
  get port(): number {
    if (!this.socket)
      throw new Error('peer not started')
    return this.socket.port
  }

  /** Register a peer this node is allowed to handshake with. */
  addPeer(peer: PeerConfig): void {
    if (peer.publicKey.length !== 32)
      throw new TypeError('peer public key must be 32 bytes')
    this.allowed.set(encodeKey(peer.publicKey), peer)
  }

  /** Bind the UDP socket and begin accepting handshakes. */
  async start(): Promise<void> {
    if (this.socket)
      return
    this.socket = await Bun.udpSocket({
      port: this.bindPort,
      hostname: this.bindHost,
      socket: {
        data: (_sock, buf, port, addr) => {
          try {
            this.onDatagram(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), addr, port)
          }
          catch (err) {
            this.emit('error', err instanceof Error ? err : new Error(String(err)))
          }
        },
      },
    })
  }

  /**
   * Initiate a handshake toward a known peer and resolve once the encrypted
   * link is up. If `host`/`port` are omitted, the peer's registered endpoint
   * is used.
   */
  connect(peerPublicKey: Uint8Array, host?: string, port?: number): Promise<VpnLink> {
    if (!this.socket)
      throw new Error('peer not started')
    const pubB64 = encodeKey(peerPublicKey)
    const known = this.allowed.get(pubB64)
    const dialHost = host ?? known?.endpoint?.host
    const dialPort = port ?? known?.endpoint?.port
    if (!dialHost || dialPort === undefined)
      throw new Error('no endpoint to dial: pass host/port or register the peer with an endpoint')

    // Ensure the peer is authorized so its response is accepted.
    if (!known)
      this.addPeer({ publicKey: peerPublicKey })

    const localIndex = this.allocIndex()
    const handshake = Handshake.initiator(this.privateKey, peerPublicKey, this.psk)
    const initiation = handshake.createInitiation(localIndex)

    return new Promise<VpnLink>((resolve, reject) => {
      const pending: Pending = {
        handshake,
        peerPublicKey: pubB64,
        host: dialHost,
        port: dialPort,
        localIndex,
        attempts: 0,
        timer: null,
        resolve,
        reject,
        initiation,
      }
      this.pending.set(localIndex, pending)
      this.sendRaw(initiation, dialHost, dialPort)
      this.scheduleRetransmit(pending)
    })
  }

  /** Send an application message to an established peer. */
  send(peerPublicKey: Uint8Array | string, data: Uint8Array): void {
    if (data.length > MAX_MESSAGE)
      throw new RangeError(`message too large (max ${MAX_MESSAGE} bytes)`)
    const pubB64 = typeof peerPublicKey === 'string' ? peerPublicKey : encodeKey(peerPublicKey)
    const link = this.findLinkByPeer(pubB64)
    if (!link)
      throw new Error('no established link to that peer')
    this.sendFramed(link, data)
  }

  /** Tear down the socket and all timers. */
  stop(): void {
    for (const p of this.pending.values()) {
      if (p.timer)
        clearTimeout(p.timer)
      p.handshake.free()
    }
    this.pending.clear()
    for (const e of this.sessions.values()) {
      if (e.keepalive)
        clearInterval(e.keepalive)
      if (e.rekeyTimer)
        clearTimeout(e.rekeyTimer)
      e.session.free()
    }
    this.sessions.clear()
    this.sendIndex.clear()
    this.socket?.close()
    this.socket = null
  }

  // ── internals ──────────────────────────────────────────────────────────

  private onDatagram(buf: Uint8Array, addr: string, port: number): void {
    if (buf.length < 4)
      return
    switch (buf[0]) {
      case MSG_INITIATION:
        this.handleInitiation(buf, addr, port)
        break
      case MSG_RESPONSE:
        this.handleResponse(buf, addr, port)
        break
      case MSG_DATA:
        this.handleData(buf, addr, port)
        break
      default:
        // Unknown/cookie messages are ignored for now.
    }
  }

  private handleInitiation(buf: Uint8Array, addr: string, port: number): void {
    const handshake = Handshake.responder(this.privateKey, this.psk)
    let learnedPub: string
    try {
      const result = handshake.consumeInitiation(buf)
      learnedPub = encodeKey(result.peerPublicKey!)
    }
    catch (err) {
      handshake.free()
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return
    }

    // Cryptokey routing: only respond to peers we have authorized.
    if (!this.allowed.has(learnedPub)) {
      handshake.free()
      this.emit('error', new Error(`rejected handshake from unauthorized peer ${learnedPub}`))
      return
    }

    const localIndex = this.allocIndex()
    let response: Uint8Array
    try {
      response = handshake.createResponse(localIndex)
    }
    catch (err) {
      handshake.free()
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return
    }
    this.sendRaw(response, addr, port)

    const session = handshake.intoSession(localIndex)
    this.establish(localIndex, session, learnedPub, addr, port, false)
  }

  private handleResponse(buf: Uint8Array, addr: string, port: number): void {
    // Response receiver index (our localIndex) sits at bytes 8..12.
    const localIndex = new DataView(buf.buffer, buf.byteOffset).getUint32(8, true)
    const pending = this.pending.get(localIndex)
    if (!pending)
      return

    try {
      pending.handshake.consumeResponse(buf)
    }
    catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return
    }

    if (pending.timer)
      clearTimeout(pending.timer)
    this.pending.delete(localIndex)

    const peerIndex = pending.handshake.peerIndex()
    const session = pending.handshake.intoSession(localIndex)
    const link = this.establish(localIndex, session, pending.peerPublicKey, pending.host, pending.port, true)
    pending.resolve({ ...link, peerIndex })
  }

  private handleData(buf: Uint8Array, addr: string, port: number): void {
    // Data receiver index (our localIndex) sits at bytes 4..8.
    const localIndex = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true)
    const established = this.sessions.get(localIndex)
    if (!established)
      return

    let plain: Uint8Array
    try {
      plain = established.session.decrypt(buf)
    }
    catch (err) {
      // Replay/tamper/decrypt failures are dropped, not fatal.
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return
    }

    // Roaming: remember the source we last authenticated a packet from.
    established.host = addr
    established.port = port

    if (plain.length < LENGTH_PREFIX)
      return // malformed
    const len = new DataView(plain.buffer, plain.byteOffset).getUint16(0, true)
    if (len === 0)
      return // keepalive
    if (LENGTH_PREFIX + len > plain.length)
      return // malformed
    const message = plain.slice(LENGTH_PREFIX, LENGTH_PREFIX + len)
    this.emit('message', message, established.peerPublicKey)
  }

  private establish(localIndex: number, session: Session, peerPublicKey: string, host: string, port: number, initiatedByUs: boolean): VpnLink {
    const collision = this.sessions.get(localIndex)
    if (collision) {
      this.retireSession(localIndex, 0)
    }

    const established: Established = { session, peerPublicKey, host, port, keepalive: null, initiatedByUs, rekeyTimer: null }
    if (this.keepaliveInterval > 0) {
      established.keepalive = setInterval(() => {
        try {
          this.sendFramed(established, new Uint8Array(0))
        }
        catch {
          // link torn down mid-interval; ignore
        }
      }, this.keepaliveInterval * 1000)
    }
    this.sessions.set(localIndex, established)

    // New traffic to this peer goes on the newest session. Any prior session
    // keeps decrypting briefly (in-flight packets) before being retired.
    const priorIndex = this.sendIndex.get(peerPublicKey)
    this.sendIndex.set(peerPublicKey, localIndex)
    if (priorIndex !== undefined && priorIndex !== localIndex)
      this.retireSession(priorIndex, REKEY_GRACE_MS)

    // The initiator schedules the next rekey.
    if (initiatedByUs && this.rekeyAfter > 0) {
      established.rekeyTimer = setTimeout(() => this.rekey(peerPublicKey), this.rekeyAfter * 1000)
    }

    const link: VpnLink = {
      peerPublicKey,
      localIndex,
      peerIndex: session.peerIndex,
    }
    this.emit('link', link)
    return link
  }

  /** Free a session now (grace 0) or after a grace period. */
  private retireSession(localIndex: number, graceMs: number): void {
    const e = this.sessions.get(localIndex)
    if (!e)
      return
    if (e.keepalive) {
      clearInterval(e.keepalive)
      e.keepalive = null
    }
    if (e.rekeyTimer) {
      clearTimeout(e.rekeyTimer)
      e.rekeyTimer = null
    }
    const free = () => {
      const cur = this.sessions.get(localIndex)
      if (cur === e) {
        this.sessions.delete(localIndex)
        e.session.free()
      }
    }
    if (graceMs <= 0)
      free()
    else
      setTimeout(free, graceMs)
  }

  /** Re-initiate the handshake with a peer to install fresh transport keys. */
  private rekey(peerPublicKey: string): void {
    const current = this.sendIndex.get(peerPublicKey)
    const link = current !== undefined ? this.sessions.get(current) : undefined
    const cfg = this.allowed.get(peerPublicKey)
    if (!link || !cfg)
      return
    this.connect(cfg.publicKey, link.host, link.port).catch((err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    })
  }

  private sendFramed(link: Established, data: Uint8Array): void {
    const framed = new Uint8Array(LENGTH_PREFIX + data.length)
    new DataView(framed.buffer).setUint16(0, data.length, true)
    framed.set(data, LENGTH_PREFIX)
    const wire = link.session.encrypt(framed)
    this.sendRaw(wire, link.host, link.port)
  }

  private scheduleRetransmit(pending: Pending): void {
    pending.timer = setTimeout(() => {
      if (!this.pending.has(pending.localIndex))
        return
      pending.attempts += 1
      if (pending.attempts >= HANDSHAKE_RETRIES) {
        this.pending.delete(pending.localIndex)
        pending.handshake.free()
        pending.reject(new Error(`handshake with ${pending.peerPublicKey} timed out after ${HANDSHAKE_RETRIES} attempts`))
        return
      }
      this.sendRaw(pending.initiation, pending.host, pending.port)
      this.scheduleRetransmit(pending)
    }, HANDSHAKE_RETRY_MS)
  }

  private findLinkByPeer(pubB64: string): Established | undefined {
    const idx = this.sendIndex.get(pubB64)
    if (idx !== undefined) {
      const e = this.sessions.get(idx)
      if (e)
        return e
    }
    // Fall back to any surviving session for the peer.
    for (const e of this.sessions.values()) {
      if (e.peerPublicKey === pubB64)
        return e
    }
    return undefined
  }

  private sendRaw(data: Uint8Array, host: string, port: number): void {
    this.socket?.send(data, port, host)
  }

  private allocIndex(): number {
    const buf = new Uint32Array(1)
    do {
      crypto.getRandomValues(buf)
    } while (buf[0] === 0 || this.sessions.has(buf[0]) || this.pending.has(buf[0]))
    return buf[0]
  }
}

/** Convenience: derive a peer's public key from its private key. */
export function peerPublicKey(privateKey: Uint8Array): Uint8Array {
  return publicKeyFromPrivate(privateKey)
}

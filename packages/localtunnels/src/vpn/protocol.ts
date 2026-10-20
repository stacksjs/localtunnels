/**
 * Coordination protocol between VPN nodes and the coordinator, carried as JSON
 * over the existing WebSocket transport. The coordinator only ever sees public
 * keys and endpoints — never traffic — so it is untrusted for confidentiality.
 */

/** A UDP endpoint a peer can be reached at. */
export interface Endpoint {
  host: string
  port: number
}

/** A peer as advertised by the coordinator to others in the network. */
export interface PeerRecord {
  /** base64 static public key */
  publicKey: string
  /** tunnel IP assigned by the coordinator */
  assignedIp: string
  /** reflected UDP endpoint (server-observed host + peer-reported port) */
  endpoint: Endpoint
  /**
   * This peer offers to carry traffic for the whole internet — it has IP
   * forwarding and NAT set up and will egress on its own public address.
   *
   * It is a *claim*, not a credential. The coordinator relays what a node says
   * about itself and cannot check it, so any member holding the auth key can
   * advertise this. A client that routes everything through a peer it did not
   * choose deliberately is trusting whoever that peer turns out to be; pin the
   * public key rather than taking whatever is offered.
   */
  exitNode?: boolean
}

// ── client → coordinator ─────────────────────────────────────────────────────

export interface RegisterMessage {
  t: 'register'
  publicKey: string
  /** UDP port this node listens on for the datapath */
  listenPort: number
  /** Advertise this node as an exit node. See {@link PeerRecord.exitNode}. */
  exitNode?: boolean
  /**
   * Shared secret proving this node is allowed to join. Required when the
   * coordinator was started with an auth key; ignored when it was not.
   */
  authKey?: string
}

export interface HeartbeatMessage {
  t: 'heartbeat'
}

/** Ask the coordinator to tell `target` to punch back toward us. */
export interface PunchRequestMessage {
  t: 'punch'
  target: string
}

/** Relay an opaque encrypted frame to `to` (coordinator can't read `data`). */
export interface RelayMessage {
  t: 'relay'
  to: string
  /** base64-encoded ciphertext frame */
  data: string
}

export type ClientMessage = RegisterMessage | HeartbeatMessage | PunchRequestMessage | RelayMessage

// ── coordinator → client ─────────────────────────────────────────────────────

export interface RegisteredMessage {
  t: 'registered'
  assignedIp: string
  /** network CIDR, e.g. "100.100.0.0/16" */
  network: string
}

export interface PeersMessage {
  t: 'peers'
  peers: PeerRecord[]
}

export interface ErrorMessage {
  t: 'error'
  message: string
}

/**
 * The two refusals a client has to tell apart, spelled once.
 *
 * There are no error codes in this protocol, so a client deciding whether to
 * try again is reading English the server wrote — and the two answers could
 * not be more different. A key held by a live connection becomes available
 * on its own, after the holder has been silent long enough to be displaced,
 * so retrying is exactly right. A rejected auth key will never become
 * correct by being presented again, and a client that retries it forever
 * loops instead of reporting the one thing somebody could fix.
 *
 * Here rather than in either implementation because both have to agree on
 * the wording, and a message reworded on the server would otherwise turn a
 * fatal error into an infinite retry with nothing failing anywhere.
 */
export const ERROR_UNAUTHORIZED = 'missing or invalid auth key'
export const ERROR_DUPLICATE_KEY = 'public key is already registered by a live connection'

/** Tells a node to hole-punch toward `from` at `endpoint` (simultaneous open). */
export interface PunchSignalMessage {
  t: 'punch'
  from: string
  endpoint: Endpoint
}

/**
 * The coordinator's answer to a heartbeat, and the only thing that proves a
 * session is still live.
 *
 * A node that stops heartbeating is dropped from the directory, and the exit
 * node then withdraws the route to its tunnel address. Nothing about that
 * reaches the dropped node: its WebSocket is still `OPEN`, its handshakes
 * still succeed, and its interface is still up, so it goes on reporting a
 * healthy tunnel that carries traffic one way. An answer the client can miss
 * is what makes the silence observable.
 *
 * An echo rather than a new verb, because the two message unions are
 * directional and this is a pong. A client built before this ignores it:
 * `parseMessage` keeps it and the switch has no case for it.
 */
export interface HeartbeatAckMessage {
  t: 'heartbeat'
}

/** A relayed frame delivered from peer `from`. */
export interface RelayDeliveryMessage {
  t: 'relay'
  from: string
  data: string
}

export type ServerMessage = RegisteredMessage | PeersMessage | ErrorMessage | PunchSignalMessage | RelayDeliveryMessage | HeartbeatAckMessage

/** Parse a JSON frame into a known message, or return null if malformed. */
export function parseMessage<T>(raw: string): T | null {
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj.t === 'string')
      return obj as T
    return null
  }
  catch {
    return null
  }
}

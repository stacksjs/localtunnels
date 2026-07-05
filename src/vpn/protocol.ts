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
}

// ── client → coordinator ─────────────────────────────────────────────────────

export interface RegisterMessage {
  t: 'register'
  publicKey: string
  /** UDP port this node listens on for the datapath */
  listenPort: number
}

export interface HeartbeatMessage {
  t: 'heartbeat'
}

export type ClientMessage = RegisterMessage | HeartbeatMessage

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

export type ServerMessage = RegisteredMessage | PeersMessage | ErrorMessage

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

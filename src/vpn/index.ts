/**
 * localtunnels VPN — WireGuard-style encrypted L3 networking.
 *
 * This module exposes the control-plane surface for the native `libltvpn`
 * core (a Zig implementation of the WireGuard v1 protocol). The datapath
 * (TUN devices, UDP transport, session lifecycle) lands in later milestones;
 * what ships today is key management and the handshake/transport primitives.
 *
 * See https://github.com/stacksjs/localtunnels/issues/28 for the roadmap.
 */
export {
  EXPECTED_ABI_VERSION,
  errorName,
  isVpnAvailable,
  loadNative,
  VpnUnavailableError,
} from './ffi'

export {
  decodeKey,
  encodeKey,
  generateKeyPair,
  publicKeyFromPrivate,
} from './keys'

export {
  Handshake,
  Session,
  VpnProtocolError,
} from './session'

export {
  peerPublicKey,
  VpnPeer,
} from './peer'

export type {
  PeerConfig,
  VpnLink,
  VpnPeerEvents,
  VpnPeerOptions,
} from './peer'

export type {
  HandshakeResult,
  VpnKeyPair,
} from './types'

export {
  HANDSHAKE_INITIATION_LEN,
  HANDSHAKE_RESPONSE_LEN,
  TRANSPORT_OVERHEAD,
} from './types'

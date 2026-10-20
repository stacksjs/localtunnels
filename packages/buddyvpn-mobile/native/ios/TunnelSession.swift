//
//  The data path: packets in one end, ciphertext out the other.
//
//  This is the half of a tunnel that does not depend on how the peer was
//  found. Given a session — which is to say, given keys that have already
//  been agreed — it moves packets, and it is the same work whether the peer
//  came from a coordinator, a static configuration or a test.
//
//  What it does *not* do is find the peer. See `PacketTunnelProvider` for
//  why that is still missing and what it needs.
//
//  ── The two directions ─────────────────────────────────────────────────
//
//  Out   `packetFlow.readPackets` hands over IP packets the system wants
//        sent. Each is encrypted with `ltvpn_session_encrypt` and written to
//        the UDP connection as one datagram.
//  In    each datagram from the exit is decrypted with
//        `ltvpn_session_decrypt` and written back to `packetFlow`, which
//        puts it into the system's stack as though it had arrived on a wire.
//
//  Both loops re-arm themselves and stop only when `stop()` is called or the
//  connection fails. Neither throws on a bad packet: a datagram that does not
//  decrypt is noise, a replay or a truncated send, and dropping one is what
//  every transport here does. Taking the tunnel down for it would hand
//  anyone who can reach the port a way to end the session.
//
//  ── Padding ─────────────────────────────────────────────────
//
//  The transport pads every plaintext up to a 16-byte boundary before
//  sealing it, so what `ltvpn_session_decrypt` returns is almost never the
//  length of the packet inside it. The real length is in the IP header, and
//  `packetLength` below reads it — the same recovery the desktop does in
//  `vpn/peer.ts`, because a padded packet handed to `writePackets` is not
//  the packet that was sent. A zero-length plaintext is a keepalive.
//
import Foundation
import Network
import NetworkExtension
import os

final class TunnelSession {
    /// How much plaintext one packet may carry, fixed by the transport.
    static let maxPacket = Int(LTVPN_MAX_PLAINTEXT_LEN)

    private let log = Logger(subsystem: "org.localtunnels.buddyvpn", category: "tunnel-session")
    private let flow: NEPacketTunnelFlow
    private let connection: NWConnection
    /// Owned by this object: freed in `stop()`, never before.
    private var session: OpaquePointer?
    private var running = false

    /// `session` is taken over by this object, including freeing it.
    init(flow: NEPacketTunnelFlow, connection: NWConnection, session: OpaquePointer) {
        self.flow = flow
        self.connection = connection
        self.session = session
    }

    func start() {
        guard !running else { return }
        running = true
        readFromTunnel()
        readFromExit()
    }

    func stop() {
        guard running else { return }
        running = false
        connection.cancel()
        if let session {
            // After the loops have stopped, never during: both of them hold
            // this pointer, and freeing it under a read in flight is a use
            // after free in the one place a crash takes the VPN down.
            ltvpn_session_free(session)
            self.session = nil
        }
    }

    // MARK: Out — the system's packets, encrypted and sent

    private func readFromTunnel() {
        flow.readPackets { [weak self] packets, _ in
            guard let self, self.running else { return }
            for packet in packets {
                self.send(packet)
            }
            // Re-arm. `readPackets` is one-shot: it hands over whatever has
            // accumulated and must be asked again, or the tunnel goes quiet
            // after a single batch.
            self.readFromTunnel()
        }
    }

    private func send(_ packet: Data) {
        guard let session, packet.count <= Self.maxPacket else {
            // Larger than the transport carries. The MTU set on the tunnel is
            // what stops this happening; a packet that arrives anyway is
            // dropped rather than truncated into something undecryptable.
            log.error("dropping a \(packet.count)-byte packet, over the \(Self.maxPacket) limit")
            return
        }

        let capacity = ltvpn_encrypted_len(packet.count)
        guard capacity > 0 else { return }
        var out = [UInt8](repeating: 0, count: capacity)

        let written = packet.withUnsafeBytes { plain in
            ltvpn_session_encrypt(
                session,
                plain.bindMemory(to: UInt8.self).baseAddress,
                packet.count,
                &out,
                capacity
            )
        }
        guard written > 0 else {
            log.error("encrypt refused a packet: \(written)")
            return
        }

        connection.send(
            content: Data(out.prefix(Int(written))),
            completion: .contentProcessed { [weak self] error in
                if let error {
                    self?.log.error("the exit did not take a packet: \(error.localizedDescription, privacy: .public)")
                }
            }
        )
    }

    // MARK: In — the exit's datagrams, decrypted and delivered

    private func readFromExit() {
        connection.receiveMessage { [weak self] data, _, _, error in
            guard let self, self.running else { return }
            if let error {
                self.log.error("the exit stopped answering: \(error.localizedDescription, privacy: .public)")
                return
            }
            if let data, !data.isEmpty {
                self.deliver(data)
            }
            self.readFromExit()
        }
    }

    private func deliver(_ datagram: Data) {
        guard let session else { return }
        var out = [UInt8](repeating: 0, count: Self.maxPacket)

        let written = datagram.withUnsafeBytes { cipher in
            ltvpn_session_decrypt(
                session,
                cipher.bindMemory(to: UInt8.self).baseAddress,
                datagram.count,
                &out,
                Self.maxPacket
            )
        }
        guard written > 0 else {
            // Noise, a replay, a truncated send, or a keepalive, which
            // carries a zero-length plaintext. Dropping it is the whole
            // response: tearing the tunnel down would let anyone who can
            // reach this port end the session.
            return
        }

        let padded = out.prefix(Int(written))
        /*
         * Back to the packet's own length.
         *
         * `written` counts the padding the transport added, so these bytes
         * are an IP packet followed by up to fifteen zeroes. iOS does not
         * refuse that: `writePackets` takes it and the stack reads the
         * header's length anyway, which is what makes the mistake expensive.
         * It is the transport layer that then reads too far — a UDP datagram
         * arrives longer than it was sent, with zeroes appended — so DNS and
         * QUIC break while ping and TCP look perfectly healthy.
         */
        let length = Self.packetLength(padded)
        guard length > 0, length <= padded.count else {
            // A plaintext with no readable IP header. Not ours to interpret,
            // and not something to pass on as though it were a packet.
            return
        }

        let packet = Data(padded.prefix(length))
        // The address family the packet actually carries. Telling the system
        // IPv4 about an IPv6 packet does not fail — it delivers it to the
        // wrong stack, where it is dropped silently much later.
        let family = (packet.first.map { $0 >> 4 } == 6)
            ? AF_INET6
            : AF_INET
        flow.writePackets([packet], withProtocols: [NSNumber(value: family)])
    }

    /**
     The length an IP packet declares for itself, or 0 if it declares none.

     The same two header reads as `ipPacketLength` in `vpn/routing.ts`, and
     they have to stay the same: both ends of this tunnel recover a length by
     this rule, and an end that disagrees delivers padding into somebody's
     payload.
     */
    static func packetLength(_ packet: ArraySlice<UInt8>) -> Int {
        let bytes = Array(packet)
        guard let first = bytes.first else { return 0 }
        switch first >> 4 {
        case 4 where bytes.count >= 20:
            // IPv4 total length, its own header included: bytes 2..4, big-endian.
            return Int(bytes[2]) << 8 | Int(bytes[3])
        case 6 where bytes.count >= 40:
            // IPv6 has a fixed 40-byte header and counts only what follows it.
            return 40 + (Int(bytes[4]) << 8 | Int(bytes[5]))
        default:
            return 0
        }
    }
}

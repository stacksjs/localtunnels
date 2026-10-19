//
//  Joining the network: the half that finds the peer.
//
//  `TunnelSession` moves packets once there is a session. This is what has
//  to happen first. A node cannot encrypt anything until it knows three
//  things it cannot work out alone — an address of its own that the exit
//  will route to, the exit's public key, and where the exit is reachable —
//  and all three come from the coordinator.
//
//  The protocol is JSON over a WebSocket, and it is defined in
//  `packages/localtunnels/src/vpn/protocol.ts`. That file is the contract;
//  this is a second implementation of it, so every message name and field
//  below has to match it exactly. A phone that spells `publicKey` differently
//  does not fail loudly — it is simply never registered.
//
//  ── Being forgotten ───────────────────────────────────────────────────
//
//  A node that stops heart-beating is dropped from the directory, and the
//  exit then withdraws the route to its address. Nothing about that reaches
//  the dropped node: the socket stays open, the handshakes still succeed, and
//  traffic goes one way while everything reports health. So the coordinator
//  answers every heartbeat, and silence is treated as a symptom — the same
//  rule the TypeScript client follows, for the same reason.
//
//  One half of that rule does not survive the move. The TypeScript client
//  also watches its send queue, which separates "nothing is leaving this
//  machine" from "the coordinator has gone away"; `URLSessionWebSocketTask`
//  exposes no such thing, so this reports the silence without the cause.
//
import Foundation
import os

/// A peer as the coordinator advertises it.
struct CoordinatorPeer: Decodable {
    struct Endpoint: Decodable {
        let host: String
        let port: Int
    }

    /// base64 static public key.
    let publicKey: String
    /// The tunnel address the coordinator assigned this peer.
    let assignedIp: String
    let endpoint: Endpoint
    /**
     This peer offers to carry traffic for the whole internet.

     A claim, not a credential. The coordinator relays what a node says about
     itself and cannot check it, so anyone holding the auth key can advertise
     it. Choosing an exit by this alone is trusting whoever turns out to be
     behind it.
     */
    let exitNode: Bool?
}

/// What registration settles.
struct CoordinatorRegistration {
    /// This node's tunnel address.
    let assignedIp: String
    /// The network it belongs to, as a CIDR.
    let network: String
}

enum CoordinatorFailure: LocalizedError {
    case rejected(String)
    case closedBeforeRegistering
    case badURL(String)

    var errorDescription: String? {
        switch self {
        case let .rejected(reason):
            return "The coordinator refused this device: \(reason)"
        case .closedBeforeRegistering:
            return "The coordinator closed the connection before registering this device."
        case let .badURL(url):
            return "\(url) is not a usable coordinator address."
        }
    }
}

final class CoordinatorClient {
    /// Seconds between heartbeats. The coordinator drops a silent node at
    /// around two minutes, so this has room to miss several.
    private let heartbeatInterval: TimeInterval
    /// Seconds of silence before the session is called stale. Three
    /// heartbeats by default, well inside the coordinator's patience: the
    /// point is to say so while the tunnel still works.
    private let staleAfter: TimeInterval

    private let log = Logger(subsystem: "org.localtunnels.buddyvpn", category: "coordinator")
    private let url: URL
    private let publicKey: String
    private let listenPort: Int
    private let authKey: String?

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var heartbeat: DispatchSourceTimer?
    /// When the coordinator was last heard from at all. Any frame counts: a
    /// directory update is as much proof of life as an answered heartbeat,
    /// and counting only answers would cry stale on a busy network.
    private var lastFrameAt = Date()
    /// Whether a stall has already been reported, so it is reported once.
    private var stalled = false
    /// The last `error` frame. A rejected registration arrives as an error
    /// and *then* a close, so without holding the reason the failure would be
    /// a bare "closed before registering".
    private var lastServerError: String?
    private var registration: ((Result<CoordinatorRegistration, Error>) -> Void)?
    private var finished = false

    /// The directory changed. Carries every peer, not a delta, so a listener
    /// reconciles by replacing its copy — which is what dropping routes for
    /// peers that have left requires.
    var onPeers: (([CoordinatorPeer]) -> Void)?
    /// The coordinator has gone quiet and this node is about to be dropped.
    var onStale: ((TimeInterval) -> Void)?
    /// It is answering again.
    var onResumed: ((TimeInterval) -> Void)?

    init(url: String,
         publicKey: String,
         listenPort: Int,
         authKey: String? = nil,
         heartbeatInterval: TimeInterval = 20,
         staleAfter: TimeInterval? = nil) throws {
        guard let parsed = URL(string: url), parsed.scheme == "ws" || parsed.scheme == "wss" else {
            throw CoordinatorFailure.badURL(url)
        }
        self.url = parsed
        self.publicKey = publicKey
        self.listenPort = listenPort
        self.authKey = authKey
        self.heartbeatInterval = heartbeatInterval
        self.staleAfter = staleAfter ?? heartbeatInterval * 3
    }

    /// Connect and register. The completion runs once, either way.
    func connect(completion: @escaping (Result<CoordinatorRegistration, Error>) -> Void) {
        registration = completion
        let session = URLSession(configuration: .ephemeral)
        self.session = session
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()

        send([
            "t": "register",
            "publicKey": publicKey,
            "listenPort": listenPort,
            // Omitted rather than sent empty: the coordinator checks presence.
        ].merging(authKey.map { ["authKey": $0] } ?? [:]) { current, _ in current })

        receive()
    }

    func close() {
        finish(with: .failure(CoordinatorFailure.closedBeforeRegistering))
        heartbeat?.cancel()
        heartbeat = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }

    // MARK: Sending

    private func send(_ message: [String: Any]) {
        guard let task, let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8)
        else { return }
        task.send(.string(text)) { [weak self] error in
            if let error {
                self?.log.error("could not reach the coordinator: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    // MARK: Receiving

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(message):
                self.handle(message)
                // Re-arm: `receive` delivers one message and must be asked
                // again, or the directory stops arriving after the first.
                self.receive()
            case let .failure(error):
                self.log.error("the coordinator connection ended: \(error.localizedDescription, privacy: .public)")
                self.finish(with: .failure(self.lastServerError.map { CoordinatorFailure.rejected($0) }
                    ?? CoordinatorFailure.closedBeforeRegistering))
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let text: String
        switch message {
        case let .string(value):
            text = value
        case let .data(value):
            text = String(decoding: value, as: UTF8.self)
        @unknown default:
            return
        }

        guard let data = text.data(using: .utf8),
              let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = frame["t"] as? String
        else { return }

        // Before anything else, and for every frame including ones with no
        // case here: an unrecognised message still proves the coordinator is
        // there and talking to us.
        lastFrameAt = Date()

        switch type {
        case "registered":
            guard let assignedIp = frame["assignedIp"] as? String,
                  let network = frame["network"] as? String
            else { return }
            log.notice("registered as \(assignedIp, privacy: .public) on \(network, privacy: .public)")
            startHeartbeat()
            finish(with: .success(CoordinatorRegistration(assignedIp: assignedIp, network: network)))
        case "peers":
            guard let raw = frame["peers"],
                  let encoded = try? JSONSerialization.data(withJSONObject: raw),
                  let peers = try? JSONDecoder().decode([CoordinatorPeer].self, from: encoded)
            else { return }
            onPeers?(peers)
        case "error":
            let reason = frame["message"] as? String ?? "no reason given"
            lastServerError = reason
            log.error("the coordinator refused something: \(reason, privacy: .public)")
        case "heartbeat":
            // The answer carries nothing. Having arrived is the whole
            // content, and `lastFrameAt` above already recorded it.
            break
        default:
            break
        }
    }

    /// Run the registration completion exactly once.
    private func finish(with result: Result<CoordinatorRegistration, Error>) {
        guard !finished, let completion = registration else { return }
        finished = true
        registration = nil
        completion(result)
    }

    // MARK: Staying in the directory

    private func startHeartbeat() {
        guard heartbeat == nil else { return }
        lastFrameAt = Date()
        stalled = false

        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now() + heartbeatInterval, repeating: heartbeatInterval)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.send(["t": "heartbeat"])
            self.checkLiveness()
        }
        timer.resume()
        heartbeat = timer
    }

    /**
     Decide whether the coordinator has stopped talking to us.

     The socket is no help: TCP does not notice a blocked path for a very
     long time, which is exactly how a node gets dropped while its connection
     still reads as healthy. Only the silence says so.
     */
    private func checkLiveness() {
        let silent = Date().timeIntervalSince(lastFrameAt)
        if silent < staleAfter {
            if stalled {
                stalled = false
                onResumed?(silent)
            }
            return
        }
        guard !stalled else { return }
        stalled = true
        log.error("the coordinator has not answered for \(Int(silent))s; this node is about to be dropped")
        onStale?(silent)
    }
}

extension Array where Element == CoordinatorPeer {
    /**
     The exit to use, chosen the same way the TypeScript client chooses it:
     the lexicographically smallest public key among the peers advertising
     themselves as exits.

     Matching that rule matters more than the rule itself. A phone and a
     desktop on one network that disagree about which exit is "the" exit send
     their traffic to different places, and nothing anywhere reports a
     problem.
     */
    var exit: CoordinatorPeer? {
        filter { $0.exitNode == true }
            .sorted { $0.publicKey < $1.publicKey }
            .first
    }
}

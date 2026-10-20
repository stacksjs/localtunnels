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
//  ── Coming back ────────────────────────────────────────────────
//
//  A phone loses this connection constantly: Wi-Fi to cellular, a handover,
//  a few minutes backgrounded. A node that stops heart-beating is dropped
//  and the exit withdraws its route, so a drop that is not re-established is
//  a tunnel that is dead rather than one that reports an error.
//
//  The policy is `vpn/client.ts`'s, deliberately, and the numbers are the
//  same: retry forever, from a second, doubling to fifteen, with a quarter
//  of jitter so every phone on one network does not come back in step. One
//  refusal is fatal — an auth key the coordinator does not accept, which
//  will not become correct by being presented again. A key still held by the
//  connection this phone just lost is retried, because that is the ordinary
//  case here and it clears itself once the coordinator stops hearing from
//  the socket it still believes in.
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

/**
 The two refusals a client has to tell apart.

 Spelled in `vpn/protocol.ts` and repeated here, because this protocol has
 no error codes and a client deciding whether to try again is reading
 English the coordinator wrote. `coordinator-contract.test.ts` checks the
 wording matches: reworded on the server, a fatal error becomes an infinite
 retry with nothing failing anywhere.
 */
enum CoordinatorError {
    static let unauthorized = "missing or invalid auth key"
    static let duplicateKey = "public key is already registered by a live connection"
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

    /// The first wait, which then doubles. `vpn/client.ts`'s numbers.
    private let reconnectBase: TimeInterval = 1
    private let reconnectMax: TimeInterval = 15
    /// Attempts since the last registration that worked, for the backoff.
    private var attempt = 0
    private var retry: DispatchWorkItem?
    /**
     Whether `close()` was called.

     A connection that dropped and one ended on purpose are the same event
     here, and must not be the same outcome: reconnecting after a deliberate
     stop is a client that cannot be stopped.
     */
    private var closedByUs = false

    /// The directory changed. Carries every peer, not a delta, so a listener
    /// reconciles by replacing its copy — which is what dropping routes for
    /// peers that have left requires.
    var onPeers: (([CoordinatorPeer]) -> Void)?
    /// The coordinator has gone quiet and this node is about to be dropped.
    var onStale: ((TimeInterval) -> Void)?
    /// It is answering again.
    var onResumed: ((TimeInterval) -> Void)?
    /**
     The connection dropped and another attempt is scheduled.

     Reported so the tunnel can say so rather than going on claiming it is
     connected: the interface stays up throughout, and being dropped from a
     directory is not an event anyone sends you.
     */
    var onReconnecting: ((_ attempt: Int, _ delay: TimeInterval) -> Void)?
    /// Reconnection has been abandoned, with the reason it cannot help.
    var onGaveUp: ((String) -> Void)?

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

    /**
     Connect and register. The completion runs once, either way.

     Once: it is about the *first* registration. Every one after it is a
     reconnection and belongs to no caller — `onPeers` and the logs are how
     those are seen.
     */
    func connect(completion: @escaping (Result<CoordinatorRegistration, Error>) -> Void) {
        registration = completion
        closedByUs = false
        attempt = 0
        openSocket()
    }

    /// Open a socket and register on it. Used by `connect` and by each retry.
    private func openSocket() {
        /*
         * Cleared per attempt.
         *
         * `lastServerError` is what decides whether a drop is worth
         * retrying, so one left over from an earlier attempt would make a
         * later, unrelated disconnection look fatal — or, the other way
         * round, let a rejected auth key be retried because the next attempt
         * failed before the coordinator could say so again.
         */
        lastServerError = nil
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
        // Set first: everything below produces the same failure a dropped
        // connection does, and `scheduleReconnect` reads this to tell them
        // apart.
        closedByUs = true
        retry?.cancel()
        retry = nil
        finish(with: .failure(CoordinatorFailure.closedBeforeRegistering))
        heartbeat?.cancel()
        heartbeat = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }

    /**
     How long before the next attempt.

     Doubling from a second, capped at fifteen, with a quarter of jitter
     either way. The jitter is not decoration: every phone on one network
     loses a coordinator at the same instant, and without it they come back
     in step and keep colliding on the same schedule.
     */
    private func backoff() -> TimeInterval {
        let doubled = min(reconnectMax, reconnectBase * pow(2, Double(attempt)))
        let jitter = doubled * 0.25
        return doubled - jitter + Double.random(in: 0...(jitter * 2))
    }

    /**
     Try again, unless trying again cannot help.

     The one fatal refusal is an auth key the coordinator does not accept:
     it will not become correct by being presented again, and retrying it
     forever loops while hiding the only thing anybody could fix. A key still
     held by the connection this phone just lost is retried — the ordinary
     case here, and it clears itself.
     */
    private func scheduleReconnect() {
        guard !closedByUs, retry == nil else { return }
        if lastServerError == CoordinatorError.unauthorized {
            log.error("not retrying: \(CoordinatorError.unauthorized, privacy: .public)")
            onGaveUp?(CoordinatorError.unauthorized)
            return
        }

        let delay = backoff()
        attempt += 1
        log.notice("reconnecting to the coordinator in \(delay, privacy: .public)s (attempt \(self.attempt, privacy: .public))")
        onReconnecting?(attempt, delay)

        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.retry = nil
            guard !self.closedByUs else { return }
            self.openSocket()
        }
        retry = work
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay, execute: work)
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
                /*
                 * The heartbeat stops with the socket.
                 *
                 * Left running it would go on sending into a dead task and
                 * calling `checkLiveness`, which would report a stall for a
                 * connection that has already gone — and a second timer
                 * would be started by the next registration.
                 */
                self.heartbeat?.cancel()
                self.heartbeat = nil
                self.finish(with: .failure(self.lastServerError.map { CoordinatorFailure.rejected($0) }
                    ?? CoordinatorFailure.closedBeforeRegistering))
                self.scheduleReconnect()
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
            // A registration that worked ends the backoff: the next drop
            // starts from a second again rather than from wherever this one
            // climbed to.
            attempt = 0
            startHeartbeat()
            finish(with: .success(CoordinatorRegistration(assignedIp: assignedIp, network: network)))
        case "peers":
            guard let raw = frame["peers"] as? [Any] else { return }
            /*
             * Decoded one record at a time, on purpose.
             *
             * Decoding the array as a whole is all-or-nothing: one record
             * this build cannot read discards every other record with it,
             * `onPeers` never fires, and the tunnel waits for an exit that is
             * sitting in the frame it just threw away — with nothing logged,
             * because there is no error to log when the answer is simply nil.
             * The desktop reads the same frame field by field and tolerates a
             * record it does not understand.
             *
             * So a bad record is dropped and counted, and the rest are used.
             */
            var peers: [CoordinatorPeer] = []
            var undecodable = 0
            for record in raw {
                guard let encoded = try? JSONSerialization.data(withJSONObject: record),
                      let peer = try? JSONDecoder().decode(CoordinatorPeer.self, from: encoded)
                else {
                    undecodable += 1
                    continue
                }
                peers.append(peer)
            }
            if undecodable > 0 {
                log.error("ignored \(undecodable) peer record(s) this build could not read, of \(raw.count)")
            }
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
     The exit to use, chosen the same way `chooseExit` in `vpn/interface.ts`
     chooses it.

     Matching that rule matters more than the rule itself. A phone and a
     desktop on one network that disagree about which exit is "the" exit send
     their traffic to different places, and nothing anywhere reports a
     problem.

     With `pinnedTo` set, that peer and no other — present or absent, and if
     absent the answer is nil rather than a substitute. `exitNode` is a claim
     the coordinator relays without checking, and the auth key every member
     holds is what lets anybody make it, so "whichever peer advertises" means
     "whichever peer says so first and sorts smallest". Falling back to that
     because a pinned peer is offline would quietly undo the decision at the
     one moment it mattered.

     Without a pin, the smallest public key among the peers that advertise.
     A stable choice rather than a safe one: nothing here can tell an exit
     from something claiming to be one.
     */
    func exit(pinnedTo wanted: String?) -> CoordinatorPeer? {
        if let wanted {
            // Not filtered on `exitNode`: naming a key is already the
            // decision, and refusing to use it because the peer did not also
            // advertise would be surprising. `interface.ts` honours a pin the
            // same way, for the same reason.
            return first { $0.publicKey == wanted }
        }
        return filter { $0.exitNode == true }
            .sorted { $0.publicKey < $1.publicKey }
            .first
    }
}

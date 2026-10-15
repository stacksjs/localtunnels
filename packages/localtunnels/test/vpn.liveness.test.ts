/**
 * Noticing that the coordinator has stopped talking to us.
 *
 * The failure these cover is the one the kill switch caused: heartbeats piled
 * up unsent, the coordinator dropped the node from the directory about two
 * minutes later, and the exit withdrew the route to its tunnel address. The
 * tunnel then carried traffic one way with the interface up, handshakes
 * succeeding, and both ends printing `link up`. Nothing about being forgotten
 * is sent to the node that was forgotten, so it has to work the silence out
 * for itself.
 *
 * The silence is staged with a server of this file's own rather than by
 * stopping a real coordinator, because stopping one closes its sockets — and
 * a closed socket is the easy case the client already handled. What has to be
 * reproduced is the hard one: a connection that stays `OPEN` with nothing
 * coming back, which is exactly what an evicted node is left holding.
 *
 * No native library here. The coordinator and its client are WebSocket and
 * JSON, so this runs anywhere, which is the half of the VPN that most needs
 * to stay testable.
 */
import type { Server } from 'bun'
import { afterEach, describe, expect, it } from 'bun:test'
import { VpnCoordinator, VpnCoordinatorClient } from '../src/vpn'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for condition')
    await sleep(10)
  }
}

/**
 * A coordinator that registers a node and can then be struck deaf.
 *
 * `deaf` is the whole point: it keeps the socket open and simply stops
 * answering, which is what a node that has been dropped from the directory
 * experiences. It is never told; it is only not replied to.
 */
function fakeCoordinator(): { url: string, stop: () => void, deaf: () => void, heartbeats: () => number, push: (frame: unknown) => void } {
  let deaf = false
  let heartbeats = 0
  const sockets = new Set<any>()
  const server: Server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (req, s) => (s.upgrade(req) ? undefined : new Response('fake coordinator')),
    websocket: {
      open: (ws) => { sockets.add(ws) },
      close: (ws) => { sockets.delete(ws) },
      message: (ws, raw) => {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
        if (msg.t === 'register') {
          ws.send(JSON.stringify({ t: 'registered', assignedIp: '100.100.0.2', network: '100.100.0.0/16' }))
          return
        }
        if (msg.t === 'heartbeat') {
          heartbeats += 1
          if (!deaf)
            ws.send(JSON.stringify({ t: 'heartbeat' }))
        }
      },
    },
  })
  return {
    url: `ws://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
    deaf: () => { deaf = true },
    heartbeats: () => heartbeats,
    push: (frame: unknown) => { for (const ws of sockets) ws.send(JSON.stringify(frame)) },
  }
}

describe('vpn/liveness', () => {
  const clients: VpnCoordinatorClient[] = []
  const servers: { stop: () => void }[] = []

  afterEach(() => {
    for (const client of clients) client.close()
    clients.length = 0
    for (const server of servers) server.stop()
    servers.length = 0
  })

  function connect(url: string, options: { heartbeatInterval?: number, staleAfter?: number } = {}): VpnCoordinatorClient {
    const client = new VpnCoordinatorClient({
      url,
      publicKey: `key-${clients.length}-${Math.random().toString(36).slice(2)}`,
      listenPort: 51820 + clients.length,
      heartbeatInterval: options.heartbeatInterval ?? 0.05,
      staleAfter: options.staleAfter,
    })
    client.on('error', () => { /* a stopped server is expected in places */ })
    clients.push(client)
    return client
  }

  describe('the heartbeat answer', () => {
    /*
     * Against the real coordinator, because the answer is its half of this
     * and a test of the fake would only be a test of the fake.
     */
    it('comes back from a real coordinator, so silence means something', async () => {
      const coordinator = new VpnCoordinator({ host: '127.0.0.1' })
      coordinator.start()
      servers.push({ stop: () => coordinator.stop() })

      const client = connect(`ws://127.0.0.1:${coordinator.port}`)
      await client.connect()

      let acks = 0
      const raw = (client as unknown as { ws: WebSocket }).ws
      raw.addEventListener('message', (event: MessageEvent) => {
        if (JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)).t === 'heartbeat')
          acks += 1
      })
      await until(() => acks >= 2)
      expect(acks).toBeGreaterThanOrEqual(2)
    })

    // A node built before the answer existed must not break on it: the parse
    // keeps any frame with a `t`, and the switch simply has no case.
    it('does not disturb a client that was not expecting it', async () => {
      const coordinator = new VpnCoordinator({ host: '127.0.0.1' })
      coordinator.start()
      servers.push({ stop: () => coordinator.stop() })

      const client = connect(`ws://127.0.0.1:${coordinator.port}`)
      const errors: Error[] = []
      client.on('error', error => errors.push(error))
      await client.connect()
      await sleep(200)
      expect(errors).toEqual([])
      expect(client.assignedIp).toBe('100.100.0.2')
    })
  })

  describe('a session that goes quiet', () => {
    /*
     * The heart of it: the socket stays OPEN and nothing comes back, which is
     * what a dropped node's connection looks like from the inside. TCP will
     * not notice for a very long time, which is how a node gets evicted while
     * its socket still reads as healthy.
     */
    it('is reported when the coordinator stops answering', async () => {
      const server = fakeCoordinator()
      servers.push(server)
      const client = connect(server.url, { heartbeatInterval: 0.05, staleAfter: 0.2 })
      const stalls: { reason: string, silentForMs: number }[] = []
      client.on('stale', info => stalls.push(info))

      await client.connect()
      await until(() => server.heartbeats() >= 1)
      server.deaf()

      await until(() => stalls.length > 0)
      expect(stalls[0].reason).toContain('coordinator has not answered')
      expect(stalls[0].silentForMs).toBeGreaterThanOrEqual(200)
      // The socket never closed. That is the point.
      expect((client as unknown as { ws: WebSocket }).ws.readyState).toBe(WebSocket.OPEN)
    })

    // Once per stall, not once per heartbeat: this beats every 50ms, and a
    // warning that repeats forever is a warning nobody reads.
    it('is reported once, not on every heartbeat', async () => {
      const server = fakeCoordinator()
      servers.push(server)
      const client = connect(server.url, { heartbeatInterval: 0.05, staleAfter: 0.2 })
      const stalls: unknown[] = []
      client.on('stale', info => stalls.push(info))

      await client.connect()
      server.deaf()
      await until(() => stalls.length > 0)
      await sleep(300)
      expect(stalls.length).toBe(1)
    })

    it('stays quiet while the coordinator is answering', async () => {
      const server = fakeCoordinator()
      servers.push(server)
      const client = connect(server.url, { heartbeatInterval: 0.05, staleAfter: 0.3 })
      const stalls: unknown[] = []
      client.on('stale', info => stalls.push(info))

      await client.connect()
      await sleep(500)
      expect(server.heartbeats()).toBeGreaterThan(2)
      expect(stalls).toEqual([])
    })

    /*
     * A `peers` update is as much proof of life as an answered heartbeat.
     * Treating only the answer as liveness would report a stall on a network
     * that is busy rather than broken.
     */
    it('counts any frame as proof of life, not only the answer', async () => {
      const server = fakeCoordinator()
      servers.push(server)
      const client = connect(server.url, { heartbeatInterval: 0.05, staleAfter: 0.25 })
      const stalls: unknown[] = []
      client.on('stale', info => stalls.push(info))

      await client.connect()
      server.deaf()
      // Nothing answers the heartbeats, but the directory keeps changing.
      const pushing = setInterval(() => server.push({ t: 'peers', peers: [] }), 40)
      await sleep(500)
      clearInterval(pushing)
      expect(stalls).toEqual([])
    })
  })

  describe('recovery', () => {
    it('says so when frames start arriving again', async () => {
      const server = fakeCoordinator()
      servers.push(server)
      const client = connect(server.url, { heartbeatInterval: 0.05, staleAfter: 0.2 })
      const events: string[] = []
      client.on('stale', () => events.push('stale'))
      client.on('resumed', () => events.push('resumed'))

      await client.connect()
      server.deaf()
      await until(() => events.includes('stale'))

      server.push({ t: 'peers', peers: [] })
      await until(() => events.includes('resumed'))
      expect(events).toEqual(['stale', 'resumed'])
    })
  })

  describe('heartbeats that never leave', () => {
    /*
     * The kill switch's own shape. The send queue grows because nothing is
     * leaving the machine, and the reason says so — a local firewall rule is
     * a different problem from a coordinator that has gone away, and the
     * person reading the warning fixes a different thing.
     */
    it('is named as a local problem when the send queue is backing up', async () => {
      const server = fakeCoordinator()
      servers.push(server)
      const client = connect(server.url, { heartbeatInterval: 0.05, staleAfter: 0.2 })
      const stalls: { reason: string }[] = []
      client.on('stale', info => stalls.push(info))

      await client.connect()
      server.deaf()

      // A send queue that never drains, which is what the blocked port did.
      const socket = (client as unknown as { ws: WebSocket }).ws
      Object.defineProperty(socket, 'bufferedAmount', { get: () => 4096, configurable: true })

      await until(() => stalls.length > 0)
      expect(stalls[0].reason).toContain('leaving this machine')
    })
  })
})

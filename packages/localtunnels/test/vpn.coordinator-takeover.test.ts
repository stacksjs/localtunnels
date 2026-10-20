/**
 * Getting back into the directory after the connection died.
 *
 * A node that stops heart-beating is dropped, and the exit then withdraws
 * the route to its tunnel address — so a reconnect is not a tidiness
 * exercise, it is the difference between a tunnel that comes back and one
 * that is dead until somebody opens the app again. On a phone it is the
 * ordinary case: Wi-Fi to cellular, a handover, a few minutes backgrounded.
 *
 * The thing in the way was here rather than in any client. A public key may
 * be claimed by one connection, and "claimed" was tested with
 * `readyState === OPEN` — which is the one fact that lies in exactly this
 * situation. A client whose network vanished leaves a socket this process
 * believes in until the kernel gives up, so the node reconnecting was
 * refused its own key for as long as the corpse lingered, with the exit
 * already routing elsewhere.
 *
 * Raw WebSockets rather than `VpnNode`: none of this needs the native core,
 * so none of it should be skipped on a machine that has not built it.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { STALE_AFTER_MS, VpnCoordinator } from '../src/vpn/coordinator'

/** Long enough to be a real silence, short enough to wait for. */
const STALE_MS = 60

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for condition')
    await sleep(5)
  }
}

/** One node's connection, with everything the coordinator said to it. */
interface Conn {
  ws: WebSocket
  frames: Record<string, unknown>[]
  closed: { code: number, reason: string } | null
  register: (publicKey: string) => void
  last: (type: string) => Record<string, unknown> | undefined
}

function open(port: number): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const conn: Conn = {
      ws,
      frames: [],
      closed: null,
      register: (publicKey: string) => ws.send(JSON.stringify({ t: 'register', publicKey, listenPort: 51820 })),
      last: (type: string) => [...conn.frames].reverse().find(frame => frame.t === type),
    }
    ws.addEventListener('message', (event) => {
      conn.frames.push(JSON.parse(String(event.data)))
    })
    ws.addEventListener('close', (event) => {
      conn.closed = { code: event.code, reason: event.reason }
    })
    ws.addEventListener('open', () => resolve(conn))
    ws.addEventListener('error', () => reject(new Error('could not reach the coordinator')))
  })
}

describe('reclaiming a key', () => {
  let coordinator: VpnCoordinator | null = null
  const conns: Conn[] = []

  afterEach(() => {
    for (const conn of conns) conn.ws.close()
    conns.length = 0
    coordinator?.stop()
    coordinator = null
  })

  async function start(): Promise<number> {
    coordinator = new VpnCoordinator({ port: 0, staleAfterMs: STALE_MS })
    coordinator.start()
    return coordinator.port
  }

  async function connect(port: number): Promise<Conn> {
    const conn = await open(port)
    conns.push(conn)
    return conn
  }

  const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='

  /*
   * The property that has to survive all of this: a key in use by a node
   * that is demonstrably there is not up for grabs.
   */
  it('refuses a second claim while the first is still talking', async () => {
    const port = await start()
    const first = await connect(port)
    first.register(KEY)
    await until(() => first.last('registered') !== undefined)

    // Proof of life inside the window, which is what a heartbeat is for.
    await sleep(STALE_MS / 2)
    first.ws.send(JSON.stringify({ t: 'heartbeat' }))
    await sleep(STALE_MS / 2)

    const second = await connect(port)
    second.register(KEY)
    await until(() => second.closed !== null)
    expect(second.last('error')?.message).toBe('public key is already registered by a live connection')
    expect(second.closed?.code).toBe(1008)
    // And the original keeps its place.
    expect(coordinator!.registeredPeers.map(peer => peer.publicKey)).toEqual([KEY])
  })

  /*
   * The regression. A connection that has stopped saying anything is not a
   * live claim on the key, whatever its socket still reports.
   */
  it('lets a node back in once the old connection has gone quiet', async () => {
    const port = await start()
    const first = await connect(port)
    first.register(KEY)
    await until(() => first.last('registered') !== undefined)
    const assigned = first.last('registered')!.assignedIp

    await sleep(STALE_MS * 2)

    const second = await connect(port)
    second.register(KEY)
    await until(() => second.last('registered') !== undefined)
    // Same address, which is what the lease map is for: a node that drops and
    // comes back is the same node, and an exit's route to it still applies.
    expect(second.last('registered')!.assignedIp).toBe(assigned)
    expect(second.last('error')).toBeUndefined()
  })

  // The displaced connection is told, rather than left believing it is in a
  // directory it has been removed from.
  it('closes the connection it displaced', async () => {
    const port = await start()
    const first = await connect(port)
    first.register(KEY)
    await until(() => first.last('registered') !== undefined)
    await sleep(STALE_MS * 2)

    const second = await connect(port)
    second.register(KEY)
    await until(() => first.closed !== null)
    expect(first.closed?.reason).toBe('replaced by a newer connection')
  })

  /*
   * The property, not the mechanism.
   *
   * `close` deletes a registration by its socket's key, so a displaced
   * connection could in principle delete the one that just replaced it — a
   * reconnect that succeeds, is acknowledged, and vanishes from the
   * directory a moment later, which is worse than the refusal it fixed.
   *
   * It passes today for a reason this test cannot see: Bun runs the close
   * handler synchronously inside `ws.close()`, so the old entry is gone
   * before the new one is installed, and it passes with the guard in
   * `close` removed too. What is pinned here is the observable end state,
   * which is the thing that matters and would break under either a change of
   * ordering or a change of guard.
   */
  it('does not let the displaced connection take the new one with it', async () => {
    const port = await start()
    const first = await connect(port)
    first.register(KEY)
    await until(() => first.last('registered') !== undefined)
    await sleep(STALE_MS * 2)

    const second = await connect(port)
    second.register(KEY)
    await until(() => second.last('registered') !== undefined)
    await until(() => first.closed !== null)
    // Long enough for the close to have been handled, had it been going to
    // do any damage.
    await sleep(50)

    expect(coordinator!.registeredPeers.map(peer => peer.publicKey)).toEqual([KEY])
  })

  // Re-registering on the connection that already holds the key is not a
  // second claimant and must not displace anything.
  it('lets a node re-register on its own connection', async () => {
    const port = await start()
    const first = await connect(port)
    first.register(KEY)
    await until(() => first.last('registered') !== undefined)
    first.register(KEY)
    await sleep(50)
    expect(first.closed).toBeNull()
    expect(coordinator!.registeredPeers).toHaveLength(1)
  })
})

/*
 * The windows themselves, which were an accident.
 *
 * The client's 20-second heartbeat and 60-second stale threshold were tuned
 * against Bun's default `idleTimeout` — 120 seconds — which nothing here set
 * and nothing said. A release changing that default would have moved the
 * eviction window silently: longer, and a node that is gone stays in the
 * directory while the exit routes to it; shorter than three heartbeats, and
 * live nodes are evicted mid-session.
 */
describe('the windows', () => {
  it('are derived from the heartbeat, in both halves', async () => {
    const { HEARTBEAT_SECONDS, IDLE_TIMEOUT_SECONDS } = await import('../src/vpn/coordinator')
    expect(HEARTBEAT_SECONDS).toBe(20)
    // Three missed heartbeats: the same count the client uses before calling
    // this side stale, so both ends give up on each other at one moment.
    expect(STALE_AFTER_MS).toBe(HEARTBEAT_SECONDS * 3 * 1000)
    // And the socket outlives that, or a connection would be closed before it
    // could ever be displaced and the takeover path would be dead code.
    expect(IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThan(STALE_AFTER_MS)
  })

  it('match what the client is tuned to', async () => {
    const client = await Bun.file(new URL('../src/vpn/client.ts', import.meta.url)).text()
    expect(client).toContain('options.heartbeatInterval ?? 20')
    expect(client).toContain('this.heartbeatInterval * 3')
  })
})

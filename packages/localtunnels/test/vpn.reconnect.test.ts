/**
 * Coming back, which nothing did.
 *
 * A node that stops heart-beating is dropped from the directory and the exit
 * withdraws the route to its tunnel address. Neither half of this protocol
 * reconnected: the TypeScript client emitted `close` and nobody listened,
 * and the Swift one let its registration callback go stale. So a coordinator
 * connection lost to a network change was a tunnel that stayed up, reported
 * health, and carried nothing — for as long as the app was left open.
 *
 * The policy here is a decision rather than a default, so it is written
 * down. Retry forever, because the alternative is a tunnel that is silently
 * dead and the thing it is waiting for is a network that usually comes back.
 * Back off, because a coordinator that is down does not want a tight loop.
 * Jitter, because every node on a network loses it at the same instant.
 * Give up on exactly one refusal — an auth key that is not accepted — since
 * that is the only one retrying cannot fix and the only one worth a person's
 * attention.
 *
 * Real coordinator, real sockets, no native core: all of this is the control
 * plane, so none of it should be skipped on a machine that has not built
 * libltvpn.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { VpnCoordinatorClient } from '../src/vpn/client'
import { VpnCoordinator } from '../src/vpn/coordinator'
import { ERROR_UNAUTHORIZED } from '../src/vpn/protocol'

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for condition')
    await sleep(10)
  }
}

describe('reconnecting', () => {
  let coordinator: VpnCoordinator | null = null
  let client: VpnCoordinatorClient | null = null

  afterEach(() => {
    client?.close()
    client = null
    coordinator?.stop()
    coordinator = null
  })

  /** A coordinator that releases a key quickly, so a test can watch it. */
  function startCoordinator(authKey?: string): number {
    coordinator = new VpnCoordinator({ port: 0, staleAfterMs: 40, authKey })
    coordinator.start()
    return coordinator.port
  }

  function makeClient(port: number, options: Record<string, unknown> = {}): VpnCoordinatorClient {
    client = new VpnCoordinatorClient({
      url: `ws://127.0.0.1:${port}`,
      publicKey: KEY,
      listenPort: 51820,
      // Short enough to watch; the ratios are what the defaults assert.
      reconnectMaxMs: 60,
      ...options,
    })
    /*
     * Listened to rather than ignored. This is a node `EventEmitter`, so an
     * `error` with no listener throws out of whatever happened to be on the
     * stack — and every test here provokes one on purpose, since a dropped
     * coordinator is an error before it is a reconnection.
     */
    client.on('error', () => {})
    return client
  }

  /*
   * The whole point. The coordinator goes away and comes back, and the node
   * is in the directory again without anybody restarting anything.
   */
  it('registers again after the coordinator restarts', async () => {
    const port = startCoordinator()
    const node = makeClient(port)
    const registrations: string[] = []
    node.on('registered', info => registrations.push(info.assignedIp))

    await node.connect()
    expect(registrations).toHaveLength(1)

    // Taking the coordinator down and back up on the same port is what a
    // restart looks like from here.
    coordinator!.stop()
    await until(() => registrations.length === 1)
    coordinator = new VpnCoordinator({ port, staleAfterMs: 40 })
    coordinator.start()

    await until(() => registrations.length >= 2)
    expect(node.assignedIp).toBe(registrations[0])
  })

  /*
   * A stall that ends by reconnecting has to announce itself.
   *
   * `checkLiveness` is the only other place a stall ends, and it only runs
   * on a tick of the connection that stalled — so when the socket came back
   * instead, `startHeartbeat` cleared the flag without a word. The client
   * was fine from then on and nothing said so.
   *
   * The desktop reads health by scanning the tunnel log back for whichever
   * of "silent" or "answering again" came last, so one missing line left the
   * window warning that the connection would stop working shortly, over a
   * tunnel carrying traffic, for the rest of the session.
   */
  it('says the coordinator is answering again when the socket comes back', async () => {
    const port = startCoordinator()
    // A stale threshold under one heartbeat: the first tick sends and checks
    // before any answer can arrive, so the stall is provoked on schedule
    // rather than waited for.
    const node = makeClient(port, { heartbeatInterval: 0.02, staleAfter: 0.001 })
    const heard: string[] = []
    node.on('stale', () => heard.push('stale'))
    node.on('resumed', () => heard.push('resumed'))

    await node.connect()
    await until(() => heard.includes('stale'))

    coordinator!.stop()
    coordinator = new VpnCoordinator({ port, staleAfterMs: 40 })
    coordinator.start()

    await until(() => heard.includes('resumed'))
    expect(heard[0]).toBe('stale')
    expect(heard).toContain('resumed')
  })

  // Said out loud, because the window otherwise goes on claiming the tunnel
  // is up: the interface stays up throughout and being dropped from a
  // directory is not something anyone sends you.
  it('says it is trying', async () => {
    const port = startCoordinator()
    const node = makeClient(port)
    const attempts: { attempt: number, inMs: number, reason: string }[] = []
    node.on('reconnecting', info => attempts.push(info))

    await node.connect()
    coordinator!.stop()

    await until(() => attempts.length >= 2)
    // Numbered, so a listener can tell a first blip from a long outage.
    expect(attempts[0].attempt).toBe(1)
    expect(attempts[1].attempt).toBe(2)
    for (const attempt of attempts)
      expect(attempt.reason.length).toBeGreaterThan(0)
  })

  /*
   * The backoff, as a shape rather than a schedule. Waits must grow and must
   * not grow past the ceiling, and the exact numbers are jittered on purpose
   * so asserting on them would be asserting on the random number generator.
   */
  it('waits longer each time, up to the ceiling', async () => {
    const port = startCoordinator()
    // A base well under the ceiling, or there is no ramp to watch: the first
    // wait would already be capped and every one after it identical.
    const node = makeClient(port, { reconnectBaseMs: 5, reconnectMaxMs: 40 })
    const waits: number[] = []
    node.on('reconnecting', info => waits.push(info.inMs))

    await node.connect()
    coordinator!.stop()
    await until(() => waits.length >= 5)

    // A quarter of jitter either way, so the ceiling is 40 plus 25%.
    for (const wait of waits)
      expect(wait).toBeLessThanOrEqual(50)
    // It grew: the last wait is at the ceiling and the first is nowhere near
    // it, which is what backing off means. Jitter is why this is a
    // comparison and not a schedule.
    expect(waits[0]).toBeLessThan(20)
    expect(waits[waits.length - 1]).toBeGreaterThan(20)
  })

  /*
   * The one refusal that will not come good. Retrying a rejected auth key
   * forever loops while hiding the only thing anybody could fix.
   */
  it('gives up on an auth key the coordinator will not accept', async () => {
    const port = startCoordinator('the-real-secret')
    const node = makeClient(port, { authKey: 'not-the-secret' })
    const attempts: unknown[] = []
    const gaveUp: { reason: string }[] = []
    node.on('reconnecting', info => attempts.push(info))
    node.on('gaveUp', info => gaveUp.push(info))

    await expect(node.connect()).rejects.toThrow(/auth key/)
    await until(() => gaveUp.length === 1)
    await sleep(120)
    // Not one attempt, however long it is left.
    expect(attempts).toHaveLength(0)
    expect(gaveUp[0].reason).toContain(ERROR_UNAUTHORIZED)
  })

  /*
   * And the refusal that does come good, which is the common one after a
   * network change: the coordinator still believes in the connection this
   * node just lost, and releases the key once it has been silent long
   * enough to be displaced.
   */
  it('retries a key still held by a connection that is gone', async () => {
    const port = startCoordinator()
    const squatter = new VpnCoordinatorClient({
      url: `ws://127.0.0.1:${port}`,
      publicKey: KEY,
      listenPort: 51820,
      reconnect: false,
      // Never heartbeats, so the coordinator stops hearing from it.
      heartbeatInterval: 0,
    })
    squatter.on('error', () => {})
    await squatter.connect()

    const node = makeClient(port)
    const registered: string[] = []
    node.on('registered', info => registered.push(info.assignedIp))
    // Refused at first — the key is held — and the client keeps trying.
    node.connect().catch(() => {})

    await until(() => registered.length === 1, 6000)
    expect(node.assignedIp).toBeTruthy()
    squatter.close()
  })

  // A client that was told to stop is stopped. Reconnecting after a
  // deliberate shutdown is a client that cannot be turned off.
  it('does not come back after close()', async () => {
    const port = startCoordinator()
    const node = makeClient(port)
    const attempts: unknown[] = []
    node.on('reconnecting', info => attempts.push(info))

    await node.connect()
    node.close()
    await sleep(150)
    expect(attempts).toHaveLength(0)
  })

  // One attempt and an answer, for a caller that wants to probe rather than
  // to hold a tunnel up.
  it('can be turned off', async () => {
    const port = startCoordinator()
    const node = makeClient(port, { reconnect: false })
    const attempts: unknown[] = []
    node.on('reconnecting', info => attempts.push(info))

    await node.connect()
    coordinator!.stop()
    await sleep(150)
    expect(attempts).toHaveLength(0)
  })
})

/*
 * The defaults, which are the part a deployment actually runs.
 *
 * Every test above shortens them to something a test can wait for, so
 * without this the shipped numbers would be the only thing here nothing
 * checks.
 */
describe('the shipped policy', () => {
  it('keeps trying across the window a coordinator holds a key for', async () => {
    const source = await Bun.file(new URL('../src/vpn/client.ts', import.meta.url)).text()
    // Fifteen seconds, against the minute a key stays held: four or five
    // attempts inside it rather than one unlucky try and a long sleep.
    expect(source).toContain('options.reconnectMaxMs ?? 15_000')
    expect(source).toContain('options.reconnect ?? true')
  })

  it('jitters, so a network does not come back in step', async () => {
    const source = await Bun.file(new URL('../src/vpn/client.ts', import.meta.url)).text()
    expect(source).toContain('Math.random()')
    expect(source).toMatch(/doubled \* 0\.25/)
  })
})

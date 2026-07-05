import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPair, isVpnAvailable, VpnCoordinator, VpnNode, VpnPeer } from '../src/vpn'

const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

if (!available) {
  // eslint-disable-next-line no-console
  console.warn('[vpn.nat] native libltvpn not built — skipping. Run `cd native && zig build`.')
}

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

describeVpn('vpn/nat-traversal', () => {
  let peers: VpnPeer[] = []
  let nodes: VpnNode[] = []
  let coordinator: VpnCoordinator | null = null

  afterEach(() => {
    for (const p of peers) p.stop()
    for (const n of nodes) n.stop()
    peers = []
    nodes = []
    coordinator?.stop()
    coordinator = null
  })

  it('delivers hole-punch datagrams to the target', async () => {
    const a = new VpnPeer({ keyPair: generateKeyPair(), host: '127.0.0.1', keepaliveInterval: 0 })
    const b = new VpnPeer({ keyPair: generateKeyPair(), host: '127.0.0.1', keepaliveInterval: 0 })
    peers.push(a, b)
    await a.start()
    await b.start()

    const seen: { host: string, port: number }[] = []
    b.on('punch', (host, port) => seen.push({ host, port }))

    a.punch('127.0.0.1', b.port, 4, 20)
    await until(() => b.punchesReceived >= 4)
    expect(b.punchesReceived).toBeGreaterThanOrEqual(4)
    expect(seen[0].host).toBe('127.0.0.1')
    expect(seen[0].port).toBe(a.port)
  })

  it('coordinator relays a punch request to the target', async () => {
    coordinator = new VpnCoordinator({ host: '127.0.0.1' })
    coordinator.start()
    const url = `ws://127.0.0.1:${coordinator.port}`

    // Alice and Bob join; Bob receives punches from Alice via the relay.
    const alice = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url })
    const bob = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url })
    nodes.push(alice, bob)
    alice.on('error', () => {})
    bob.on('error', () => {})

    await alice.start()
    await bob.start()

    // With two members, both punch each other as part of discovery; each side
    // should observe inbound punch datagrams.
    await until(() => alice.peer.punchesReceived >= 1 && bob.peer.punchesReceived >= 1, 6000)
    expect(alice.peer.punchesReceived).toBeGreaterThanOrEqual(1)
    expect(bob.peer.punchesReceived).toBeGreaterThanOrEqual(1)
  }, 10_000)

  it('still forms a working encrypted link with punching enabled', async () => {
    coordinator = new VpnCoordinator({ host: '127.0.0.1' })
    coordinator.start()
    const url = `ws://127.0.0.1:${coordinator.port}`

    const alice = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url })
    const bob = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url })
    nodes.push(alice, bob)
    const atBob: string[] = []
    bob.on('message', d => atBob.push(new TextDecoder().decode(d)))
    alice.on('error', () => {})
    bob.on('error', () => {})

    await alice.start()
    await bob.start()

    await until(() => alice.peer.punchesReceived >= 1 || bob.peer.punchesReceived >= 1, 6000)
    // Link forms despite (and alongside) the punch traffic.
    await until(() => {
      try {
        alice.send(bob.publicKeyB64, new TextEncoder().encode('through-nat'))
      }
      catch {
        return false // no link yet
      }
      return atBob.includes('through-nat')
    }, 6000)
    expect(atBob).toContain('through-nat')
  }, 10_000)
})

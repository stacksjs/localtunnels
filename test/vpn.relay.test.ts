import { afterEach, describe, expect, it } from 'bun:test'
import { encodeKey, generateKeyPair, isVpnAvailable, VpnCoordinator, VpnNode, VpnPeer } from '../src/vpn'

const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

if (!available) {
  // eslint-disable-next-line no-console
  console.warn('[vpn.relay] native libltvpn not built — skipping. Run `cd native && zig build`.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for condition')
    await sleep(10)
  }
}

describeVpn('vpn/relay', () => {
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

  it('carries a full handshake and traffic entirely over a manual relay', async () => {
    // No coordinator: wire the two peers' relay sinks directly to each other so
    // NOT ONE BYTE goes over UDP between them. This isolates the relay path.
    const aKeys = generateKeyPair()
    const bKeys = generateKeyPair()
    const a = new VpnPeer({ keyPair: aKeys, host: '127.0.0.1', keepaliveInterval: 0 })
    const b = new VpnPeer({ keyPair: bKeys, host: '127.0.0.1', keepaliveInterval: 0 })
    peers.push(a, b)
    a.addPeer({ publicKey: bKeys.publicKey })
    b.addPeer({ publicKey: aKeys.publicKey })
    await a.start()
    await b.start()

    // Cross-wire relay sinks (this is what the coordinator does in production).
    const aPub = encodeKey(aKeys.publicKey)
    const bPub = encodeKey(bKeys.publicKey)
    a.setRelay((_to, frame) => b.receiveRelayFrame(aPub, frame))
    b.setRelay((_to, frame) => a.receiveRelayFrame(bPub, frame))

    const atB: string[] = []
    const atA: string[] = []
    b.on('message', d => atB.push(new TextDecoder().decode(d)))
    a.on('message', d => atA.push(new TextDecoder().decode(d)))
    a.on('error', () => {})
    b.on('error', () => {})

    const link = await a.connectViaRelay(bKeys.publicKey)
    expect(link.peerIndex).toBeGreaterThan(0)

    a.send(bKeys.publicKey, new TextEncoder().encode('relayed hello'))
    await until(() => atB.length >= 1)
    expect(atB[0]).toBe('relayed hello')

    b.send(aKeys.publicKey, new TextEncoder().encode('relayed reply'))
    await until(() => atA.length >= 1)
    expect(atA[0]).toBe('relayed reply')
  })

  it('nodes with relay:always connect through the coordinator', async () => {
    coordinator = new VpnCoordinator({ host: '127.0.0.1' })
    coordinator.start()
    const url = `ws://127.0.0.1:${coordinator.port}`

    const alice = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url, relay: 'always' })
    const bob = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url, relay: 'always' })
    nodes.push(alice, bob)
    const atBob: string[] = []
    bob.on('message', d => atBob.push(new TextDecoder().decode(d)))
    alice.on('error', () => {})
    bob.on('error', () => {})

    await alice.start()
    await bob.start()

    await until(() => {
      try {
        alice.send(bob.publicKeyB64, new TextEncoder().encode('via-coordinator-relay'))
      }
      catch {
        return false
      }
      return atBob.includes('via-coordinator-relay')
    }, 6000)
    expect(atBob).toContain('via-coordinator-relay')
  }, 10_000)
})

import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPair, isVpnAvailable, VpnCoordinator, VpnNode } from '../src/vpn'

// End-to-end coordination: a VpnCoordinator plus VpnNodes that auto-discover
// each other and form encrypted links with no manual key/endpoint exchange.
// Skipped when the native libltvpn library isn't built.
const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

if (!available) {
  // eslint-disable-next-line no-console
  console.warn('[vpn.coordinator] native libltvpn not built — skipping. Run `cd native && zig build`.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for condition')
    await sleep(15)
  }
}

interface Harness {
  node: VpnNode
  links: Set<string>
  messages: { data: string, from: string }[]
}

describeVpn('vpn/coordinator', () => {
  let coordinator: VpnCoordinator | null = null
  let nodes: VpnNode[] = []

  afterEach(() => {
    for (const n of nodes) n.stop()
    nodes = []
    coordinator?.stop()
    coordinator = null
  })

  function startCoordinator(): string {
    coordinator = new VpnCoordinator({ host: '127.0.0.1' })
    coordinator.start()
    return `ws://127.0.0.1:${coordinator.port}`
  }

  function makeNode(url: string): Harness {
    const node = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url })
    const links = new Set<string>()
    const messages: { data: string, from: string }[] = []
    node.on('link', l => links.add(l.peerPublicKey))
    node.on('message', (data, from) => messages.push({ data: new TextDecoder().decode(data), from }))
    node.on('error', () => { /* transient handshake races are expected */ })
    nodes.push(node)
    return { node, links, messages }
  }

  it('assigns distinct tunnel IPs from the pool', async () => {
    const url = startCoordinator()
    const a = makeNode(url)
    const b = makeNode(url)
    const ai = await a.node.start()
    const bi = await b.node.start()
    expect(ai.assignedIp).toBe('100.100.0.2')
    expect(bi.assignedIp).toBe('100.100.0.3')
    expect(ai.network).toBe('100.100.0.0/16')
  })

  it('auto-discovers a peer and exchanges encrypted traffic both ways', async () => {
    const url = startCoordinator()
    const a = makeNode(url)
    const b = makeNode(url)
    await a.node.start()
    await b.node.start()

    // The two nodes should link automatically (one initiates by pubkey order).
    await until(() => a.links.size >= 1 || b.links.size >= 1)
    await sleep(150)

    a.node.send(b.node.publicKeyB64, new TextEncoder().encode('ping from a'))
    b.node.send(a.node.publicKeyB64, new TextEncoder().encode('pong from b'))

    await until(() => a.messages.length >= 1 && b.messages.length >= 1)
    expect(b.messages[0].data).toBe('ping from a')
    expect(b.messages[0].from).toBe(a.node.publicKeyB64)
    expect(a.messages[0].data).toBe('pong from b')
  })

  it('forms a full mesh among three nodes', async () => {
    const url = startCoordinator()
    const a = makeNode(url)
    const b = makeNode(url)
    const c = makeNode(url)
    await a.node.start()
    await b.node.start()
    await c.node.start()

    const all = [a, b, c]
    // Each node ends up with a link to both others (some as initiator, some as
    // responder). Wait until every node has 2 links.
    await until(() => all.every(h => h.links.size >= 2), 8000)

    // Every node greets every other; confirm all messages land.
    for (const src of all) {
      for (const dst of all) {
        if (src === dst)
          continue
        src.node.send(dst.node.publicKeyB64, new TextEncoder().encode(`hi-${src.node.publicKeyB64.slice(0, 6)}`))
      }
    }
    await until(() => all.every(h => h.messages.length >= 2), 4000)
    for (const h of all)
      expect(h.messages.length).toBeGreaterThanOrEqual(2)
  }, 15_000)

  it('drops a peer from the directory when it disconnects', async () => {
    const url = startCoordinator()
    const a = makeNode(url)
    const b = makeNode(url)
    await a.node.start()
    await b.node.start()
    await until(() => coordinator!.registeredPeers.length === 2)

    b.node.stop()
    nodes = nodes.filter(n => n !== b.node)
    await until(() => coordinator!.registeredPeers.length === 1)
    expect(coordinator!.registeredPeers[0].publicKey).toBe(a.node.publicKeyB64)
  })
})

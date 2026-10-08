import type { VpnKeyPair } from '../src/vpn'
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

  function startCoordinator(authKey?: string): string {
    coordinator = new VpnCoordinator({ host: '127.0.0.1', authKey })
    coordinator.start()
    return `ws://127.0.0.1:${coordinator.port}`
  }

  function makeNode(url: string, opts: { authKey?: string, keyPair?: VpnKeyPair, exitNode?: boolean } = {}): Harness {
    const node = new VpnNode({
      keyPair: opts.keyPair ?? generateKeyPair(),
      coordinatorUrl: url,
      authKey: opts.authKey,
      exitNode: opts.exitNode,
    })
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

  describe('auth', () => {
    const AUTH = 'correct-horse-battery-staple'

    it('reports whether it requires auth', () => {
      startCoordinator(AUTH)
      expect(coordinator!.requiresAuth).toBe(true)
      coordinator!.stop()
      startCoordinator()
      expect(coordinator!.requiresAuth).toBe(false)
    })

    it('admits a node presenting the right key', async () => {
      const url = startCoordinator(AUTH)
      const a = makeNode(url, { authKey: AUTH })
      const info = await a.node.start()
      expect(info.assignedIp).toBe('100.100.0.2')
      expect(coordinator!.registeredPeers.length).toBe(1)
    })

    it('rejects a node with no key, naming the reason', async () => {
      const url = startCoordinator(AUTH)
      const a = makeNode(url)
      await expect(a.node.start()).rejects.toThrow(/missing or invalid auth key/)
      expect(coordinator!.registeredPeers.length).toBe(0)
    })

    it('rejects a node with the wrong key', async () => {
      const url = startCoordinator(AUTH)
      const a = makeNode(url, { authKey: 'wrong' })
      await expect(a.node.start()).rejects.toThrow(/missing or invalid auth key/)
      expect(coordinator!.registeredPeers.length).toBe(0)
    })

    it('rejects a key that only shares a prefix with the real one', async () => {
      const url = startCoordinator(AUTH)
      const a = makeNode(url, { authKey: AUTH.slice(0, -1) })
      await expect(a.node.start()).rejects.toThrow(/missing or invalid auth key/)
      expect(coordinator!.registeredPeers.length).toBe(0)
    })

    it('still admits everyone when started without a key', async () => {
      const url = startCoordinator()
      const a = makeNode(url)
      await expect(a.node.start()).resolves.toBeTruthy()
      expect(coordinator!.registeredPeers.length).toBe(1)
    })

    it('will not let a second connection claim a registered public key', async () => {
      const url = startCoordinator(AUTH)
      const a = makeNode(url, { authKey: AUTH })
      await a.node.start()
      await until(() => coordinator!.registeredPeers.length === 1)

      // A raw client that knows the auth key but impersonates a's public key.
      const ws = new WebSocket(url)
      const frames: any[] = []
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({
            t: 'register',
            publicKey: a.node.publicKeyB64,
            listenPort: 51999,
            authKey: AUTH,
          }))
        })
        ws.addEventListener('message', (e: any) => {
          frames.push(JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)))
        })
        ws.addEventListener('close', () => resolve())
        ws.addEventListener('error', () => reject(new Error('socket error')))
        setTimeout(() => reject(new Error('impostor was neither rejected nor closed')), 4000)
      })

      expect(frames.some(f => f.t === 'error' && /already registered/.test(f.message))).toBe(true)
      // a keeps its record, and the impostor never got one of its own.
      expect(coordinator!.registeredPeers.length).toBe(1)
      expect(coordinator!.registeredPeers[0].endpoint.port).not.toBe(51999)
    })
  })

  describe('exit nodes', () => {
    it('advertises an exit node to the rest of the network', async () => {
      const url = startCoordinator()
      const exit = makeNode(url, { exitNode: true })
      const client = makeNode(url)

      const seen: Record<string, boolean | undefined> = {}
      client.node.on('peers', (records) => {
        for (const r of records) seen[r.publicKey] = r.exitNode
      })

      await exit.node.start()
      await client.node.start()
      await until(() => Object.keys(seen).length >= 1)

      expect(seen[exit.node.publicKeyB64]).toBe(true)
    })

    it('leaves ordinary peers unmarked rather than false-advertising them', async () => {
      const url = startCoordinator()
      const plain = makeNode(url)
      const client = makeNode(url)

      const seen: Record<string, boolean | undefined> = {}
      client.node.on('peers', (records) => {
        for (const r of records) seen[r.publicKey] = r.exitNode
      })

      await plain.node.start()
      await client.node.start()
      await until(() => Object.keys(seen).length >= 1)

      expect(seen[plain.node.publicKeyB64]).toBeUndefined()
    })

    it('reflects the claim in the directory the coordinator keeps', async () => {
      const url = startCoordinator()
      const exit = makeNode(url, { exitNode: true })
      const plain = makeNode(url)
      await exit.node.start()
      await plain.node.start()
      await until(() => coordinator!.registeredPeers.length === 2)

      const records = coordinator!.registeredPeers
      expect(records.find(r => r.publicKey === exit.node.publicKeyB64)?.exitNode).toBe(true)
      expect(records.find(r => r.publicKey === plain.node.publicKeyB64)?.exitNode).toBeUndefined()
    })

    it('supports more than one exit node in a network', async () => {
      const url = startCoordinator()
      const a = makeNode(url, { exitNode: true })
      const b = makeNode(url, { exitNode: true })
      await a.node.start()
      await b.node.start()
      await until(() => coordinator!.registeredPeers.length === 2)

      expect(coordinator!.registeredPeers.filter(r => r.exitNode).length).toBe(2)
    })
  })

  it('gives a reconnecting node its original tunnel IP back', async () => {
    const url = startCoordinator()
    const keyPair = generateKeyPair()
    const first = makeNode(url, { keyPair })
    const firstIp = (await first.node.start()).assignedIp

    // Take the node away entirely, then bring the same identity back. The
    // address must follow the key, not the connection order.
    first.node.stop()
    nodes = nodes.filter(n => n !== first.node)
    await until(() => coordinator!.registeredPeers.length === 0)

    const other = makeNode(url)
    await other.node.start()

    const again = makeNode(url, { keyPair })
    expect((await again.node.start()).assignedIp).toBe(firstIp)
  })
})

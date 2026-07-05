import { afterEach, describe, expect, it } from 'bun:test'
import {
  generateKeyPair,
  isVpnAvailable,
  packetDestination,
  packetSource,
  RoutingTable,
  VpnPeer,
} from '../src/vpn'

const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

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

// ── Cryptokey routing (pure logic, no native lib needed) ─────────────────────

describe('vpn/routing', () => {
  it('routes by longest-prefix match', () => {
    const t = new RoutingTable()
    t.addPeer('peerA', ['10.0.0.0/8'])
    t.addPeer('peerB', ['10.1.0.0/16'])
    expect(t.route('10.5.5.5')).toBe('peerA')
    expect(t.route('10.1.2.3')).toBe('peerB') // more specific wins
    expect(t.route('192.168.0.1')).toBeNull()
  })

  it('validates whether a peer may source an address', () => {
    const t = new RoutingTable()
    t.addPeer('peerA', ['100.100.0.2/32'])
    expect(t.isAllowed('peerA', '100.100.0.2')).toBe(true)
    expect(t.isAllowed('peerA', '100.100.0.3')).toBe(false)
  })

  it('removes a peer\'s routes', () => {
    const t = new RoutingTable()
    t.addPeer('peerA', ['10.0.0.0/8'])
    t.removePeer('peerA')
    expect(t.route('10.0.0.1')).toBeNull()
  })

  it('extracts source and destination from an IPv4 packet', () => {
    // Minimal IPv4 header: version/IHL, then src at 12..16, dst at 16..20.
    const pkt = new Uint8Array(20)
    pkt[0] = 0x45
    pkt.set([100, 100, 0, 2], 12)
    pkt.set([100, 100, 0, 3], 16)
    expect(packetSource(pkt)).toBe('100.100.0.2')
    expect(packetDestination(pkt)).toBe('100.100.0.3')
    expect(packetSource(new Uint8Array(4))).toBeNull()
  })
})

// ── Session rekey (needs the native lib) ─────────────────────────────────────

describeVpn('vpn/rekey', () => {
  let peers: VpnPeer[] = []
  afterEach(() => {
    for (const p of peers) p.stop()
    peers = []
  })

  it('rekeys an initiated link and keeps traffic flowing', async () => {
    const aKeys = generateKeyPair()
    const bKeys = generateKeyPair()
    // Short rekey window so the test doesn't wait 2 minutes.
    const a = new VpnPeer({ keyPair: aKeys, host: '127.0.0.1', keepaliveInterval: 0, rekeyAfter: 0.4 })
    const b = new VpnPeer({ keyPair: bKeys, host: '127.0.0.1', keepaliveInterval: 0, rekeyAfter: 0 })
    peers.push(a, b)
    a.addPeer({ publicKey: bKeys.publicKey })
    b.addPeer({ publicKey: aKeys.publicKey })
    await a.start()
    await b.start()

    const links: number[] = []
    a.on('link', l => links.push(l.localIndex))
    a.on('error', () => {})
    b.on('error', () => {})

    const received: string[] = []
    b.on('message', d => received.push(new TextDecoder().decode(d)))

    await a.connect(bKeys.publicKey, '127.0.0.1', b.port)
    expect(links.length).toBe(1)

    // Send across the rekey boundary: a fresh handshake should occur (a second
    // link with a different local index) and traffic must keep arriving.
    for (let i = 0; i < 20; i++) {
      a.send(bKeys.publicKey, new TextEncoder().encode(`m${i}`))
      await sleep(50)
    }

    await until(() => links.length >= 2, 3000)
    expect(links[1]).not.toBe(links[0]) // rekey installed a new session
    // Traffic sent after the rekey still lands.
    a.send(bKeys.publicKey, new TextEncoder().encode('after-rekey'))
    await until(() => received.includes('after-rekey'))
    expect(received.length).toBeGreaterThanOrEqual(20)
  }, 12_000)
})

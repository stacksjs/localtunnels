import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPair, isVpnAvailable, VpnPeer } from '../src/vpn'

// These exercise the real UDP datapath: two VpnPeer nodes bind loopback UDP
// sockets, perform a live WireGuard handshake, and exchange encrypted traffic.
// Skipped when the native libltvpn library isn't built.
const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

if (!available) {
  // eslint-disable-next-line no-console
  console.warn('[vpn.e2e] native libltvpn not built — skipping e2e tests. Run `cd native && zig build`.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Wait until `predicate` holds or `timeoutMs` elapses. */
async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for condition')
    await sleep(10)
  }
}

describeVpn('vpn/e2e over UDP', () => {
  let peers: VpnPeer[] = []

  afterEach(() => {
    for (const p of peers) p.stop()
    peers = []
  })

  async function twoPeers() {
    const aKeys = generateKeyPair()
    const bKeys = generateKeyPair()
    const a = new VpnPeer({ keyPair: aKeys, host: '127.0.0.1', keepaliveInterval: 0 })
    const b = new VpnPeer({ keyPair: bKeys, host: '127.0.0.1', keepaliveInterval: 0 })
    peers.push(a, b)
    a.addPeer({ publicKey: bKeys.publicKey })
    b.addPeer({ publicKey: aKeys.publicKey })
    await a.start()
    await b.start()
    return { a, b, aKeys, bKeys }
  }

  it('completes a handshake and moves messages both directions', async () => {
    const { a, b, aKeys, bKeys } = await twoPeers()
    const atB: string[] = []
    const atA: string[] = []
    b.on('message', d => atB.push(new TextDecoder().decode(d)))
    a.on('message', d => atA.push(new TextDecoder().decode(d)))

    const link = await a.connect(bKeys.publicKey, '127.0.0.1', b.port)
    expect(link.peerIndex).toBeGreaterThan(0)
    expect(link.localIndex).toBeGreaterThan(0)

    a.send(bKeys.publicKey, new TextEncoder().encode('hello bob'))
    await until(() => atB.length >= 1)
    expect(atB[0]).toBe('hello bob')

    b.send(aKeys.publicKey, new TextEncoder().encode('hi alice'))
    await until(() => atA.length >= 1)
    expect(atA[0]).toBe('hi alice')
  })

  it('delivers a burst of messages intact', async () => {
    const { a, b, bKeys } = await twoPeers()
    const received: string[] = []
    b.on('message', d => received.push(new TextDecoder().decode(d)))

    await a.connect(bKeys.publicKey, '127.0.0.1', b.port)
    const sent = Array.from({ length: 250 }, (_, i) => `packet-${i}`)
    for (const m of sent) a.send(bKeys.publicKey, new TextEncoder().encode(m))

    await until(() => received.length >= sent.length, 4000)
    expect(new Set(received)).toEqual(new Set(sent))
  })

  it('carries a large (multi-KB) payload', async () => {
    const { a, b, bKeys } = await twoPeers()
    let got: Uint8Array | null = null
    b.on('message', (d) => { got = d })

    await a.connect(bKeys.publicKey, '127.0.0.1', b.port)
    const big = new Uint8Array(4000)
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xFF
    a.send(bKeys.publicKey, big)

    await until(() => got !== null)
    expect(got!.length).toBe(big.length)
    expect([...got!]).toEqual([...big])
  })

  it('rejects a handshake from an unauthorized peer', async () => {
    const aKeys = generateKeyPair()
    const bKeys = generateKeyPair()
    const stranger = generateKeyPair()

    const a = new VpnPeer({ keyPair: aKeys, host: '127.0.0.1', keepaliveInterval: 0 })
    // Bob only trusts the stranger, not Alice.
    const b = new VpnPeer({ keyPair: bKeys, host: '127.0.0.1', keepaliveInterval: 0 })
    peers.push(a, b)
    a.addPeer({ publicKey: bKeys.publicKey })
    b.addPeer({ publicKey: stranger.publicKey })
    await a.start()
    await b.start()

    let rejected = false
    b.on('error', (err) => {
      if (/unauthorized/.test(err.message))
        rejected = true
    })

    await expect(a.connect(bKeys.publicKey, '127.0.0.1', b.port)).rejects.toThrow(/timed out/)
    expect(rejected).toBe(true)
  }, 10_000)
})

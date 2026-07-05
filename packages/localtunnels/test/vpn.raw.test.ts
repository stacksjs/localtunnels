import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPair, isVpnAvailable, VpnPeer } from '../src/vpn'

const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

if (!available) {
  // eslint-disable-next-line no-console
  console.warn('[vpn.raw] native libltvpn not built — skipping. Run `cd native && zig build`.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out')
    await sleep(10)
  }
}

/** Build a minimal IPv4 packet with a correct total-length field. */
function ipv4(totalLen: number, fill = 0xAB): Uint8Array {
  const pkt = new Uint8Array(totalLen)
  pkt[0] = 0x45 // version 4, IHL 5
  pkt[2] = (totalLen >> 8) & 0xFF
  pkt[3] = totalLen & 0xFF
  pkt[9] = 17 // UDP
  pkt.set([10, 9, 0, 1], 12)
  pkt.set([10, 9, 0, 2], 16)
  for (let i = 20; i < totalLen; i++) pkt[i] = fill
  return pkt
}

/** Build a minimal IPv6 packet with a correct payload-length field. */
function ipv6(payloadLen: number): Uint8Array {
  const pkt = new Uint8Array(40 + payloadLen)
  pkt[0] = 0x60 // version 6
  pkt[4] = (payloadLen >> 8) & 0xFF
  pkt[5] = payloadLen & 0xFF
  pkt[6] = 17 // UDP next header
  for (let i = 40; i < pkt.length; i++) pkt[i] = 0xCD
  return pkt
}

describeVpn('vpn/raw (WireGuard-style IP packet transport)', () => {
  let peers: VpnPeer[] = []
  afterEach(() => {
    for (const p of peers) p.stop()
    peers = []
  })

  async function twoRawPeers() {
    const aKeys = generateKeyPair()
    const bKeys = generateKeyPair()
    const a = new VpnPeer({ keyPair: aKeys, host: '127.0.0.1', keepaliveInterval: 0, raw: true })
    const b = new VpnPeer({ keyPair: bKeys, host: '127.0.0.1', keepaliveInterval: 0, raw: true })
    peers.push(a, b)
    a.addPeer({ publicKey: bKeys.publicKey })
    b.addPeer({ publicKey: aKeys.publicKey })
    await a.start()
    await b.start()
    return { a, b, aKeys, bKeys }
  }

  it('carries IPv4 packets and recovers exact length from the header', async () => {
    const { a, b, bKeys } = await twoRawPeers()
    const got: Uint8Array[] = []
    b.on('message', p => got.push(p))
    await a.connect(bKeys.publicKey, '127.0.0.1', b.port)

    const pkt = ipv4(53) // odd length that won't be a multiple of 16
    a.send(bKeys.publicKey, pkt)
    await until(() => got.length >= 1)
    // The received packet is trimmed back to exactly 53 bytes (no padding).
    expect(got[0].length).toBe(53)
    expect([...got[0]]).toEqual([...pkt])
  })

  it('carries IPv6 packets and recovers length from the header', async () => {
    const { a, b, bKeys } = await twoRawPeers()
    const got: Uint8Array[] = []
    b.on('message', p => got.push(p))
    await a.connect(bKeys.publicKey, '127.0.0.1', b.port)

    const pkt = ipv6(29)
    a.send(bKeys.publicKey, pkt)
    await until(() => got.length >= 1)
    expect(got[0].length).toBe(69) // 40 header + 29 payload
    expect([...got[0]]).toEqual([...pkt])
  })

  it('delivers a burst of varied-size packets intact', async () => {
    const { a, b, bKeys } = await twoRawPeers()
    const got: number[] = []
    b.on('message', p => got.push(p.length))
    await a.connect(bKeys.publicKey, '127.0.0.1', b.port)

    const sizes = [20, 21, 40, 100, 577, 1420]
    for (const s of sizes) a.send(bKeys.publicKey, ipv4(s))
    await until(() => got.length >= sizes.length, 4000)
    expect(got.sort((x, y) => x - y)).toEqual([...sizes].sort((x, y) => x - y))
  })
})

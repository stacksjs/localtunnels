import { afterEach, describe, expect, it } from 'bun:test'
/* eslint-disable node/prefer-global/process */
import {
  configureInterfaceCommands,
  exitNodeCommands,
  generateKeyPair,
  isVpnAvailable,
  packetDestination,
  packetSource,
  packetVersion,
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

  it('routes IPv6 by longest-prefix and keeps families separate', () => {
    const t = new RoutingTable()
    t.addPeer('peerA', ['fd7a::/16'])
    t.addPeer('peerB', ['fd7a:1::/32'])
    t.addPeer('v4', ['10.0.0.0/8'])
    expect(t.route('fd7a:9::9')).toBe('peerA')
    expect(t.route('fd7a:1::5')).toBe('peerB') // more specific wins
    expect(t.route('2001:db8::1')).toBeNull()
    // An IPv6 address must never match an IPv4 route and vice versa.
    expect(t.route('10.1.2.3')).toBe('v4')
    expect(t.route('fd00::1')).toBeNull()
  })

  it('treats 0.0.0.0/0 and ::/0 as exit-node default routes', () => {
    const t = new RoutingTable()
    t.addPeer('lan', ['10.0.0.0/8', 'fd7a::/16'])
    t.addPeer('exit', ['0.0.0.0/0', '::/0'])
    // Specific routes still win; everything else falls to the exit node.
    expect(t.route('10.1.1.1')).toBe('lan')
    expect(t.route('fd7a::2')).toBe('lan')
    expect(t.route('8.8.8.8')).toBe('exit')
    expect(t.route('2606:4700::1111')).toBe('exit')
  })

  it('parses and formats an IPv6 packet address (compressed)', () => {
    const pkt = new Uint8Array(40)
    pkt[0] = 0x60 // version 6
    pkt.set([0xfd, 0x7a, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5], 24) // dst
    expect(packetDestination(pkt)).toBe('fd7a:1::5')
    expect(packetVersion(pkt)).toBe(6)
    // The formatted address round-trips through routing.
    const t = new RoutingTable()
    t.addPeer('p', ['fd7a:1::/32'])
    expect(t.route(packetDestination(pkt)!)).toBe('p')
  })
})

describe('vpn/interface-config', () => {
  const flat = (cmds: string[][]) => cmds.map(c => c.join(' '))

  it('builds IPv4 interface config for the current platform', () => {
    const cmds = flat(configureInterfaceCommands('tun9', '100.100.0.1', '100.100.0.2', 16))
    expect(cmds.some(c => c.includes('100.100.0.1'))).toBe(true)
    if (process.platform === 'darwin')
      expect(cmds.some(c => c.startsWith('ifconfig'))).toBe(true)
    else
      expect(cmds.some(c => c.startsWith('ip addr add 100.100.0.1/16'))).toBe(true)
  })

  it('builds IPv6 interface config (inet6 / ip -6)', () => {
    const cmds = flat(configureInterfaceCommands('tun9', 'fd7a::1', 'fd7a::2', 64))
    if (process.platform === 'darwin')
      expect(cmds.some(c => c.includes('inet6') && c.includes('fd7a::1'))).toBe(true)
    else
      expect(cmds.some(c => c.startsWith('ip -6 addr add fd7a::1/64'))).toBe(true)
  })

  it('builds exit-node forwarding + NAT commands', () => {
    const cmds = flat(exitNodeCommands('tun9', 'eth0'))
    // Kernel forwarding is enabled on every platform.
    expect(cmds.some(c => c.includes('forward') && c.includes('1'))).toBe(true)
    if (process.platform !== 'darwin') {
      expect(cmds.some(c => c.includes('MASQUERADE') && c.includes('eth0'))).toBe(true)
      expect(cmds.some(c => c.includes('FORWARD') && c.includes('tun9'))).toBe(true)
    }
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

  it('drops undersized data/response datagrams without reading out of bounds', async () => {
    const aKeys = generateKeyPair()
    const a = new VpnPeer({ keyPair: aKeys, host: '127.0.0.1', keepaliveInterval: 0, rekeyAfter: 0 })
    peers.push(a)
    await a.start()

    const errors: Error[] = []
    a.on('error', e => errors.push(e))

    // Frames shorter than the fields they'd index into must be dropped, not
    // parsed — previously an unbounded DataView read past the datagram.
    for (const type of [2, 4]) { // MSG_RESPONSE, MSG_DATA
      for (const len of [4, 5, 8, 11, 16, 31]) {
        const frame = new Uint8Array(len)
        frame[0] = type
        expect(() => a.receiveRelayFrame('unknown-peer', frame)).not.toThrow()
      }
    }
    expect(errors).toHaveLength(0)
  })
})

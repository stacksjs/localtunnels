import { describe, expect, it } from 'bun:test'
import { RoutingTable, TunBridge } from '../src/vpn'

// The bridge is deliberately free of native and root dependencies, so these
// run everywhere — no libltvpn, no TUN device, no sudo.

/** Build an IPv4 packet with the given source and destination. */
function ipv4(src: string, dst: string, payload = 8): Uint8Array {
  const pkt = new Uint8Array(20 + payload)
  pkt[0] = 0x45 // version 4, 5-word header
  const total = pkt.length
  pkt[2] = (total >> 8) & 0xFF
  pkt[3] = total & 0xFF
  pkt.set(src.split('.').map(Number), 12)
  pkt.set(dst.split('.').map(Number), 16)
  return pkt
}

interface Fakes {
  bridge: TunBridge
  routes: RoutingTable
  written: Uint8Array[]
  sent: { to: string, packet: Uint8Array }[]
  emitPacket: (p: Uint8Array) => void
  emitMessage: (p: Uint8Array, from: string) => void
}

function harness(opts: { verifySource?: boolean, tunThrows?: boolean, peerThrows?: boolean } = {}): Fakes {
  const written: Uint8Array[] = []
  const sent: { to: string, packet: Uint8Array }[] = []
  let onPacket: ((p: Uint8Array) => void) | null = null
  let onMessage: ((p: Uint8Array, from: string) => void) | null = null

  const tun = {
    write: (p: Uint8Array) => {
      if (opts.tunThrows)
        throw new Error('EMSGSIZE')
      written.push(p)
      return p.length
    },
    on: (_e: 'packet', l: (p: Uint8Array) => void) => { onPacket = l },
  }
  const peer = {
    send: (to: string, packet: Uint8Array) => {
      if (opts.peerThrows)
        throw new Error('no link')
      sent.push({ to, packet })
    },
    on: (_e: 'message', l: (p: Uint8Array, from: string) => void) => { onMessage = l },
  }

  const routes = new RoutingTable()
  const bridge = new TunBridge({ tun, peer, routes, verifySource: opts.verifySource })
  bridge.start()
  return {
    bridge,
    routes,
    written,
    sent,
    emitPacket: p => onPacket?.(p),
    emitMessage: (p, from) => onMessage?.(p, from),
  }
}

describe('vpn/bridge', () => {
  describe('kernel -> peers', () => {
    it('sends a packet to the peer that owns the destination', () => {
      const h = harness()
      h.routes.addPeer('peerA', ['100.100.0.2/32'])
      h.routes.addPeer('peerB', ['100.100.0.3/32'])

      expect(h.bridge.outbound(ipv4('100.100.0.1', '100.100.0.3'))).toBe('ok')
      expect(h.sent.length).toBe(1)
      expect(h.sent[0].to).toBe('peerB')
      expect(h.bridge.stats.toPeers).toBe(1)
    })

    it('drops a packet no peer claims', () => {
      const h = harness()
      h.routes.addPeer('peerA', ['100.100.0.2/32'])

      expect(h.bridge.outbound(ipv4('100.100.0.1', '10.0.0.9'))).toBe('no-route')
      expect(h.sent.length).toBe(0)
      expect(h.bridge.stats.dropped['no-route']).toBe(1)
    })

    it('prefers the longest prefix when routes overlap', () => {
      const h = harness()
      h.routes.addPeer('exit', ['0.0.0.0/0'])
      h.routes.addPeer('direct', ['10.1.2.3/32'])

      expect(h.bridge.outbound(ipv4('100.100.0.1', '10.1.2.3'))).toBe('ok')
      expect(h.sent[0].to).toBe('direct')
      expect(h.bridge.outbound(ipv4('100.100.0.1', '93.184.216.34'))).toBe('ok')
      expect(h.sent[1].to).toBe('exit')
    })

    it('counts a send with no link as dropped, not sent', () => {
      const h = harness({ peerThrows: true })
      h.routes.addPeer('peerA', ['100.100.0.2/32'])

      expect(h.bridge.outbound(ipv4('100.100.0.1', '100.100.0.2'))).toBe('send-failed')
      expect(h.bridge.stats.toPeers).toBe(0)
      expect(h.bridge.stats.dropped['send-failed']).toBe(1)
    })

    it('drops a runt instead of parsing past its end', () => {
      const h = harness()
      h.routes.addPeer('exit', ['0.0.0.0/0'])
      expect(h.bridge.outbound(new Uint8Array([0x45, 0, 0]))).toBe('malformed')
      expect(h.bridge.stats.dropped.malformed).toBe(1)
    })
  })

  describe('peers -> kernel', () => {
    it('writes a packet whose source the sender owns', () => {
      const h = harness()
      h.routes.addPeer('peerA', ['100.100.0.2/32'])

      expect(h.bridge.inbound(ipv4('100.100.0.2', '100.100.0.1'), 'peerA')).toBe('ok')
      expect(h.written.length).toBe(1)
      expect(h.bridge.stats.toKernel).toBe(1)
    })

    it('drops a peer sourcing an address it was never granted', () => {
      const h = harness()
      h.routes.addPeer('peerA', ['100.100.0.2/32'])
      h.routes.addPeer('peerB', ['100.100.0.3/32'])

      // peerA claims to be peerB.
      expect(h.bridge.inbound(ipv4('100.100.0.3', '100.100.0.1'), 'peerA')).toBe('spoofed')
      // ...and claims to be a host off the tunnel entirely.
      expect(h.bridge.inbound(ipv4('8.8.8.8', '100.100.0.1'), 'peerA')).toBe('spoofed')
      expect(h.written.length).toBe(0)
      expect(h.bridge.stats.dropped.spoofed).toBe(2)
    })

    it('accepts internet sources from an exit node, since it owns the default route', () => {
      const h = harness()
      // What a client routing everything through its server looks like.
      h.routes.addPeer('server', ['0.0.0.0/0'])

      expect(h.bridge.inbound(ipv4('93.184.216.34', '10.8.0.2'), 'server')).toBe('ok')
      expect(h.bridge.inbound(ipv4('1.1.1.1', '10.8.0.2'), 'server')).toBe('ok')
      expect(h.bridge.stats.toKernel).toBe(2)
      expect(h.bridge.stats.dropped.spoofed).toBe(0)
    })

    it('can be told not to verify, and then forwards a spoofed source', () => {
      const h = harness({ verifySource: false })
      h.routes.addPeer('peerA', ['100.100.0.2/32'])

      expect(h.bridge.inbound(ipv4('8.8.8.8', '100.100.0.1'), 'peerA')).toBe('ok')
      expect(h.written.length).toBe(1)
    })

    it('counts a rejected interface write as dropped', () => {
      const h = harness({ tunThrows: true })
      h.routes.addPeer('peerA', ['100.100.0.2/32'])

      expect(h.bridge.inbound(ipv4('100.100.0.2', '100.100.0.1'), 'peerA')).toBe('write-failed')
      expect(h.bridge.stats.toKernel).toBe(0)
      expect(h.bridge.stats.dropped['write-failed']).toBe(1)
    })

    it('drops a packet with no parseable source', () => {
      const h = harness()
      h.routes.addPeer('peerA', ['0.0.0.0/0'])
      expect(h.bridge.inbound(new Uint8Array(4), 'peerA')).toBe('malformed')
      expect(h.bridge.stats.dropped.malformed).toBe(1)
    })

    it('stops trusting a peer once its routes are removed', () => {
      const h = harness()
      h.routes.addPeer('peerA', ['100.100.0.2/32'])
      expect(h.bridge.inbound(ipv4('100.100.0.2', '100.100.0.1'), 'peerA')).toBe('ok')

      h.routes.removePeer('peerA')
      expect(h.bridge.inbound(ipv4('100.100.0.2', '100.100.0.1'), 'peerA')).toBe('spoofed')
    })
  })

  describe('wiring', () => {
    it('carries traffic in both directions through the listeners', () => {
      const h = harness()
      h.routes.addPeer('peerA', ['100.100.0.2/32'])

      h.emitPacket(ipv4('100.100.0.1', '100.100.0.2'))
      h.emitMessage(ipv4('100.100.0.2', '100.100.0.1'), 'peerA')

      expect(h.sent.length).toBe(1)
      expect(h.written.length).toBe(1)
    })

    it('start() twice does not double-deliver', () => {
      const h = harness()
      h.routes.addPeer('peerA', ['100.100.0.2/32'])
      h.bridge.start()

      h.emitPacket(ipv4('100.100.0.1', '100.100.0.2'))
      expect(h.sent.length).toBe(1)
    })
  })
})

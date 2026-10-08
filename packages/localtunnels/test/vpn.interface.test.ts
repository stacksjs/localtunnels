import type { PeerRecord } from '../src/vpn'
import { describe, expect, it } from 'bun:test'
import { generateKeyPair, isVpnAvailable, tunnelGateway, VpnInterface } from '../src/vpn'

// Bringing an interface up needs root, so these cover the parts that decide
// what the interface will be: address arithmetic and route reconciliation
// against a coordinator directory. No TUN device, no sudo.
const available = isVpnAvailable()

function record(publicKey: string, assignedIp: string): PeerRecord {
  return { publicKey, assignedIp, endpoint: { host: '203.0.113.7', port: 51820 } }
}

/** A VpnInterface that has not been brought up — enough for routing policy. */
function iface(): VpnInterface {
  return new VpnInterface({
    keyPair: available ? generateKeyPair() : ({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) } as any),
    coordinatorUrl: 'ws://127.0.0.1:1',
  })
}

describe('vpn/interface', () => {
  describe('configuration', () => {
    it('refuses to exist without either a coordinator or an address', () => {
      const keyPair = { publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) } as any
      expect(() => new VpnInterface({ keyPair })).toThrow(/coordinatorUrl or a static address/)
    })

    it('accepts a static address alone, and a coordinator alone', () => {
      const keyPair = { publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) } as any
      expect(() => new VpnInterface({ keyPair, address: '10.8.0.2/24' })).not.toThrow()
      expect(() => new VpnInterface({ keyPair, coordinatorUrl: 'ws://x:1' })).not.toThrow()
    })

    it('reports nothing until it is up', () => {
      const vpn = iface()
      expect(vpn.name).toBeNull()
      expect(vpn.address).toBeNull()
      expect(vpn.stats).toBeNull()
    })
  })

  describe('point-to-point address', () => {
    it('is the first host of the enclosing network', () => {
      expect(tunnelGateway('10.8.0.2', 24)).toBe('10.8.0.1')
      expect(tunnelGateway('100.100.0.7', 16)).toBe('100.100.0.1')
      expect(tunnelGateway('192.168.40.99', 20)).toBe('192.168.32.1')
    })

    it('is stable for the gateway itself', () => {
      expect(tunnelGateway('10.8.0.1', 24)).toBe('10.8.0.1')
    })

    it('hands back an IPv6 address unchanged, since utun takes no v6 remote', () => {
      expect(tunnelGateway('fd7a::2', 64)).toBe('fd7a::2')
    })
  })

  describe('directory reconciliation', () => {
    it('routes each discovered peer its own assigned address', () => {
      const vpn = iface()
      vpn.applyDirectory([record('peerA', '100.100.0.3'), record('peerB', '100.100.0.4')])

      expect(vpn.routes.route('100.100.0.3')).toBe('peerA')
      expect(vpn.routes.route('100.100.0.4')).toBe('peerB')
      // A peer is routed its address and nothing wider.
      expect(vpn.routes.route('100.100.0.5')).toBeNull()
    })

    it('announces each peer once, however often the directory repeats', () => {
      const vpn = iface()
      const added: string[] = []
      vpn.on('peerAdded', p => added.push(p.publicKey))

      const dir = [record('peerA', '100.100.0.3')]
      vpn.applyDirectory(dir)
      vpn.applyDirectory(dir)
      vpn.applyDirectory([...dir, record('peerB', '100.100.0.4')])

      expect(added).toEqual(['peerA', 'peerB'])
      expect(vpn.routes.route('100.100.0.3')).toBe('peerA')
    })

    it('withdraws the routes of a peer that left', () => {
      const vpn = iface()
      const removed: string[] = []
      vpn.on('peerRemoved', p => removed.push(p.publicKey))

      vpn.applyDirectory([record('peerA', '100.100.0.3'), record('peerB', '100.100.0.4')])
      vpn.applyDirectory([record('peerA', '100.100.0.3')])

      expect(removed).toEqual(['peerB'])
      expect(vpn.routes.route('100.100.0.4')).toBeNull()
      expect(vpn.routes.route('100.100.0.3')).toBe('peerA')
    })

    it('empties the table when everyone leaves', () => {
      const vpn = iface()
      vpn.applyDirectory([record('peerA', '100.100.0.3'), record('peerB', '100.100.0.4')])
      vpn.applyDirectory([])

      expect(vpn.routes.route('100.100.0.3')).toBeNull()
      expect(vpn.routes.route('100.100.0.4')).toBeNull()
    })

    it('re-admits a peer that comes back', () => {
      const vpn = iface()
      vpn.applyDirectory([record('peerA', '100.100.0.3')])
      vpn.applyDirectory([])
      vpn.applyDirectory([record('peerA', '100.100.0.3')])

      expect(vpn.routes.route('100.100.0.3')).toBe('peerA')
    })

    it('follows a peer that left and returned on a new address', () => {
      const vpn = iface()
      vpn.applyDirectory([record('peerA', '100.100.0.3')])
      vpn.applyDirectory([])
      vpn.applyDirectory([record('peerA', '100.100.0.9')])

      expect(vpn.routes.route('100.100.0.9')).toBe('peerA')
      expect(vpn.routes.route('100.100.0.3')).toBeNull()
    })

    it('follows a peer reassigned in place, without an intervening absence', () => {
      const vpn = iface()
      vpn.applyDirectory([record('peerA', '100.100.0.3')])
      // What a coordinator restart looks like from here: the same peer, still
      // listed, on a freshly issued address. Keying only on the public key
      // would treat this as "already routed" and keep the stale entry, so .9
      // would resolve to nobody while .3 still resolved to a peer that moved
      // — and the peer could still source .3 inbound but not its real address.
      vpn.applyDirectory([record('peerA', '100.100.0.9')])

      expect(vpn.routes.route('100.100.0.9')).toBe('peerA')
      expect(vpn.routes.route('100.100.0.3')).toBeNull()
      expect(vpn.routes.isAllowed('peerA', '100.100.0.9')).toBe(true)
      expect(vpn.routes.isAllowed('peerA', '100.100.0.3')).toBe(false)
    })

    it('re-announces a peer whose address changed', () => {
      const vpn = iface()
      const added: { publicKey: string, allowedIps: string[] }[] = []
      vpn.on('peerAdded', p => added.push(p))

      vpn.applyDirectory([record('peerA', '100.100.0.3')])
      vpn.applyDirectory([record('peerA', '100.100.0.3')])
      vpn.applyDirectory([record('peerA', '100.100.0.9')])

      expect(added.map(a => a.allowedIps[0])).toEqual(['100.100.0.3/32', '100.100.0.9/32'])
    })
  })
})

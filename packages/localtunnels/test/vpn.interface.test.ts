import type { PeerRecord } from '../src/vpn'
import { describe, expect, it } from 'bun:test'
import { generateKeyPair, isVpnAvailable, tunnelGateway, VpnInterface } from '../src/vpn'

// Bringing an interface up needs root, so these cover the parts that decide
// what the interface will be: address arithmetic and route reconciliation
// against a coordinator directory. No TUN device, no sudo.
const available = isVpnAvailable()

function record(publicKey: string, assignedIp: string, exitNode?: boolean): PeerRecord {
  return {
    publicKey,
    assignedIp,
    endpoint: { host: '203.0.113.7', port: 51820 },
    ...(exitNode ? { exitNode: true } : {}),
  }
}

/** A VpnInterface that has not been brought up — enough for routing policy. */
function iface(useExit?: string | 'auto'): VpnInterface {
  return new VpnInterface({
    keyPair: available ? generateKeyPair() : ({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) } as any),
    coordinatorUrl: 'ws://127.0.0.1:1',
    useExit,
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

  describe('exit nodes', () => {
    it('installs no default route when none was asked for', () => {
      const vpn = iface()
      vpn.applyDirectory([record('gateway', '100.100.0.3', true)])

      expect(vpn.exitNode).toBeNull()
      // Internet-bound traffic has nowhere to go, which is the point: it is
      // dropped rather than leaking out of the host's own default interface.
      expect(vpn.routes.route('93.184.216.34')).toBeNull()
      expect(vpn.routes.route('100.100.0.3')).toBe('gateway')
    })

    it('routes everything through an advertised exit on auto', () => {
      const vpn = iface('auto')
      vpn.applyDirectory([record('gateway', '100.100.0.3', true), record('plain', '100.100.0.4')])

      expect(vpn.exitNode).toBe('gateway')
      expect(vpn.routes.route('93.184.216.34')).toBe('gateway')
      // A tunnel peer still goes direct: longest prefix beats the default.
      expect(vpn.routes.route('100.100.0.4')).toBe('plain')
      expect(vpn.routes.route('100.100.0.3')).toBe('gateway')
    })

    it('ignores peers that do not advertise, on auto', () => {
      const vpn = iface('auto')
      vpn.applyDirectory([record('plain', '100.100.0.4')])

      expect(vpn.exitNode).toBeNull()
      expect(vpn.routes.route('93.184.216.34')).toBeNull()
    })

    it('picks the same exit every time when several advertise', () => {
      const a = iface('auto')
      const b = iface('auto')
      const dir = [record('zzz', '100.100.0.3', true), record('aaa', '100.100.0.4', true)]
      a.applyDirectory(dir)
      b.applyDirectory([...dir].reverse())

      // Order of arrival must not decide whose hands the traffic passes through.
      expect(a.exitNode).toBe('aaa')
      expect(b.exitNode).toBe('aaa')
    })

    it('honours a pinned key', () => {
      const vpn = iface('zzz')
      vpn.applyDirectory([record('zzz', '100.100.0.3', true), record('aaa', '100.100.0.4', true)])

      // Pinned beats the sort order auto would have used.
      expect(vpn.exitNode).toBe('zzz')
      expect(vpn.routes.route('93.184.216.34')).toBe('zzz')
    })

    it('honours a pinned key even when it does not advertise', () => {
      const vpn = iface('plain')
      vpn.applyDirectory([record('plain', '100.100.0.4')])

      expect(vpn.exitNode).toBe('plain')
      expect(vpn.routes.route('93.184.216.34')).toBe('plain')
    })

    it('installs nothing for a pinned key that is absent', () => {
      const vpn = iface('missing')
      vpn.applyDirectory([record('plain', '100.100.0.4')])

      expect(vpn.exitNode).toBeNull()
      expect(vpn.routes.route('93.184.216.34')).toBeNull()
    })

    it('moves the default route when the exit leaves, without stranding the rest', () => {
      const vpn = iface('auto')
      const changes: (string | null)[] = []
      vpn.on('exitChanged', e => changes.push(e.publicKey))

      vpn.applyDirectory([record('first', '100.100.0.3', true), record('second', '100.100.0.4', true)])
      expect(vpn.exitNode).toBe('first')

      vpn.applyDirectory([record('second', '100.100.0.4', true)])

      expect(changes).toEqual(['first', 'second'])
      expect(vpn.routes.route('93.184.216.34')).toBe('second')
      // The new exit keeps its own address alongside the default route.
      expect(vpn.routes.route('100.100.0.4')).toBe('second')
      // The departed peer's address no longer has a route of its own, so it
      // falls to the default like any other unclaimed address. This is what a
      // 0.0.0.0/0 route means, and matches WireGuard with AllowedIPs=0.0.0.0/0
      // — the specific route is gone, not shadowed.
      expect(vpn.routes.route('100.100.0.3')).toBe('second')
      expect(vpn.routes.isAllowed('first', '100.100.0.3')).toBe(false)
    })

    it('withdraws the default route when a peer stops advertising', () => {
      const vpn = iface('auto')
      vpn.applyDirectory([record('gateway', '100.100.0.3', true)])
      expect(vpn.routes.route('93.184.216.34')).toBe('gateway')

      // Still present, no longer offering.
      vpn.applyDirectory([record('gateway', '100.100.0.3')])

      expect(vpn.exitNode).toBeNull()
      expect(vpn.routes.route('93.184.216.34')).toBeNull()
      // ...but it is still a reachable peer.
      expect(vpn.routes.route('100.100.0.3')).toBe('gateway')
    })

    it('does not re-announce an unchanged exit', () => {
      const vpn = iface('auto')
      const changes: (string | null)[] = []
      vpn.on('exitChanged', e => changes.push(e.publicKey))

      const dir = [record('gateway', '100.100.0.3', true)]
      vpn.applyDirectory(dir)
      vpn.applyDirectory(dir)
      vpn.applyDirectory([...dir, record('plain', '100.100.0.4')])

      expect(changes).toEqual(['gateway'])
    })

    it('lets the exit source any address inbound, since it owns the default route', () => {
      const vpn = iface('auto')
      vpn.applyDirectory([record('gateway', '100.100.0.3', true), record('plain', '100.100.0.4')])

      // Replies from the internet arrive from the exit and must verify.
      expect(vpn.routes.isAllowed('gateway', '93.184.216.34')).toBe(true)
      // An ordinary peer still cannot claim to be the internet.
      expect(vpn.routes.isAllowed('plain', '93.184.216.34')).toBe(false)
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

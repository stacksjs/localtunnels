import { describe, expect, it } from 'bun:test'
import { inTunnelRange, parseIfconfig } from '../src/vpn/core'
import { DEFAULT_REGION, REGIONS, regionById } from '../src/regions'

/** Trimmed from real `ifconfig` output on a Mac with Private Relay running. */
const IFCONFIG = `lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
	inet 127.0.0.1 netmask 0xff000000
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	inet 192.168.1.42 netmask 0xffffff00 broadcast 192.168.1.255
utun0: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1500
	inet6 fe80::ce81:b1c:bd2c:69e%utun0 prefixlen 64 scopeid 0xe
utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1420
	inet 100.100.0.3 --> 100.100.0.1 netmask 0xffffffff
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1500
	inet 10.9.0.4 netmask 0xffffff00
`

describe('parseIfconfig', () => {
  const tunnels = parseIfconfig(IFCONFIG)

  it('lists only tunnel devices that carry an IPv4 address', () => {
    expect(tunnels.map(t => t.name)).toEqual(['utun3', 'utun4'])
  })

  // The utun devices macOS keeps for iCloud Private Relay carry only
  // link-local IPv6. Listing them would show every Mac as having tunnels it
  // did not ask for.
  it('ignores an IPv6-only tunnel', () => {
    expect(tunnels.find(t => t.name === 'utun0')).toBeUndefined()
  })

  it('ignores ethernet and loopback', () => {
    expect(tunnels.find(t => t.name === 'en0' || t.name === 'lo0')).toBeUndefined()
  })

  it('reads the point-to-point peer and the MTU', () => {
    const tunnel = tunnels.find(t => t.name === 'utun3')!
    expect(tunnel.address).toBe('100.100.0.3')
    expect(tunnel.peer).toBe('100.100.0.1')
    expect(tunnel.mtu).toBe(1420)
  })

  it('leaves the peer null when the interface has none', () => {
    expect(tunnels.find(t => t.name === 'utun4')!.peer).toBeNull()
  })

  it('marks only addresses in a range localtunnels assigns', () => {
    expect(tunnels.find(t => t.name === 'utun3')!.localtunnelsRange).toBe(true)
    // 10.9.0.4 is somebody else's tunnel: ours is 10.8.0.0/24.
    expect(tunnels.find(t => t.name === 'utun4')!.localtunnelsRange).toBe(false)
  })

  it('returns nothing for empty output', () => {
    expect(parseIfconfig('')).toEqual([])
  })
})

describe('inTunnelRange', () => {
  it('accepts the coordinator range', () => {
    // 100.64.0.0/10 is RFC 6598 carrier-grade NAT space, which is where the
    // coordinator allocates from.
    expect(inTunnelRange('100.64.0.0')).toBe(true)
    expect(inTunnelRange('100.100.0.7')).toBe(true)
    expect(inTunnelRange('100.127.255.255')).toBe(true)
  })

  it('rejects addresses just outside it', () => {
    expect(inTunnelRange('100.63.255.255')).toBe(false)
    expect(inTunnelRange('100.128.0.0')).toBe(false)
  })

  it('accepts the deploy range and rejects its neighbours', () => {
    expect(inTunnelRange('10.8.0.1')).toBe(true)
    expect(inTunnelRange('10.9.0.1')).toBe(false)
  })

  it('rejects ordinary LAN and public addresses', () => {
    for (const address of ['192.168.1.1', '10.0.0.1', '8.8.8.8', '127.0.0.1'])
      expect(inTunnelRange(address)).toBe(false)
  })

  it('rejects anything that is not an IPv4 address', () => {
    for (const value of ['', 'nonsense', '1.2.3', '1.2.3.4.5', '999.1.1.1', 'fe80::1'])
      expect(inTunnelRange(value)).toBe(false)
  })
})

describe('regions', () => {
  it('offers the two the deploy can provision', () => {
    expect(REGIONS.map(r => r.id)).toEqual(['us-west', 'eu-central'])
  })

  it('defaults to one that exists', () => {
    expect(regionById(DEFAULT_REGION)).not.toBeNull()
  })

  it('gives every region a two-letter badge and somewhere to be', () => {
    for (const region of REGIONS) {
      expect(region.badge).toMatch(/^[A-Z]{2}$/)
      expect(region.country.length).toBeGreaterThan(0)
      expect(region.city.length).toBeGreaterThan(0)
    }
  })

  it('returns null for a region nobody offers', () => {
    expect(regionById('mars-north')).toBeNull()
  })
})

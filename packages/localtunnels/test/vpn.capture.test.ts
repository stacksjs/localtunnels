import { describe, expect, it } from 'bun:test'
import {
  parseDnsServers,
  parseGateway,
  parseNetworkServices,
  readRestore,
} from '../src/vpn/capture'

describe('parseGateway', () => {
  it('reads the macOS block', () => {
    const output = `   route to: default
destination: default
       mask: default
    gateway: 192.168.1.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
`
    expect(parseGateway(output)).toEqual({ gateway: '192.168.1.1', iface: 'en0' })
  })

  it('reads the Linux line', () => {
    const output = 'default via 10.0.2.2 dev eth0 proto dhcp src 10.0.2.15 metric 100\n'
    expect(parseGateway(output)).toEqual({ gateway: '10.0.2.2', iface: 'eth0' })
  })

  it('copes with a Linux default route that names no device', () => {
    expect(parseGateway('default via 10.0.2.2\n')).toEqual({ gateway: '10.0.2.2', iface: null })
  })

  // A machine with no route to anywhere cannot pin the tunnel's own packets,
  // and guessing a gateway would send them into the tunnel they carry.
  it('returns null when there is no default route', () => {
    for (const output of ['', 'route: writing to routing socket: not in table\n', 'nonsense'])
      expect(parseGateway(output)).toBeNull()
  })
})

describe('parseNetworkServices', () => {
  const output = `An asterisk (*) denotes that a network service is disabled.
Wi-Fi
Thunderbolt Bridge
*Bluetooth PAN
iPhone USB
`

  it('drops the header line', () => {
    expect(parseNetworkServices(output)).not.toContain('An asterisk (*) denotes that a network service is disabled.')
  })

  // Setting DNS on a disabled service fails, and a failed command while
  // bringing a tunnel up looks exactly like a tunnel that cannot come up.
  it('skips disabled services', () => {
    expect(parseNetworkServices(output)).toEqual(['Wi-Fi', 'Thunderbolt Bridge', 'iPhone USB'])
  })

  it('returns nothing for empty output', () => {
    expect(parseNetworkServices('')).toEqual([])
  })
})

describe('parseDnsServers', () => {
  it('reads a list of resolvers', () => {
    expect(parseDnsServers('1.1.1.1\n8.8.8.8\n')).toEqual(['1.1.1.1', '8.8.8.8'])
  })

  it('reads IPv6 resolvers', () => {
    expect(parseDnsServers('2606:4700:4700::1111\n')).toEqual(['2606:4700:4700::1111'])
  })

  // The difference between "no resolvers" and "on DHCP" is the difference
  // between restoring nothing and restoring DHCP, so the sentence has to be
  // recognised rather than parsed as an address.
  it('reports DHCP as null rather than as an empty list', () => {
    expect(parseDnsServers(`There aren't any DNS Servers set on Wi-Fi.\n`)).toBeNull()
    expect(parseDnsServers('')).toBeNull()
  })
})

describe('readRestore', () => {
  it('returns nothing when there is no file', () => {
    const previous = process.env.LOCALTUNNELS_HOME
    process.env.LOCALTUNNELS_HOME = '/nonexistent/localtunnels-test'
    try {
      expect(readRestore()).toEqual([])
    }
    finally {
      if (previous === undefined) delete process.env.LOCALTUNNELS_HOME
      else process.env.LOCALTUNNELS_HOME = previous
    }
  })
})

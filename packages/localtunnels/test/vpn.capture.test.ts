import { describe, expect, it } from 'bun:test'
import {
  parseCoordinatorUrl,
  parseDnsServers,
  parseGateway,
  parseIpv6Setting,
  parseNetworkServices,
  readRestore,
  resolveCoordinator,
} from '../src/vpn/capture'

/*
 * The kill switch needs the coordinator's address before it arms, because
 * afterwards DNS runs through the tunnel. Getting this wrong is not a failed
 * connect: the heartbeats stop leaving, the directory drops the node about
 * two minutes later, and the exit node withdraws the route while every log
 * line still says the link is up.
 */
describe('parseCoordinatorUrl', () => {
  it('reads the host and port out of a ws url', () => {
    expect(parseCoordinatorUrl('ws://5.78.208.190:51821')).toEqual({ host: '5.78.208.190', port: 51821 })
  })

  it('defaults the port per scheme when the url omits one', () => {
    expect(parseCoordinatorUrl('ws://coordinator.example')).toEqual({ host: 'coordinator.example', port: 80 })
    expect(parseCoordinatorUrl('wss://coordinator.example')).toEqual({ host: 'coordinator.example', port: 443 })
  })

  it('unwraps a bracketed v6 literal, which is not a matchable address', () => {
    expect(parseCoordinatorUrl('ws://[2001:db8::1]:51821')).toEqual({ host: '2001:db8::1', port: 51821 })
  })

  it('returns null rather than a half-parsed address', () => {
    expect(parseCoordinatorUrl('not a url')).toBeNull()
    expect(parseCoordinatorUrl('')).toBeNull()
  })
})

describe('resolveCoordinator', () => {
  it('passes an address through without a lookup', async () => {
    expect(await resolveCoordinator('ws://5.78.208.190:51821')).toEqual({ ip: '5.78.208.190', port: 51821 })
  })

  /*
   * Null, not a throw, and not a guess. The caller decides what it means —
   * and under a kill switch it refuses the connect, because a tunnel that
   * cannot reach its coordinator has about two minutes to live.
   */
  it('reports a name it cannot resolve as unresolved', async () => {
    expect(await resolveCoordinator('ws://coordinator.invalid:51821')).toBeNull()
  })
})

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

describe('parseIpv6Setting', () => {
  // Real `networksetup -getinfo "Wi-Fi"` output.
  const info = `DHCP Configuration
IP address: 192.168.254.194
Subnet mask: 255.255.255.0
Router: 192.168.254.254
IPv6: Automatic
IPv6 IP address: none
IPv6 Router: none
Wi-Fi ID: 5c:e9:1e:ac:75:49
`

  it('reads the mode out of a real getinfo block', () => {
    expect(parseIpv6Setting(info)).toBe('automatic')
  })

  it('reads the other restorable modes', () => {
    expect(parseIpv6Setting('IPv6: Off\n')).toBe('off')
    expect(parseIpv6Setting('IPv6: Link-local only\n')).toBe('linklocal')
  })

  /*
   * A manually configured service needs its address, prefix and router to put
   * back, and none of that is in this output. Returning null leaves that
   * service alone — a VPN that forgets a hand-configured address is worse
   * than one that declines to touch it.
   */
  it('refuses a mode it could not restore faithfully', () => {
    expect(parseIpv6Setting('IPv6: Manual\n')).toBeNull()
    expect(parseIpv6Setting('IPv6: Something New\n')).toBeNull()
  })

  it('returns null when the block says nothing about IPv6', () => {
    expect(parseIpv6Setting('IP address: 10.0.0.2\n')).toBeNull()
    expect(parseIpv6Setting('')).toBeNull()
  })

  // `IPv6 IP address:` and `IPv6 Router:` also begin with IPv6 and would
  // match a looser pattern, giving a mode of "none".
  it('does not mistake the neighbouring IPv6 lines for the mode', () => {
    expect(parseIpv6Setting(info)).not.toBe('none')
  })
})

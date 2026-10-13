import { describe, expect, it } from 'bun:test'
import process from 'node:process'
import {
  defaultRouteCommands,
  dnsCommands,
  ipv6Commands,
  killSwitchCommands,
  PF_ANCHOR_NAME,
  pfRules,
  shellQuote,
} from '../src/vpn/fulltunnel'

const darwin = process.platform === 'darwin'
const flat = (commands: string[][]) => commands.map(c => c.join(' '))

describe('defaultRouteCommands', () => {
  const config = { tun: 'utun7', endpointIp: '203.0.113.9', gateway: '192.168.1.1', wanInterface: 'eth0' }
  const { up, down } = defaultRouteCommands(config)

  it('captures everything with two halves rather than one default', () => {
    // Both are longer prefixes than 0.0.0.0/0, so they win longest-prefix
    // matching while the real default route survives underneath — teardown
    // then deletes what we added instead of rebuilding what we destroyed.
    const text = flat(up).join('\n')
    expect(text).toContain('0.0.0.0/1')
    expect(text).toContain('128.0.0.0/1')
    expect(text).not.toContain('0.0.0.0/0')
  })

  it('never deletes the existing default route', () => {
    for (const command of flat(up).concat(flat(down)))
      expect(command).not.toMatch(/(delete|del)\s+default/)
  })

  it('pins the server to the physical gateway before capturing', () => {
    // Otherwise the tunnel's own packets route into the tunnel: encrypted,
    // addressed to the server, and handed back to the encryptor.
    const text = flat(up)
    const hole = text.findIndex(line => line.includes('203.0.113.9') && line.includes('192.168.1.1'))
    const capture = text.findIndex(line => line.includes('0.0.0.0/1'))
    expect(hole).toBeGreaterThanOrEqual(0)
    expect(hole).toBeLessThan(capture)
  })

  it('fills the hole only after releasing the capture', () => {
    const text = flat(down)
    const capture = text.findIndex(line => line.includes('0.0.0.0/1'))
    const hole = text.findIndex(line => line.includes('203.0.113.9') && line.includes('192.168.1.1'))
    expect(capture).toBeLessThan(hole)
  })

  it('undoes exactly what it did', () => {
    expect(down.length).toBe(up.length)
  })

  it('sends the halves to the tunnel interface', () => {
    for (const line of flat(up).filter(l => l.includes('0.0.0.0/1') || l.includes('128.0.0.0/1')))
      expect(line).toContain('utun7')
  })
})

describe('dnsCommands', () => {
  it('points the resolver at the tunnel and restores what was there', () => {
    if (!darwin) {
      const { up, down } = dnsCommands({ servers: ['100.100.0.1'] })
      expect(flat(up).join('\n')).toContain('nameserver 100.100.0.1')
      expect(flat(down).join('\n')).toContain('/etc/resolv.conf')
      return
    }

    const { up, down } = dnsCommands({
      servers: ['100.100.0.1'],
      services: [
        { name: 'Wi-Fi', previous: ['1.1.1.1'] },
        { name: 'Thunderbolt Bridge', previous: null },
      ],
    })

    expect(flat(up)).toEqual([
      'networksetup -setdnsservers Wi-Fi 100.100.0.1',
      'networksetup -setdnsservers Thunderbolt Bridge 100.100.0.1',
    ])
    // `Empty` is how networksetup spells "back to DHCP"; an empty argument
    // list would be read as a request to clear nothing.
    expect(flat(down)).toEqual([
      'networksetup -setdnsservers Wi-Fi 1.1.1.1',
      'networksetup -setdnsservers Thunderbolt Bridge Empty',
    ])
  })

  it('touches nothing when no service was named', () => {
    if (!darwin) return
    expect(dnsCommands({ servers: ['100.100.0.1'] })).toEqual({ up: [], down: [] })
  })
})

describe('pfRules', () => {
  const rules = pfRules({ tun: 'utun7', endpointIp: '203.0.113.9', endpointPort: 51820 })

  it('blocks outbound traffic by default', () => {
    expect(rules).toContain('block drop out on ! lo0 all')
    // The block has to come first: `quick` passes below it are the
    // exceptions, and a block written last would override all of them.
    expect(rules.indexOf('block drop out on ! lo0 all')).toBeLessThan(rules.indexOf('pass out quick'))
  })

  it('lets the tunnel, loopback and the server through', () => {
    expect(rules).toContain('pass out quick on utun7 all')
    expect(rules).toContain('pass out quick on lo0 all')
    expect(rules).toContain('pass out quick proto udp to 203.0.113.9 port 51820')
  })

  it('keeps DHCP alive, so the link does not drop mid-session', () => {
    expect(rules).toContain('port 68 to any port 67')
  })

  it('marks every pass quick, or the block would win', () => {
    for (const line of rules.split('\n').filter(l => l.startsWith('pass')))
      expect(line).toContain('quick')
  })

  it('keeps the local network out unless asked', () => {
    expect(rules).not.toContain('192.168.0.0/16')
    const lan = pfRules({ tun: 'utun7', endpointIp: '203.0.113.9', endpointPort: 51820, allowLan: true })
    expect(lan).toContain('pass out quick to 192.168.0.0/16')
    expect(lan).toContain('pass out quick to 10.0.0.0/8')
  })
})

describe('killSwitchCommands', () => {
  const config = { tun: 'utun7', endpointIp: '203.0.113.9', endpointPort: 51820 }
  const { up, down } = killSwitchCommands(config)

  it('leaves the system able to reach the server', () => {
    expect(flat(up).join('\n')).toContain('203.0.113.9')
  })

  if (darwin) {
    it('keeps Apple’s own anchors by appending to pf.conf', () => {
      const text = flat(up).join('\n')
      expect(text).toContain('>> /etc/pf.conf')
      // A truncating redirect, not an appending one. `>>` ends in `>`, so
      // this has to look at the character before it rather than search for a
      // substring that the correct form also contains.
      expect(text).not.toMatch(/[^>]> \/etc\/pf\.conf(?!\.)/)
    })

    it('backs pf.conf up once, so a second connect cannot poison the backup', () => {
      expect(flat(up).join('\n')).toContain('[ -f /etc/pf.conf.localtunnels ] ||')
    })

    it('does not append its anchor twice', () => {
      expect(flat(up).join('\n')).toContain('grep -q')
    })

    it('restores pf.conf and flushes the anchor on the way down', () => {
      const text = flat(down).join('\n')
      expect(text).toContain('/etc/pf.conf.localtunnels')
      expect(text).toContain(`pfctl -a ${PF_ANCHOR_NAME} -F rules`)
    })
  }
  else {
    it('builds its rules in a chain of its own', () => {
      // A named chain can be removed exactly, without reasoning about what
      // else was inserted into OUTPUT since, or at which index.
      expect(flat(up)).toContain('iptables -N LT_KILLSWITCH')
      // The chain is hooked into OUTPUT only once every rule inside it
      // exists, or there is a window where it is reachable and empty. It is
      // the last *iptables* command rather than the last command outright:
      // the v6 chain is built afterwards and ends with its own insert.
      const v4 = flat(up).filter(line => line.includes('iptables') && !line.includes('ip6tables'))
      expect(v4.at(-1)).toBe('iptables -I OUTPUT 1 -j LT_KILLSWITCH')
    })

    it('hooks the v6 chain in last of all', () => {
      expect(flat(up).at(-1)).toContain('ip6tables -I OUTPUT 1 -j LT_KILLSWITCH')
    })

    it('drops last, after every exception', () => {
      const rules = flat(up).filter(line => line.includes('-A LT_KILLSWITCH'))
      expect(rules.at(-1)).toContain('-j DROP')
    })

    it('clears a stale chain before building, so a crash cannot block a retry', () => {
      expect(flat(up)[0]).toContain('-X LT_KILLSWITCH')
    })

    it('removes the chain from OUTPUT before deleting it', () => {
      expect(flat(down)[0]).toContain('-D OUTPUT')
      expect(flat(down).at(-1)).toContain('-X LT_KILLSWITCH')
    })
  }

  it('tolerates being torn down when it was never up', () => {
    // `vpn:down` after a crash runs these against a system that may have
    // none of them, so no teardown step may fail on something already gone.
    // `rm -f` and `mv -f` are tolerant by themselves; everything else has to
    // say so.
    for (const command of down) {
      if (command[0] !== 'sh') continue
      expect(command[2]).toMatch(/\|\| true|2>\/dev\/null|\brm -f\b|\bmv -f\b/)
    }
  })
})

describe('ipv6Commands', () => {
  /*
   * The tunnel is IPv4-only: the coordinator assigns a v4 address and the exit
   * peer claims 0.0.0.0/0, never ::/0. So on a dual-stack network every site
   * with an AAAA record would be reached over IPv6, outside the tunnel, with
   * the real address, while the window says Connected.
   */
  it('turns IPv6 off per service and puts each one back as it was', () => {
    if (!darwin) return
    const { up, down } = ipv6Commands({
      services: [
        { name: 'Wi-Fi', previous: 'automatic' },
        { name: 'Thunderbolt Bridge', previous: 'linklocal' },
      ],
    })

    expect(flat(up)).toEqual([
      'networksetup -setv6off Wi-Fi',
      'networksetup -setv6off Thunderbolt Bridge',
    ])
    // Restored to the mode each service was in, not to a single default: a
    // service on link-local put back to automatic is a changed machine.
    expect(flat(down)).toEqual([
      'networksetup -setv6automatic Wi-Fi',
      'networksetup -setv6linklocal Thunderbolt Bridge',
    ])
  })

  it('does nothing when there is no service to act on', () => {
    if (!darwin) return
    expect(ipv6Commands({})).toEqual({ up: [], down: [] })
  })

  it('uses the sysctl lever on Linux and restores it', () => {
    if (darwin) return
    const { up, down } = ipv6Commands({})
    expect(flat(up).join('\n')).toContain('disable_ipv6=1')
    expect(flat(down).join('\n')).toContain('disable_ipv6=0')
  })
})

describe('the kill switch covers IPv6', () => {
  const config = { tun: 'utun7', endpointIp: '203.0.113.9', endpointPort: 51820 }

  it('does not restrict the pf block to one address family', () => {
    if (!darwin) return
    // `block drop out all` with no `inet`/`inet6` qualifier covers both. A
    // rule written `block drop out inet all` would leave v6 wide open.
    const rules = pfRules(config)
    expect(rules).toContain('block drop out on ! lo0 all')
    expect(rules).not.toContain('block drop out on ! lo0 inet ')
  })

  it('builds an ip6tables chain too, since iptables is v4 only', () => {
    if (darwin) return
    // ip6tables is a separate table, not a flag. A switch built only in
    // iptables is an open door beside a locked one.
    const { up, down } = killSwitchCommands(config)
    const text = flat(up).join('\n')
    expect(text).toContain('ip6tables -N LT_KILLSWITCH')
    expect(text).toContain('ip6tables -A LT_KILLSWITCH -j DROP')
    expect(text).toContain('ip6tables -I OUTPUT 1 -j LT_KILLSWITCH')
    expect(flat(down).join('\n')).toContain('ip6tables -X LT_KILLSWITCH')
  })

  it('never fails the v4 switch over a kernel without IPv6', () => {
    if (darwin) return
    // A kernel built without IPv6 has no ip6tables, and refusing to arm the
    // v4 guard because of that trades a working one for none.
    for (const command of killSwitchCommands(config).up) {
      if (command[0] === 'sh' && command[2].includes('ip6tables'))
        expect(command[2]).toMatch(/\|\| true|2>\/dev\/null/)
    }
  })
})

describe.if(darwin)('the pf files reach disk as files', () => {
  /*
   * `JSON.stringify` was used to quote these for the shell. It yields a
   * JavaScript literal, so a newline came out as the two characters `\` and
   * `n` — which neither sh's double quotes nor `printf %s` expand. The
   * ruleset landed as one line containing a literal `\n`, and pf rejected
   * the whole of /etc/pf.conf, Apple's own anchors included.
   */
  const commands = killSwitchCommands({ tun: 'utun9', endpointIp: '5.78.208.190', endpointPort: 51820 })
  const anchorWrite = commands.up[0][2]
  const confAppend = commands.up[2][2]

  it('writes the anchor with real newlines, not the characters backslash and n', () => {
    expect(anchorWrite).not.toContain('\\n')
    expect(anchorWrite).toContain('\nblock drop out on ! lo0 all\n')
  })

  it('appends to pf.conf with real newlines', () => {
    expect(confAppend).not.toContain('\\n')
    expect(confAppend).toContain('\nanchor "org.localtunnels.vpn"\n')
  })

  it('quotes for the shell, so a path with a quote cannot end the string', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
  })
})

describe('the kill switch never blocks loopback', () => {
  // pfRules is the macOS ruleset; Linux builds iptables chains instead.
  const rules = pfRules({ tun: 'utun9', endpointIp: '5.78.208.190', endpointPort: 51820 })

  /*
   * The outage this exists to prevent. `block drop out all` plus a quick pass
   * for lo0 reads as equivalent and is not worth relying on: blocking a
   * machine's own loopback takes out every local service at once, and in this
   * app that includes the window's connection to the agent that lifts the
   * kill switch. The result was no network and no way back.
   */
  it('excludes loopback from the block itself, not just after it', () => {
    expect(rules).toContain('block drop out on ! lo0 all')
    expect(rules).not.toMatch(/^block drop out all$/m)
  })

  it('still blocks everything else, v4 and v6 alike', () => {
    // No `inet` qualifier, so the block covers IPv6 too — a v4-only block
    // beside an open v6 stack is a locked door next to an open one.
    expect(rules).not.toContain('inet')
    expect(rules).toContain(`pass out quick on utun9 all`)
    expect(rules).toContain('pass out quick proto udp to 5.78.208.190 port 51820')
  })
})

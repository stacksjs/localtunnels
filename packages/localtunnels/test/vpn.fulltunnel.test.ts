import { describe, expect, it } from 'bun:test'
import process from 'node:process'
import {
  defaultRouteCommands,
  dnsCommands,
  killSwitchCommands,
  PF_ANCHOR_NAME,
  pfRules,
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
    expect(rules).toContain('block drop out all')
    // The block has to come first: `quick` passes below it are the
    // exceptions, and a block written last would override all of them.
    expect(rules.indexOf('block drop out all')).toBeLessThan(rules.indexOf('pass out quick'))
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
      expect(flat(up).at(-1)).toBe('iptables -I OUTPUT 1 -j LT_KILLSWITCH')
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

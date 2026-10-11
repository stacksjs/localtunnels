/**
 * Full-tunnel mode: making the operating system actually send its traffic
 * into the tunnel.
 *
 * Cryptokey routing (`routing.ts`) decides which *peer* carries a packet once
 * we have it. It does not decide whether the kernel hands us the packet in
 * the first place. Those are different questions, and until this module
 * existed only the first one had an answer: a node could hold `0.0.0.0/0` for
 * an exit peer and still watch every byte leave over Wi-Fi, because nothing
 * had told the routing table that `utun` was where traffic goes.
 *
 * Three things have to be true for a VPN to be a VPN:
 *
 *   1. the default route points into the tunnel — except for the tunnel's own
 *      packets, which must keep going out the physical interface,
 *   2. DNS resolves through the tunnel, or every domain you visit is handed
 *      to your ISP while the window says you are protected,
 *   3. when the tunnel drops, traffic stops rather than silently reverting to
 *      the uncovered path.
 *
 * Everything here is a pure function from configuration to a list of
 * commands, in the same shape as `configureInterfaceCommands` and
 * `exitNodeCommands`. Nothing in this file runs anything; `apply.ts` does
 * that. The point is that the rules which can strand a machine off the
 * network are testable without stranding a machine off the network.
 */
import process from 'node:process'

/** A reversible change to the system: how to make it, and how to undo it. */
export interface Reversible {
  up: string[][]
  down: string[][]
}

export interface RouteConfig {
  /** The tunnel interface, e.g. `utun4`. */
  tun: string
  /** The VPN server's public address. Its packets must not enter the tunnel. */
  endpointIp: string
  /** The gateway those packets keep using — the physical default gateway. */
  gateway: string
  /** The physical interface the gateway is on. Linux needs it named. */
  wanInterface?: string
}

/**
 * Capture the default route.
 *
 * Two halves of one equal-and-opposite trick.
 *
 * **The halves.** Rather than replacing the default route, two routes of half
 * the internet each — `0.0.0.0/1` and `128.0.0.0/1` — are added pointing at
 * the tunnel. Both are more specific than `0.0.0.0/0`, so longest-prefix
 * matching picks them for every destination, while the real default route is
 * left untouched underneath. Teardown deletes two routes we added instead of
 * restoring one we destroyed, which matters because the moment you delete a
 * default route you are one failed command away from a machine with no way
 * to reach anything — including the server it would need to fix itself.
 *
 * **The hole.** The encrypted packets are themselves traffic. With the
 * default route captured, a packet addressed to the VPN server would be
 * routed into the tunnel, encrypted, and addressed to the VPN server again:
 * a loop that wedges the connection the instant it is established. So the
 * server's own address gets a host route out the physical gateway first,
 * which is more specific still.
 *
 * Order matters in both directions: the hole is punched before the capture
 * and filled after it, so there is no window where the tunnel's own packets
 * have nowhere correct to go.
 */
export function defaultRouteCommands(config: RouteConfig): Reversible {
  const { tun, endpointIp, gateway, wanInterface } = config

  if (process.platform === 'darwin') {
    return {
      up: [
        ['route', '-n', 'add', '-host', endpointIp, gateway],
        ['route', '-n', 'add', '-net', '0.0.0.0/1', '-interface', tun],
        ['route', '-n', 'add', '-net', '128.0.0.0/1', '-interface', tun],
      ],
      down: [
        ['route', '-n', 'delete', '-net', '0.0.0.0/1', '-interface', tun],
        ['route', '-n', 'delete', '-net', '128.0.0.0/1', '-interface', tun],
        ['route', '-n', 'delete', '-host', endpointIp, gateway],
      ],
    }
  }

  const via = wanInterface ? ['via', gateway, 'dev', wanInterface] : ['via', gateway]
  return {
    up: [
      ['ip', 'route', 'add', `${endpointIp}/32`, ...via],
      ['ip', 'route', 'add', '0.0.0.0/1', 'dev', tun],
      ['ip', 'route', 'add', '128.0.0.0/1', 'dev', tun],
    ],
    down: [
      ['ip', 'route', 'del', '0.0.0.0/1', 'dev', tun],
      ['ip', 'route', 'del', '128.0.0.0/1', 'dev', tun],
      ['ip', 'route', 'del', `${endpointIp}/32`, ...via],
    ],
  }
}

export interface DnsConfig {
  /** Resolvers to use while connected. */
  servers: string[]
  /**
   * macOS only: the network services to point at them, with whatever they
   * were set to beforehand so teardown can put it back. `null` means the
   * service was on DHCP, which `networksetup` spells `Empty`.
   */
  services?: Array<{ name: string, previous: string[] | null }>
}

/**
 * Send DNS through the tunnel.
 *
 * This is the leak everyone forgets. Routing alone moves your packets but
 * leaves the resolver pointed at whatever DHCP handed you — usually your
 * ISP's — so every name you look up is still disclosed to the network you
 * are trying to be invisible on, in plaintext, while the app says
 * "Connected". The traffic is private and the index of it is not.
 *
 * **macOS** goes through `networksetup`, per network service, because that
 * writes the preference the whole system reads. `scutil` can set a resolver
 * on the interface, but Wi-Fi reasserts its own on every renewal and the
 * change quietly evaporates mid-session. The previous value is passed in
 * rather than read here so that teardown restores what was actually there;
 * `Empty` is `networksetup`'s word for "back to DHCP".
 *
 * **Linux** replaces `/etc/resolv.conf` and keeps the original beside it.
 * `wg-quick` does the same when `resolvconf` is absent, and the backup is
 * what lets a crashed process be cleaned up afterwards.
 */
export function dnsCommands(config: DnsConfig): Reversible {
  const { servers, services = [] } = config

  if (process.platform === 'darwin') {
    return {
      up: services.map(service => ['networksetup', '-setdnsservers', service.name, ...servers]),
      down: services.map(service => [
        'networksetup',
        '-setdnsservers',
        service.name,
        // An empty list is not "leave it alone", it is "clear it", and
        // `networksetup` spells that `Empty`.
        ...(service.previous && service.previous.length > 0 ? service.previous : ['Empty']),
      ]),
    }
  }

  const backup = '/etc/resolv.conf.localtunnels'
  const contents = `${servers.map(server => `nameserver ${server}`).join('\n')}\n`
  return {
    up: [
      // Copied rather than moved: a symlink to systemd-resolved is the normal
      // state, and moving it would leave the system without one if we die
      // before writing the replacement.
      ['sh', '-c', `cp -f /etc/resolv.conf ${backup} 2>/dev/null || true`],
      ['sh', '-c', `printf %s ${JSON.stringify(contents)} > /etc/resolv.conf`],
    ],
    down: [
      ['sh', '-c', `[ -f ${backup} ] && mv -f ${backup} /etc/resolv.conf || true`],
    ],
  }
}

export interface KillSwitchConfig {
  /** The tunnel interface. Traffic leaving through it is always allowed. */
  tun: string
  /** The VPN server, which must stay reachable or the tunnel cannot be rebuilt. */
  endpointIp: string
  endpointPort: number
  /**
   * Allow traffic to the local network — printers, AirPlay, a NAS. Off by
   * default: a device on your LAN can see your real address, which is most
   * of what the kill switch exists to prevent.
   */
  allowLan?: boolean
}

/** Private ranges, for the `allowLan` escape hatch. */
const LAN_RANGES: string[] = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16']

/** Where the macOS rules are written. Referenced by both halves. */
export const PF_ANCHOR_NAME: string = 'org.localtunnels.vpn'
export const PF_ANCHOR_FILE: string = `/etc/pf.anchors/${PF_ANCHOR_NAME}`
const PF_CONF: string = '/etc/pf.conf'
const PF_CONF_BACKUP: string = '/etc/pf.conf.localtunnels'

/**
 * The pf ruleset, as text. Separate from the commands so the thing that can
 * cut a machine off the network can be asserted on character by character.
 *
 * `block drop out all` first and `pass ... quick` after is pf's evaluation
 * order used deliberately: without `quick`, the *last* matching rule wins and
 * the passes would be overruled by nothing — but `quick` stops evaluation at
 * the first match, which makes each pass an exception to the block above it
 * and keeps the rules readable top to bottom.
 */
export function pfRules(config: KillSwitchConfig): string {
  const { tun, endpointIp, endpointPort, allowLan = false } = config
  const lines = [
    `# ${PF_ANCHOR_NAME} — generated by localtunnels. Removed on disconnect.`,
    'block drop out all',
    'pass out quick on lo0 all',
    `pass out quick on ${tun} all`,
    `pass out quick proto udp to ${endpointIp} port ${endpointPort}`,
    // Without this the lease expires mid-session and the link drops, which
    // looks exactly like the VPN breaking.
    'pass out quick proto udp from any port 68 to any port 67',
  ]
  if (allowLan)
    lines.push(...LAN_RANGES.map(range => `pass out quick to ${range}`))
  return `${lines.join('\n')}\n`
}

/**
 * Fail closed when the tunnel drops.
 *
 * Without this, a tunnel that dies is not an outage — it is a silent
 * downgrade. Routes revert, traffic resumes over the uncovered path, and
 * nothing on screen changes, which is worse than never having connected: you
 * carry on believing you are somewhere you are not.
 *
 * **macOS** loads a pf anchor. The anchor has to be referenced from
 * `/etc/pf.conf`, so that file is backed up and appended to rather than
 * replaced — Apple's own anchors are in it and a VPN has no business
 * discarding them. Teardown restores the backup.
 *
 * **Linux** puts the rules in a chain of their own rather than inserting
 * them into `OUTPUT`. A dedicated chain can be removed exactly, by name,
 * without having to reason about what else has been inserted since or at
 * which index our rules ended up.
 *
 * Both halves survive the process dying, which is the point — a kill switch
 * that disappears with the thing it is protecting against is not one. That
 * is also why teardown is written to disk by the caller, so `vpn:down` can
 * undo this after a crash.
 */
export function killSwitchCommands(config: KillSwitchConfig): Reversible {
  const { tun, endpointIp, endpointPort, allowLan = false } = config

  if (process.platform === 'darwin') {
    const reference = `\nanchor "${PF_ANCHOR_NAME}"\nload anchor "${PF_ANCHOR_NAME}" from "${PF_ANCHOR_FILE}"\n`
    return {
      up: [
        ['sh', '-c', `printf %s ${JSON.stringify(pfRules(config))} > ${PF_ANCHOR_FILE}`],
        // Backed up only once: a second connect must not overwrite the
        // pristine copy with one that already carries our anchor, or
        // teardown would restore the anchor it is trying to remove.
        ['sh', '-c', `[ -f ${PF_CONF_BACKUP} ] || cp -f ${PF_CONF} ${PF_CONF_BACKUP}`],
        ['sh', '-c', `grep -q ${JSON.stringify(PF_ANCHOR_NAME)} ${PF_CONF} || printf %s ${JSON.stringify(reference)} >> ${PF_CONF}`],
        ['pfctl', '-E', '-f', PF_CONF],
      ],
      down: [
        ['sh', '-c', `[ -f ${PF_CONF_BACKUP} ] && mv -f ${PF_CONF_BACKUP} ${PF_CONF} || true`],
        ['sh', '-c', `rm -f ${PF_ANCHOR_FILE}`],
        // Flush our anchor explicitly: reloading pf.conf stops referencing it
        // but does not empty a ruleset already loaded under that name.
        ['sh', '-c', `pfctl -a ${PF_ANCHOR_NAME} -F rules 2>/dev/null || true`],
        ['sh', '-c', `pfctl -f ${PF_CONF} 2>/dev/null || true`],
      ],
    }
  }

  const chain: string = 'LT_KILLSWITCH'
  const lan = allowLan ? LAN_RANGES.map(range => ['iptables', '-A', chain, '-d', range, '-j', 'RETURN']) : []
  return {
    up: [
      // Idempotent: a stale chain from a crashed run is removed before the
      // new one is built, or `-N` fails and the switch is never armed.
      ['sh', '-c', `iptables -D OUTPUT -j ${chain} 2>/dev/null; iptables -F ${chain} 2>/dev/null; iptables -X ${chain} 2>/dev/null; true`],
      ['iptables', '-N', chain],
      ['iptables', '-A', chain, '-o', 'lo', '-j', 'RETURN'],
      ['iptables', '-A', chain, '-o', tun, '-j', 'RETURN'],
      ['iptables', '-A', chain, '-p', 'udp', '-d', endpointIp, '--dport', String(endpointPort), '-j', 'RETURN'],
      ['iptables', '-A', chain, '-p', 'udp', '--sport', '68', '--dport', '67', '-j', 'RETURN'],
      ...lan,
      ['iptables', '-A', chain, '-j', 'DROP'],
      ['iptables', '-I', 'OUTPUT', '1', '-j', chain],
    ],
    down: [
      ['sh', '-c', `iptables -D OUTPUT -j ${chain} 2>/dev/null || true`],
      ['sh', '-c', `iptables -F ${chain} 2>/dev/null || true`],
      ['sh', '-c', `iptables -X ${chain} 2>/dev/null || true`],
    ],
  }
}

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
   * The coordinator, which must stay reachable for the whole session.
   *
   * Not an optimisation. The client heartbeats to the coordinator over this
   * TCP connection every 20 seconds, and a node that stops heartbeating is
   * dropped from the directory — at which point the exit node withdraws the
   * route to our tunnel address and stops forwarding anything back to us.
   *
   * Without this rule the switch armed, the heartbeats piled up unsent in the
   * socket's send queue, and about two minutes later the server logged
   * `- peer … left`. The tunnel then carried traffic one way only, with the
   * interface up, handshakes still succeeding and both ends printing
   * `link up`, which is the most misleading shape this failure could take.
   *
   * It opens no new exposure: this is the same host the rule above already
   * passes UDP to, so anyone watching the wire already sees the association.
   *
   * Omitted when there is no coordinator — a statically peered tunnel has
   * nothing to stay registered with.
   */
  coordinatorIp?: string
  coordinatorPort?: number
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
 * Single-quote a value for `/bin/sh`, newlines and all.
 *
 * `JSON.stringify` was used for this, and it is not the same thing. It
 * produces a *JavaScript* literal, which looks close enough for a word or a
 * path and diverges exactly where it matters: a newline becomes the two
 * characters `\` and `n`. Double quotes do not expand those in sh, and
 * `printf %s` does not expand escapes in its argument either, so a ruleset
 * went to disk as one line with a literal `\n` in it and pf refused the
 * whole file — including Apple's own anchors.
 *
 * A single-quoted shell string carries real newlines verbatim, which is what
 * a config file needs.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

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
  const { tun, endpointIp, endpointPort, coordinatorIp, coordinatorPort, allowLan = false } = config
  const lines = [
    `# ${PF_ANCHOR_NAME} — generated by localtunnels. Removed on disconnect.`,
    /*
     * Loopback is excluded from the block itself, not merely passed after it.
     *
     * `block drop out all` followed by `pass out quick on lo0 all` reads as
     * equivalent and is not worth relying on: a machine that blocks its own
     * loopback loses every local service at once, and on this app that
     * includes the window's connection to its own agent — which is the thing
     * you would use to turn the kill switch off. The failure mode is a user
     * with no network and no way back, which is what happened.
     *
     * `on ! lo0` means no loopback packet is ever a candidate for the block,
     * whatever the ordering semantics do. The explicit pass below stays as a
     * statement of intent.
     */
    'block drop out on ! lo0 all',
    'pass out quick on lo0 all',
    `pass out quick on ${tun} all`,
    `pass out quick proto udp to ${endpointIp} port ${endpointPort}`,
    // Without this the lease expires mid-session and the link drops, which
    // looks exactly like the VPN breaking.
    'pass out quick proto udp from any port 68 to any port 67',
  ]
  // See `coordinatorIp`: without this the directory drops us after ~2 minutes
  // and the exit node stops routing to us, while everything on screen still
  // says connected.
  /*
   * `flags any no state` is the whole rule, and without it this passes
   * nothing at all.
   *
   * pf applies `flags S/SA` to a stateful rule by default, so it matches only
   * the SYN that opens a connection. This websocket is already open by the
   * time the switch arms — every packet left on it is a mid-stream ACK or
   * PSH, none of which carry SYN, so they skip this rule entirely and land on
   * the block above. The first version of this fix read exactly like a rule
   * that works, installed correctly, and dropped the heartbeats anyway.
   *
   * `no state` rather than `keep state`: pf.conf(5) warns that a state
   * adopted from an intermediate packet is missing details like the window
   * scaling factor and that such connections stall and time out. There is
   * nothing to track here anyway — the block is outbound-only, so the replies
   * were never in question.
   */
  if (coordinatorIp && coordinatorPort)
    lines.push(`pass out quick proto tcp to ${coordinatorIp} port ${coordinatorPort} flags any no state`)
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
  const { tun, endpointIp, endpointPort, coordinatorIp, coordinatorPort, allowLan = false } = config

  if (process.platform === 'darwin') {
    const reference = `\nanchor "${PF_ANCHOR_NAME}"\nload anchor "${PF_ANCHOR_NAME}" from "${PF_ANCHOR_FILE}"\n`
    return {
      up: [
        ['sh', '-c', `printf %s ${shellQuote(pfRules(config))} > ${PF_ANCHOR_FILE}`],
        // Backed up only once: a second connect must not overwrite the
        // pristine copy with one that already carries our anchor, or
        // teardown would restore the anchor it is trying to remove.
        ['sh', '-c', `[ -f ${PF_CONF_BACKUP} ] || cp -f ${PF_CONF} ${PF_CONF_BACKUP}`],
        ['sh', '-c', `grep -q ${shellQuote(PF_ANCHOR_NAME)} ${PF_CONF} || printf %s ${shellQuote(reference)} >> ${PF_CONF}`],
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
  // See `coordinatorIp`. Same exception as the pf anchor's, for the same
  // reason: heartbeats that cannot leave get the node dropped.
  const coordinator = coordinatorIp && coordinatorPort
    ? [['iptables', '-A', chain, '-p', 'tcp', '-d', coordinatorIp, '--dport', String(coordinatorPort), '-j', 'RETURN']]
    : []

  /*
   * `ip6tables` is a separate table, not a flag on `iptables`. A kill switch
   * built only in `iptables` governs IPv4 and lets every IPv6 packet past
   * untouched — on a dual-stack machine that is not a weakened kill switch,
   * it is an open door beside a locked one.
   *
   * The v6 chain has no exception for the endpoint: the tunnel is IPv4-only,
   * so a v6 endpoint is not a case that exists here, and loopback is the only
   * v6 traffic with anywhere legitimate to go.
   */
  const v6 = [
    ['sh', '-c', `ip6tables -D OUTPUT -j ${chain} 2>/dev/null; ip6tables -F ${chain} 2>/dev/null; ip6tables -X ${chain} 2>/dev/null; true`],
    ['sh', '-c', `ip6tables -N ${chain} 2>/dev/null || true`],
    ['sh', '-c', `ip6tables -A ${chain} -o lo -j RETURN 2>/dev/null || true`],
    ['sh', '-c', `ip6tables -A ${chain} -j DROP 2>/dev/null || true`],
    ['sh', '-c', `ip6tables -I OUTPUT 1 -j ${chain} 2>/dev/null || true`],
  ]

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
      ...coordinator,
      ...lan,
      ['iptables', '-A', chain, '-j', 'DROP'],
      ['iptables', '-I', 'OUTPUT', '1', '-j', chain],
      // Tolerated rather than required: a kernel built without IPv6 has no
      // ip6tables, and refusing to arm the v4 switch because of that would
      // trade a working guard for a missing one.
      ...v6,
    ],
    down: [
      ['sh', '-c', `iptables -D OUTPUT -j ${chain} 2>/dev/null || true`],
      ['sh', '-c', `iptables -F ${chain} 2>/dev/null || true`],
      ['sh', '-c', `iptables -X ${chain} 2>/dev/null || true`],
      ['sh', '-c', `ip6tables -D OUTPUT -j ${chain} 2>/dev/null || true`],
      ['sh', '-c', `ip6tables -F ${chain} 2>/dev/null || true`],
      ['sh', '-c', `ip6tables -X ${chain} 2>/dev/null || true`],
    ],
  }
}

/**
 * A macOS network service's IPv6 setting, and how to put it back.
 *
 * `previous` is `networksetup`'s own word for the mode — `automatic`,
 * `linklocal` or `off`. A service configured manually is not represented,
 * because restoring one needs its address, prefix and router, and a VPN that
 * forgets a hand-configured address is worse than one that leaves it alone.
 */
export type Ipv6Mode = 'automatic' | 'linklocal' | 'off'

export interface Ipv6Service {
  name: string
  previous: Ipv6Mode
}

export interface Ipv6Config {
  services?: Ipv6Service[]
}

/**
 * Take IPv6 out of the picture for the duration of the tunnel.
 *
 * The tunnel is IPv4-only: the coordinator assigns a v4 address and the exit
 * peer claims `0.0.0.0/0`, never `::/0`. So on a dual-stack network — which is
 * most home networks now — capturing v4 and leaving v6 alone means every site
 * with an AAAA record is reached over IPv6, outside the tunnel, with your real
 * address, while the window says Connected. That is the worst failure this app
 * has, because nothing about it looks wrong.
 *
 * Two ways to stop it, and the difference matters more than it looks.
 *
 * Blocking v6 at the firewall is the obvious one, and it leaves the machine
 * holding a v6 address and a v6 route. Applications still *try* IPv6 first —
 * that is what Happy Eyeballs does — and wait for a timeout before falling
 * back to v4. Every connection pays that stall, which is precisely the
 * "the VPN makes everything slow" complaint.
 *
 * Turning v6 off per service takes the address away, so name resolution and
 * connection setup go straight to v4 with nothing to fall back from. That is
 * what this does, and the kill switch still blocks v6 underneath it as a
 * backstop for anything that brings an interface up later.
 */
export function ipv6Commands(config: Ipv6Config): Reversible {
  const { services = [] } = config

  if (process.platform === 'darwin') {
    return {
      up: services.map(service => ['networksetup', '-setv6off', service.name]),
      down: services.map(service => [`networksetup`, `-setv6${service.previous}`, service.name]),
    }
  }

  // Linux: the sysctl is the equivalent lever. Restored to 0 rather than to a
  // captured value because a machine that had v6 disabled already is one this
  // never touches — `discoverIpv6Services` returns nothing for it, so these
  // commands are never built.
  return {
    up: [
      ['sysctl', '-w', 'net.ipv6.conf.all.disable_ipv6=1'],
      ['sysctl', '-w', 'net.ipv6.conf.default.disable_ipv6=1'],
    ],
    down: [
      ['sysctl', '-w', 'net.ipv6.conf.all.disable_ipv6=0'],
      ['sysctl', '-w', 'net.ipv6.conf.default.disable_ipv6=0'],
    ],
  }
}

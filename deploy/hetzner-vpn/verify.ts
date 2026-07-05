/* eslint-disable node/prefer-global/process */
/**
 * End-to-end verification of the Hetzner WireGuard VPN.
 *
 * Everything runs on the server over SSH — no local WireGuard tooling needed.
 * A network namespace acts as a real kernel-WireGuard client that handshakes
 * with wg0, pings the server across the tunnel, and egresses to the internet
 * through it (exit-node routing). Fully controlled and repeatable.
 *
 *   bun run deploy/hetzner-vpn/verify.ts
 */
import { readFileSync } from 'node:fs'
import { ssh, sshOrThrow, STATE_PATH, WG_PORT } from './config'

interface Check {
  name: string
  ok: boolean
  detail: string
}

const checks: Check[] = []
function record(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail })
  // eslint-disable-next-line no-console
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** The self-contained netns WireGuard client test, run as one script on the box. */
function netnsTestScript(): string {
  // Uses a veth pair so the client reaches wg0 via a host-local address (no
  // dependency on hairpin NAT to the public IP). Cleans up on exit.
  return `set -e
NS=wgverify
HOST_IP=192.168.240.1
NS_IP=192.168.240.2
# Must live in the server's wg0 subnet (10.8.0.0/24) so wg0 routes replies back.
CLIENT_WG=10.8.0.99

cleanup() {
  ip netns del $NS 2>/dev/null || true
  ip link del vethh 2>/dev/null || true
  rm -rf /etc/netns/$NS 2>/dev/null || true
  wg set wg0 peer "$CLIENT_PUB" remove 2>/dev/null || true
}
trap cleanup EXIT
cleanup

# Fresh client keypair for this test.
CLIENT_PRIV=$(wg genkey)
CLIENT_PUB=$(echo "$CLIENT_PRIV" | wg pubkey)
SERVER_PUB=$(cat /etc/wireguard/server_public.key)

# netns + veth so the client can reach the host's wg0 listener locally.
ip netns add $NS
# The netns needs its own resolver — the host's 127.0.0.53 isn't reachable in
# it. 1.1.1.1 is queried through the tunnel, exercising DNS over the VPN too.
mkdir -p /etc/netns/$NS
echo "nameserver 1.1.1.1" > /etc/netns/$NS/resolv.conf
ip link add vethh type veth peer name vethc
ip link set vethc netns $NS
ip addr add $HOST_IP/24 dev vethh
ip link set vethh up
ip netns exec $NS ip addr add $NS_IP/24 dev vethc
ip netns exec $NS ip link set vethc up
ip netns exec $NS ip link set lo up

# Register the client on wg0 (allow its tunnel IP).
wg set wg0 peer "$CLIENT_PUB" allowed-ips $CLIENT_WG/32

# Bring up the WireGuard client inside the netns.
ip netns exec $NS ip link add wgc type wireguard
TMPCONF=$(mktemp)
cat > "$TMPCONF" <<EOF
[Interface]
PrivateKey = $CLIENT_PRIV
[Peer]
PublicKey = $SERVER_PUB
Endpoint = $HOST_IP:${WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 5
EOF
ip netns exec $NS wg setconf wgc "$TMPCONF"
rm -f "$TMPCONF"
ip netns exec $NS ip addr add $CLIENT_WG/24 dev wgc
ip netns exec $NS ip link set wgc up
ip netns exec $NS ip route add default dev wgc

# Force a handshake, then report results as KEY=VALUE lines.
ip netns exec $NS ping -c1 -W3 10.8.0.1 >/dev/null 2>&1 || true
sleep 2

HANDSHAKE=$(wg show wg0 latest-handshakes | grep "$CLIENT_PUB" | awk '{print $2}')
TRANSFER=$(wg show wg0 transfer | grep "$CLIENT_PUB" | awk '{print $2" "$3}')
PING=$(ip netns exec $NS ping -c3 -W3 10.8.0.1 2>/dev/null | grep -oE '[0-9]+ received' | head -1 || echo "0 received")
EXIT_IP=$(ip netns exec $NS curl -s --max-time 12 https://api.ipify.org || echo "")
SERVER_IP=$(curl -s --max-time 12 https://api.ipify.org || echo "")

echo "HANDSHAKE=$HANDSHAKE"
echo "TRANSFER=$TRANSFER"
echo "PING=$PING"
echo "EXIT_IP=$EXIT_IP"
echo "SERVER_IP=$SERVER_IP"
`
}

async function main(): Promise<void> {
  let state
  try {
    state = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  }
  catch {
    throw new Error(`no deploy state at ${STATE_PATH} — run deploy.ts first`)
  }
  const ip: string = state.publicIp

  // eslint-disable-next-line no-console
  console.log(`\n  Verifying VPN at ${ip}\n`)

  // ── Server-side posture ──────────────────────────────────────────────────
  const wgShow = await ssh(ip, 'wg show wg0 2>/dev/null | head -1')
  record('WireGuard wg0 interface up', wgShow.stdout.includes('interface: wg0'), wgShow.stdout.trim())

  const listen = await ssh(ip, `ss -lun | grep -q ':${WG_PORT} ' && echo yes || echo no`)
  record(`Listening on udp/${WG_PORT}`, listen.stdout.includes('yes'))

  const fwd = await ssh(ip, 'sysctl -n net.ipv4.ip_forward')
  record('IPv4 forwarding enabled', fwd.stdout.trim() === '1')

  const nat = await ssh(ip, 'iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null && echo yes || iptables -t nat -S POSTROUTING | grep -q MASQUERADE && echo yes || echo no')
  record('NAT masquerade rule present', nat.stdout.includes('yes'))

  // ── The real e2e: netns WireGuard client through the tunnel ──────────────
  // eslint-disable-next-line no-console
  console.log('\n  Running netns WireGuard client e2e...\n')
  const out = await sshOrThrow(ip, netnsTestScript())
  const kv: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0)
      kv[line.slice(0, eq)] = line.slice(eq + 1).trim()
  }

  const handshakeTs = Number.parseInt(kv.HANDSHAKE || '0')
  record('Client completed a handshake', handshakeTs > 0, kv.HANDSHAKE ? `ts=${kv.HANDSHAKE}` : 'none')

  const pingRecv = Number.parseInt((kv.PING || '0 received').split(' ')[0])
  record('Ping server over the tunnel (10.8.0.1)', pingRecv > 0, kv.PING)

  const exitOk = !!kv.EXIT_IP && kv.EXIT_IP === kv.SERVER_IP && kv.EXIT_IP === ip
  record('Traffic egresses via the VPN (exit node)', exitOk, `client-sees=${kv.EXIT_IP || '?'} server=${kv.SERVER_IP || '?'} expected=${ip}`)

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed = checks.filter(c => c.ok).length
  // eslint-disable-next-line no-console
  console.log(`\n  ${passed}/${checks.length} checks passed\n`)
  if (passed !== checks.length) {
    process.exit(1)
  }
  // eslint-disable-next-line no-console
  console.log('  ✅ VPN verified end-to-end: handshake, tunnel ping, and exit routing all work.\n')
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n  Verify failed: ${err.message}\n`)
  process.exit(1)
})

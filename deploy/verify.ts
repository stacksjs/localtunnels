/* eslint-disable node/prefer-global/process */
/**
 * End-to-end verification of the deployed localtunnels VPN.
 *
 * The server runs the localtunnels VPN (systemd `localtunnels-vpn`). This test
 * spins up a localtunnels CLIENT inside a network namespace on the server —
 * OUR stack on both ends — and confirms a handshake, a ping through the tunnel,
 * and internet egress via the server (exit node). Fully controlled, repeatable.
 *
 *   bun run verify:vpn
 */
import { readFileSync } from 'node:fs'
import { sshExec, sshExecOrThrow } from '@stacksjs/ts-cloud/drivers'
import { COORD_PORT, EXEC_OPTS, REMOTE_BIN, REMOTE_LIB, STATE_PATH, WG_PORT } from './config'

interface Check { name: string, ok: boolean, detail: string }
const checks: Check[] = []
function record(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail })
  // eslint-disable-next-line no-console
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/**
 * A netns localtunnels client that enrols with the coordinator over a
 * host-local veth. Cleans up on exit.
 *
 * It used to peer statically against the server key, which worked while the
 * server authorized exactly one hard-coded client. The server now runs a
 * coordinator and joins it as the exit node, so this enrols the way a real
 * client does — which is the arrangement actually worth verifying.
 *
 * Two consequences. The coordinator is reached on the veth host address, not
 * loopback: a network namespace has its own `lo`, so `127.0.0.1` inside it is
 * the namespace rather than the box. And the tunnel addresses are no longer
 * known in advance, since the coordinator allocates them from 100.100.0.0/16,
 * so the server address is read off its interface instead of assumed.
 */
function netnsClientScript(publicIp: string): string {
  return `set -uo pipefail
BIN=${REMOTE_BIN}
export LTVPN_LIB=${REMOTE_LIB}
NS=ltverify
HOST_IP=192.168.241.1
NS_IP=192.168.241.2
COORD_PORT=${COORD_PORT}
PUBLIC_IP=${publicIp}
CLIENT_HOME=/root/.lt-client
SERVER_PUB=$(cat /root/.lt-server/vpn/publickey)
AUTH_KEY=$(cat /root/.lt-coordinator/authkey)
SERVER_TUN_IP=\$(ip -4 -o addr show | awk '/tun[0-9]+/{print \$4}' | cut -d/ -f1 | head -1)

cleanup() {
  [ -n "\${CLIENT_PID:-}" ] && kill "\$CLIENT_PID" 2>/dev/null
  ip netns del \$NS 2>/dev/null
  ip link del vethh 2>/dev/null
  rm -rf /etc/netns/\$NS 2>/dev/null
}
trap cleanup EXIT
cleanup

ip netns add \$NS
mkdir -p /etc/netns/\$NS
echo "nameserver 1.1.1.1" > /etc/netns/\$NS/resolv.conf
ip link add vethh type veth peer name vethc
ip link set vethc netns \$NS
ip addr add \$HOST_IP/24 dev vethh
ip link set vethh up
ip netns exec \$NS ip addr add \$NS_IP/24 dev vethc
ip netns exec \$NS ip link set vethc up
ip netns exec \$NS ip link set lo up
# The namespace needs a way off itself: the directory advertises the exit node
# at the box's public address, so a namespace with only its veth cannot reach
# the endpoint it is told to dial, and the client fails with ENETUNREACH.
ip netns exec \$NS ip route add default via \$HOST_IP

# Start the localtunnels client inside the netns. It enrols with the
# coordinator exactly as a real client does, and pins the exit to the
# server's own key rather than taking whatever 'auto' would offer.
LOCALTUNNELS_HOME=\$CLIENT_HOME ip netns exec \$NS env LTVPN_LIB=\$LTVPN_LIB \$BIN vpn:up \
  --listen 51822 \
  --coordinator ws://\${HOST_IP}:\${COORD_PORT} --auth-key "\$AUTH_KEY" \
  --use-exit "\$SERVER_PUB" \
  > /tmp/lt-verify-client.log 2>&1 &
CLIENT_PID=\$!
sleep 5

CLIENT_TUN=\$(ip netns exec \$NS sh -c "ls /sys/class/net | grep -E '^tun'" | head -1)
if [ -n "\$CLIENT_TUN" ]; then
  # Pin the endpoint before capturing the default, or the tunnel's own
  # packets route into the tunnel that carries them — the same hole
  # full-tunnel mode punches, for the same reason.
  ip netns exec \$NS ip route add \${PUBLIC_IP}/32 via \$HOST_IP 2>/dev/null
  ip netns exec \$NS ip route replace default dev "\$CLIENT_TUN" 2>/dev/null
fi

sleep 2
ip netns exec \$NS ping -c1 -W3 \$SERVER_TUN_IP >/dev/null 2>&1

PING=\$(ip netns exec \$NS ping -c3 -W3 \$SERVER_TUN_IP 2>/dev/null | grep -oE '[0-9]+ received' | head -1 || echo "0 received")
EXIT_IP=\$(ip netns exec \$NS curl -s --max-time 15 https://api.ipify.org || echo "")
SERVER_IP=\$(curl -s --max-time 15 https://api.ipify.org || echo "")

echo "SERVER_TUN_IP=\$SERVER_TUN_IP"
echo "CLIENT_TUN=\${CLIENT_TUN:-none}"
echo "PING=\$PING"
echo "EXIT_IP=\$EXIT_IP"
echo "SERVER_IP=\$SERVER_IP"
`
}

async function main(): Promise<void> {
  let state
  try {
    state = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  }
  catch {
    throw new Error(`no deploy state at ${STATE_PATH} — run \`bun run deploy:vpn\` first`)
  }
  const ip: string = state.publicIp

  // eslint-disable-next-line no-console
  console.log(`\n  Verifying localtunnels VPN at ${ip}\n`)

  // ── Server-side posture ──────────────────────────────────────────────────
  const coord = await sshExec(ip, 'systemctl is-active localtunnels-coordinator.service', EXEC_OPTS)
  record('localtunnels-coordinator service active', coord.stdout.trim() === 'active', coord.stdout.trim())

  // A coordinator that is "active" but not bound accepts nobody, and the
  // client-side symptom is a hang rather than a refusal.
  const coordPort = await sshExec(ip, `ss -ltn | grep -q ':${COORD_PORT} ' && echo yes || echo no`, EXEC_OPTS)
  record(`Coordinator listening on tcp/${COORD_PORT}`, coordPort.stdout.includes('yes'))

  const svc = await sshExec(ip, 'systemctl is-active localtunnels-vpn.service', EXEC_OPTS)
  record('localtunnels-vpn service active', svc.stdout.trim() === 'active', svc.stdout.trim())

  const iface = await sshExec(ip, 'ip -o link show | grep -oE "tun[0-9]+" | head -1', EXEC_OPTS)
  record('Server TUN interface present', /tun\d+/.test(iface.stdout), iface.stdout.trim())

  const listen = await sshExec(ip, `ss -lun | grep -q ':${WG_PORT} ' && echo yes || echo no`, EXEC_OPTS)
  record(`Listening on udp/${WG_PORT}`, listen.stdout.includes('yes'))

  const fwd = await sshExec(ip, 'sysctl -n net.ipv4.ip_forward', EXEC_OPTS)
  record('IPv4 forwarding enabled', fwd.stdout.trim() === '1')

  const nat = await sshExec(ip, 'iptables -t nat -S POSTROUTING | grep -q MASQUERADE && echo yes || echo no', EXEC_OPTS)
  record('NAT masquerade rule present', nat.stdout.includes('yes'))

  // ── The real e2e: a localtunnels client through the tunnel ───────────────
  // eslint-disable-next-line no-console
  console.log('\n  Running netns localtunnels client e2e (our stack on both ends)...\n')
  const out = await sshExecOrThrow(ip, netnsClientScript(ip), EXEC_OPTS)
  const kv: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0)
      kv[line.slice(0, eq)] = line.slice(eq + 1).trim()
  }

  const pingRecv = Number.parseInt((kv.PING || '0 received').split(' ')[0])
  record(`Client link + ping over the tunnel (${kv.SERVER_TUN_IP || 'server'})`, pingRecv > 0, kv.PING)

  const exitOk = !!kv.EXIT_IP && kv.EXIT_IP === kv.SERVER_IP && kv.EXIT_IP === ip
  record('Traffic egresses via the VPN (exit node)', exitOk, `client-sees=${kv.EXIT_IP || '?'} server=${kv.SERVER_IP || '?'} expected=${ip}`)

  const passed = checks.filter(c => c.ok).length
  // eslint-disable-next-line no-console
  console.log(`\n  ${passed}/${checks.length} checks passed\n`)
  if (passed !== checks.length)
    process.exit(1)
  // eslint-disable-next-line no-console
  console.log('  ✅ localtunnels VPN verified end-to-end: our stack handshakes, tunnels, and exits.\n')
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n  Verify failed: ${err.message}\n`)
  process.exit(1)
})

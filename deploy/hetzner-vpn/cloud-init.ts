import { CLIENT_WG_IP, SERVER_WG_IP, WG_PORT, WG_SUBNET } from './config'

/**
 * Bash bootstrap that installs stock kernel WireGuard and configures the server
 * as an exit-node VPN: wg0 at 10.8.0.1/24 on UDP 51820, IPv4/IPv6 forwarding,
 * and iptables MASQUERADE so client traffic egresses via the Hetzner IP.
 */
export function wireguardBootstrapScript(): string {
  const prefix = WG_SUBNET.split('/')[1] // 24
  return `#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Wait out any apt/dpkg lock held by unattended-upgrades on first boot.
for _ in $(seq 1 60); do
  if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; then break; fi
  sleep 5
done

apt-get update -y
apt-get install -y wireguard wireguard-tools iptables curl

# The public-facing interface for NAT masquerade (usually eth0 on Hetzner).
WAN="$(ip route show default | awk '{print $5; exit}')"
[ -z "$WAN" ] && WAN=eth0

umask 077
mkdir -p /etc/wireguard
if [ ! -f /etc/wireguard/server_private.key ]; then
  wg genkey > /etc/wireguard/server_private.key
  wg pubkey < /etc/wireguard/server_private.key > /etc/wireguard/server_public.key
fi
SERVER_PRIV="$(cat /etc/wireguard/server_private.key)"

cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = ${SERVER_WG_IP}/${prefix}
ListenPort = ${WG_PORT}
PrivateKey = $SERVER_PRIV
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o $WAN -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o $WAN -j MASQUERADE
EOF
chmod 600 /etc/wireguard/wg0.conf

cat > /etc/sysctl.d/99-wireguard.conf <<EOF
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
EOF
sysctl --system >/dev/null

systemctl enable wg-quick@wg0
systemctl restart wg-quick@wg0

echo ready > /etc/wireguard/.ready
`
}

/**
 * Wrap the bootstrap as Hetzner cloud-init user_data. Mirrors ts-cloud's
 * `wrapCloudInitUserData`: bare \`runcmd\` runs under dash, which chokes on bash
 * syntax, so we write the script to disk (shebang preserved) and \`bash\` it.
 */
export function buildCloudInit(): string {
  const script = wireguardBootstrapScript()
  const path = '/var/lib/cloud/wg-bootstrap.sh'
  const indented = script.split('\n').map(l => `      ${l}`).join('\n')
  return `#cloud-config
write_files:
  - path: ${path}
    permissions: '0755'
    owner: root:root
    content: |
${indented}
runcmd:
  - [ bash, ${path} ]
`
}

/** A ready-to-import WireGuard client config for the given keys/endpoint. */
export function buildClientConfig(opts: {
  clientPrivateKey: string
  serverPublicKey: string
  endpoint: string
}): string {
  return `[Interface]
PrivateKey = ${opts.clientPrivateKey}
Address = ${CLIENT_WG_IP}/32
DNS = 1.1.1.1

[Peer]
PublicKey = ${opts.serverPublicKey}
Endpoint = ${opts.endpoint}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`
}

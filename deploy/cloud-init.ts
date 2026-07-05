import { CLIENT_WG_IP, WG_PORT } from './config'

/**
 * Minimal first-boot bootstrap. The VPN itself is the localtunnels binary we
 * ship post-boot (not an apt package), so cloud-init only needs to ensure the
 * TUN module and a couple of tools are present.
 */
export function buildCloudInit(): string {
  const script = `#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
for _ in $(seq 1 60); do
  if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; then break; fi
  sleep 5
done
apt-get update -y || true
apt-get install -y curl iproute2 iptables || true
modprobe tun || true
echo ready > /var/lib/cloud/lt-ready
`
  const path = '/var/lib/cloud/lt-bootstrap.sh'
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

/**
 * A WireGuard-compatible client config. Because the localtunnels protocol is
 * WireGuard v1, this works with `lt vpn up` (client mode) and, thanks to
 * wire-compatibility, with a stock WireGuard client too.
 */
export function buildClientConfig(opts: {
  clientPrivateKey: string
  serverPublicKey: string
  endpoint: string
}): string {
  return `[Interface]
PrivateKey = ${opts.clientPrivateKey}
Address = ${CLIENT_WG_IP}/24
DNS = 1.1.1.1

[Peer]
PublicKey = ${opts.serverPublicKey}
Endpoint = ${opts.endpoint}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`
}

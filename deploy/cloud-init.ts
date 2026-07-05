import { CLIENT_WG_IP, WG_PORT } from './config'

/**
 * Minimal first-boot bootstrap for the VPN box. The VPN itself is the
 * localtunnels binary we ship post-boot (not an apt package), so first boot
 * only needs the TUN module and a couple of tools. ts-cloud's box provisioner
 * wraps this script into cloud-config (with root SSH access) for us.
 */
export const VPN_BOOTSTRAP_SCRIPT: string = `#!/usr/bin/env bash
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

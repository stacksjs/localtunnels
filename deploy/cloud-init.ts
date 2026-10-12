
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


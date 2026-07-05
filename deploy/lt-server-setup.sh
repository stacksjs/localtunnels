#!/usr/bin/env bash
# Configure this host as a persistent localtunnels VPN server (exit node),
# replacing any stock WireGuard. Generates server + client identities, installs
# a systemd service running `lt vpn up` in server mode, and prints the keys.
#
# Expects /root/lt-linux-x64 (compiled CLI) and /root/libltvpn-linux-x64.so.
set -euo pipefail

BIN=/root/lt-linux-x64
LIB=/root/libltvpn-linux-x64.so
export LTVPN_LIB=$LIB
SERVER_HOME=/root/.lt-server
CLIENT_HOME=/root/.lt-client
SERVER_TUN_IP=10.8.0.1
CLIENT_TUN_IP=10.8.0.2

chmod +x "$BIN"

# Retire stock WireGuard if present so it doesn't hold udp/51820.
systemctl stop 'wg-quick@wg0' 2>/dev/null || true
systemctl disable 'wg-quick@wg0' 2>/dev/null || true
ip link del wg0 2>/dev/null || true

# Ensure the tun module + IP forwarding are available.
modprobe tun 2>/dev/null || true

# Identities (idempotent: keep existing keys on re-run).
SERVER_PUB=$(LOCALTUNNELS_HOME=$SERVER_HOME "$BIN" vpn:keygen 2>/dev/null | awk '/Public key/{print $3}')
CLIENT_PUB=$(LOCALTUNNELS_HOME=$CLIENT_HOME "$BIN" vpn:keygen 2>/dev/null | awk '/Public key/{print $3}')
CLIENT_PRIV=$(cat "$CLIENT_HOME/vpn/privatekey")

cat > /etc/systemd/system/localtunnels-vpn.service <<EOF
[Unit]
Description=localtunnels VPN server (exit node)
After=network-online.target
Wants=network-online.target

[Service]
Environment=LTVPN_LIB=$LIB
Environment=LOCALTUNNELS_HOME=$SERVER_HOME
ExecStart=$BIN vpn:up --listen 51820 --address ${SERVER_TUN_IP}/24 --peer $CLIENT_PUB --allowed-ips ${CLIENT_TUN_IP}/32 --exit-node
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable localtunnels-vpn.service >/dev/null 2>&1
systemctl restart localtunnels-vpn.service
sleep 3

STATUS=$(systemctl is-active localtunnels-vpn.service || true)

echo "SERVER_PUB=$SERVER_PUB"
echo "CLIENT_PUB=$CLIENT_PUB"
echo "CLIENT_PRIV=$CLIENT_PRIV"
echo "SERVICE=$STATUS"

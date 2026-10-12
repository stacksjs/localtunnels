#!/usr/bin/env bash
# Configure this host as a persistent localtunnels VPN exit node, replacing any
# stock WireGuard.
#
# Two services, not one:
#
#   localtunnels-coordinator  hands out tunnel IPs and the peer directory
#   localtunnels-vpn          the datapath, joined to that coordinator as the
#                             exit node
#
# It used to be one service in static mode, with a single `--peer` naming one
# hard-coded client key. That works for exactly one person. Every additional
# client needs another `--peer` flag, a hand-edited unit file and a restart —
# and `--use-exit`, which is what makes full-tunnel mode possible at all, is
# refused outright in static mode. A coordinator is how a client enrols itself
# with a shared key instead, which is the only version of this that serves ten
# people.
#
# Expects /root/lt-linux-x64 (compiled CLI) and /root/libltvpn-linux-x64.so.
set -euo pipefail

BIN=/root/lt-linux-x64
LIB=/root/libltvpn-linux-x64.so
export LTVPN_LIB=$LIB
SERVER_HOME=/root/.lt-server
CLIENT_HOME=/root/.lt-client
COORD_HOME=/root/.lt-coordinator
AUTH_KEY_FILE=$COORD_HOME/authkey
COORD_PORT=51821
TUN_NETWORK=100.100.0.0/16

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

# The shared secret clients present to enrol. Generated once and kept, because
# rotating it on every deploy would silently lock out every client already
# carrying the old one — a re-run is meant to be a no-op, not an eviction.
mkdir -p "$COORD_HOME"
chmod 700 "$COORD_HOME"
if [ ! -s "$AUTH_KEY_FILE" ]; then
  head -c 32 /dev/urandom | base64 | tr -d '=+/' | cut -c1-43 > "$AUTH_KEY_FILE"
  chmod 600 "$AUTH_KEY_FILE"
fi
AUTH_KEY=$(cat "$AUTH_KEY_FILE")

cat > /etc/systemd/system/localtunnels-coordinator.service <<EOF
[Unit]
Description=localtunnels VPN coordinator (peer discovery + IP assignment)
After=network-online.target
Wants=network-online.target

[Service]
Environment=LTVPN_LIB=$LIB
Environment=LOCALTUNNELS_HOME=$COORD_HOME
ExecStart=$BIN vpn:coordinator --port $COORD_PORT --host 0.0.0.0 --network $TUN_NETWORK --auth-key $AUTH_KEY
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

# The datapath joins the coordinator it sits beside, over loopback — the
# directory is the same whichever interface you reach it on, and a public hop
# to your own box is a hop that can fail.
cat > /etc/systemd/system/localtunnels-vpn.service <<EOF
[Unit]
Description=localtunnels VPN exit node
After=network-online.target localtunnels-coordinator.service
Wants=network-online.target
Requires=localtunnels-coordinator.service

[Service]
Environment=LTVPN_LIB=$LIB
Environment=LOCALTUNNELS_HOME=$SERVER_HOME
ExecStart=$BIN vpn:up --listen 51820 --coordinator ws://127.0.0.1:$COORD_PORT --auth-key $AUTH_KEY --exit-node
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable localtunnels-coordinator.service >/dev/null 2>&1
systemctl enable localtunnels-vpn.service >/dev/null 2>&1
systemctl restart localtunnels-coordinator.service
# The datapath waits for the coordinator to be answering, not merely started:
# `Requires=` orders the units but does not hold the second one until the
# first has bound its port, and a node that arrives early simply fails to join.
sleep 2
systemctl restart localtunnels-vpn.service
sleep 3

COORD_STATUS=$(systemctl is-active localtunnels-coordinator.service || true)
STATUS=$(systemctl is-active localtunnels-vpn.service || true)

echo "SERVER_PUB=$SERVER_PUB"
echo "CLIENT_PUB=$CLIENT_PUB"
echo "CLIENT_PRIV=$CLIENT_PRIV"
echo "AUTH_KEY=$AUTH_KEY"
echo "COORD_PORT=$COORD_PORT"
echo "COORDINATOR=$COORD_STATUS"
echo "SERVICE=$STATUS"

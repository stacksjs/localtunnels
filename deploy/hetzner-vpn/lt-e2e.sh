#!/usr/bin/env bash
# End-to-end test of the localtunnels VPN, run entirely on the server.
#
# Stands up the localtunnels VPN server (raw datapath on a TUN, exit-node NAT)
# and a localtunnels client inside a network namespace, then verifies a
# handshake, a ping through the tunnel, and internet egress via the server —
# using OUR stack (lt vpn) on both ends, not kernel WireGuard.
set -uo pipefail

BIN=/root/lt-linux-x64
export LTVPN_LIB=/root/libltvpn-linux-x64.so
NS=ltverify
HOST_IP=192.168.241.1
NS_IP=192.168.241.2
SERVER_TUN_IP=10.8.0.1
CLIENT_TUN_IP=10.8.0.2
SERVER_HOME=/root/.lt-server
CLIENT_HOME=/root/.lt-client

log() { echo "  $*"; }

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "${CLIENT_PID:-}" ] && kill "$CLIENT_PID" 2>/dev/null
  ip netns del $NS 2>/dev/null
  ip link del vethh 2>/dev/null
  rm -rf /etc/netns/$NS 2>/dev/null
  # Drop any tun interfaces our runs left in the main namespace.
  for t in $(ls /sys/class/net 2>/dev/null | grep -E '^tun'); do ip link del "$t" 2>/dev/null; done
}
trap cleanup EXIT
cleanup

# Stop stock WireGuard so it doesn't hold udp/51820 or its own routes.
systemctl stop 'wg-quick@wg0' 2>/dev/null
systemctl disable 'wg-quick@wg0' 2>/dev/null
ip link del wg0 2>/dev/null

# Fresh identities for server + client (separate homes → separate keypairs).
rm -rf "$SERVER_HOME" "$CLIENT_HOME"
SERVER_PUB=$(LOCALTUNNELS_HOME=$SERVER_HOME $BIN vpn:keygen 2>/dev/null | awk '/Public key/{print $3}')
CLIENT_PUB=$(LOCALTUNNELS_HOME=$CLIENT_HOME $BIN vpn:keygen 2>/dev/null | awk '/Public key/{print $3}')
log "server pub: $SERVER_PUB"
log "client pub: $CLIENT_PUB"

# netns + veth so the client reaches the server's UDP listener host-locally.
ip netns add $NS
mkdir -p /etc/netns/$NS
echo "nameserver 1.1.1.1" > /etc/netns/$NS/resolv.conf
ip link add vethh type veth peer name vethc
ip link set vethc netns $NS
ip addr add $HOST_IP/24 dev vethh
ip link set vethh up
ip netns exec $NS ip addr add $NS_IP/24 dev vethc
ip netns exec $NS ip link set vethc up
ip netns exec $NS ip link set lo up

WAN=$(ip route show default | awk '{print $5; exit}')

# Start the localtunnels VPN SERVER (main namespace): TUN + exit-node NAT.
LOCALTUNNELS_HOME=$SERVER_HOME $BIN vpn:up \
  --listen 51820 --address ${SERVER_TUN_IP}/24 \
  --peer "$CLIENT_PUB" --allowed-ips ${CLIENT_TUN_IP}/32 \
  --exit-node --wan "$WAN" > /tmp/lt-server.log 2>&1 &
SERVER_PID=$!
sleep 4

# Start the localtunnels VPN CLIENT (netns): dial the server over the veth.
LOCALTUNNELS_HOME=$CLIENT_HOME ip netns exec $NS env LTVPN_LIB=$LTVPN_LIB $BIN vpn:up \
  --listen 51821 --address ${CLIENT_TUN_IP}/24 \
  --peer "$SERVER_PUB" --endpoint ${HOST_IP}:51820 --allowed-ips 0.0.0.0/0 \
  > /tmp/lt-client.log 2>&1 &
CLIENT_PID=$!
sleep 5

# Route the client's default through its tunnel interface.
CLIENT_TUN=$(ip netns exec $NS sh -c "ls /sys/class/net | grep -E '^tun'" | head -1)
if [ -n "$CLIENT_TUN" ]; then
  ip netns exec $NS ip route add default dev "$CLIENT_TUN" 2>/dev/null
fi
log "client tun: ${CLIENT_TUN:-none}"

sleep 2
# Prime the tunnel.
ip netns exec $NS ping -c1 -W3 $SERVER_TUN_IP >/dev/null 2>&1

# Results.
PING=$(ip netns exec $NS ping -c3 -W3 $SERVER_TUN_IP 2>/dev/null | grep -oE '[0-9]+ received' | head -1 || echo "0 received")
EXIT_IP=$(ip netns exec $NS curl -s --max-time 15 https://api.ipify.org || echo "")
SERVER_IP=$(curl -s --max-time 15 https://api.ipify.org || echo "")

echo "PING=$PING"
echo "EXIT_IP=$EXIT_IP"
echo "SERVER_IP=$SERVER_IP"
echo "--- server log tail ---"; tail -6 /tmp/lt-server.log
echo "--- client log tail ---"; tail -6 /tmp/lt-client.log

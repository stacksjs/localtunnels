# Hetzner WireGuard VPN

A fully-automated, end-to-end-verified WireGuard VPN / exit node on Hetzner
Cloud, provisioned with [`ts-cloud`](https://github.com/stacksjs/ts-cloud)'s
Hetzner driver. The server runs stock kernel WireGuard, so the setup is standard
and interoperable — and it doubles as a live interop target for the in-repo
WireGuard implementation (issue #28).

## Usage

```sh
# 1. Deploy: firewall + server + WireGuard, add a client peer, emit a client config.
bun run deploy/hetzner-vpn/deploy.ts

# 2. Verify end-to-end: handshake + tunnel ping + exit routing.
bun run deploy/hetzner-vpn/verify.ts

# 3. Tear everything down.
bun run deploy/hetzner-vpn/destroy.ts
```

The Hetzner API token is read at runtime from `~/Code/Libraries/ts-cloud/.env`
(`HETZNER_API_TOKEN`) and is never written into this directory. Deploy state and
the generated client config are written locally and git-ignored. The scripts
import ts-cloud's Hetzner client from a sibling checkout at
`~/Code/Libraries/ts-cloud`.

## What gets provisioned

| Resource | Detail |
| --- | --- |
| Server | Ubuntu 24.04, `cx23` (2 vCPU / 4 GB), Falkenstein (`fsn1`) |
| WireGuard | `wg0` at `10.8.0.1/24`, listening `udp/51820` |
| Exit node | IPv4/IPv6 forwarding + `iptables` MASQUERADE (client traffic egresses via the Hetzner IP) |
| Firewall | Hetzner Cloud firewall: `tcp/22`, `udp/51820`, `icmp` |
| Client | A peer at `10.8.0.2` plus a `client-lt.conf` for any WireGuard app |

The client keypair is generated with localtunnels' own WireGuard-compatible
keygen (`generateKeyPair` / `encodeKey`), so a successful handshake also confirms
our keys interoperate with stock kernel WireGuard.

## How the e2e test works

`verify.ts` runs entirely on the server over SSH — no local WireGuard tooling
required. It asserts server posture (interface up, `udp/51820` listening,
forwarding on, NAT rule present), then spins up a network namespace that acts as
a real kernel-WireGuard client. A veth pair connects the netns to the host so the
client reaches `wg0` via a host-local address (no hairpin-NAT dependency), then:

- **Handshake** — `wg show` must report a recent handshake for the client.
- **Tunnel ping** — `ping 10.8.0.1` from inside the netns must succeed.
- **Exit routing** — `curl https://api.ipify.org` from inside the netns must
  return the server's public IP, proving the full path: handshake, encrypt,
  tunnel, server decrypt, forward, NAT, internet, and back through the tunnel.

The test tears its netns/peer down afterward, so it is fully repeatable.

## Using the VPN from your machine

Import `client-lt.conf` into the WireGuard app (macOS/iOS/Android/Windows), or
run `wg-quick up ./client-lt.conf` on Linux. Your traffic then egresses via the
Hetzner server.

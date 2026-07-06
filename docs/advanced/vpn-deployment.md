# VPN Deployment

localtunnels ships a fully‑automated, end‑to‑end‑verified deployment that stands up a cloud VPN / exit node running the localtunnels WireGuard stack — our own Zig crypto core, Linux TUN device, raw datapath, and cryptokey routing, **not** stock kernel WireGuard.

Provisioning goes through [`@stacksjs/ts-cloud`](https://github.com/stacksjs/ts-cloud)'s provider‑agnostic box provisioner, so the same commands work on more than one cloud. **AWS EC2** and **Hetzner Cloud** are supported today (Hetzner is the default); more providers land as ts‑cloud grows.

The scripts live in [`deploy/`](https://github.com/stacksjs/localtunnels/tree/main/deploy).

## Usage

```sh
# Deploy: provision the box + firewall, build/ship the localtunnels binary, start the service
bun run deploy:vpn                     # Hetzner (default)
bun run deploy:vpn -- --provider aws   # AWS EC2

# Verify end-to-end: our stack on both ends (handshake, tunnel ping, exit routing)
bun run verify:vpn

# Tear everything down (provider is remembered from the deploy state)
bun run destroy:vpn
```

## Credentials

- **Hetzner** — set `HCLOUD_TOKEN` or `HETZNER_API_TOKEN`.
- **AWS** — uses the ambient credentials/profile and `AWS_REGION` (default `us-east-1`), same as the rest of the AWS tooling.

Nothing secret is written into the `deploy/` directory. The deploy state and the generated client config are kept locally and git‑ignored.

## How it works

1. **Provision** (`deploy/vpn.ts`, via ts‑cloud's box provisioner): ensure an Ubuntu 24.04 box (`cx23` in `fsn1` on Hetzner, or `t3.micro` on AWS) with `udp/51820` + `icmp` open and your SSH key authorized for root.
2. **Build + ship**: compile the localtunnels CLI for `bun-linux-x64` and cross‑compile `libltvpn.so` for `x86_64-linux-musl` (self‑contained, no libc dependency), then `scp` both to the box.
3. **Service** (`deploy/lt-server-setup.sh`): generate server + client identities with `lt vpn:keygen`, then run `lt vpn:up` in server mode as the systemd unit `localtunnels-vpn` — a TUN interface at `10.8.0.1/24`, listening `udp/51820`, with IP forwarding + `iptables` MASQUERADE so client traffic egresses via the box's public IP (exit node).

Everything on the datapath is the localtunnels implementation. Because the protocol is WireGuard v1, the emitted `client-lt.conf` also works with `lt vpn:up` client mode **or** a stock WireGuard client.

## End‑to‑end verification

`bun run verify:vpn` runs on the server over SSH. It checks server posture (service active, TUN up, `udp/51820` listening, forwarding on, NAT rule present), then spins up a **localtunnels client inside a network namespace** on the box — our stack on both ends — connected to the running server over a host‑local veth, and asserts:

- **Handshake + tunnel ping**: `ping 10.8.0.1` from the netns client succeeds.
- **Exit routing**: `curl https://api.ipify.org` from inside the netns returns the server's public IP, proving the full path (handshake, encrypt, tunnel, server decrypt, server TUN, kernel forward + NAT, internet, back).

The test tears its namespace/client down afterward, so it is fully repeatable.

## Connecting from your machine

Either run the localtunnels client:

```sh
sudo lt vpn:up \
  --address 10.8.0.2/24 \
  --peer <server-key> --endpoint <server-ip>:51820 \
  --allowed-ips 0.0.0.0/0
```

…or import the generated `deploy/client-lt.conf` into any WireGuard client. Your traffic then egresses via the server.

## See also

- [VPN Mode](/features/vpn) — concepts, CLI, and the library API.
- [Self-Hosting](/features/self-hosting) — the HTTP tunnel server (a separate capability from the VPN).

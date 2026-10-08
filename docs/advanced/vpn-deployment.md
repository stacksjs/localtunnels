# VPN Deployment

localtunnels ships a fully‑automated, end‑to‑end‑verified deployment that stands up a cloud VPN / exit node running the localtunnels WireGuard stack — our own Zig crypto core, Linux TUN device, raw datapath, and cryptokey routing, **not** stock kernel WireGuard.

Provisioning goes through [`@stacksjs/ts-cloud`](https://github.com/stacksjs/ts-cloud)'s provider‑agnostic box provisioner, so the same commands work on more than one cloud. **AWS EC2** and **Hetzner Cloud** are supported today (Hetzner is the default); more providers land as ts‑cloud grows. Pick the location with `--region` — `us-west` by default.

The scripts live in [`deploy/`](https://github.com/stacksjs/localtunnels/tree/main/deploy).

## Usage

```sh
# Deploy: provision the box + firewall, build/ship the localtunnels binary, start the service
bun run deploy:vpn                                  # Hetzner, us-west (defaults)
bun run deploy:vpn -- --region eu-central           # another region
bun run deploy:vpn -- --provider aws --region us-west

# Verify end-to-end: our stack on both ends (handshake, tunnel ping, exit routing)
bun run verify:vpn

# Tear everything down (provider + region are remembered from the deploy state)
bun run destroy:vpn
```

## Regions

`--region` (or `DEPLOY_REGION`) takes a provider‑agnostic alias and resolves it to a provider‑native location plus a box size that is actually orderable there. The box is named `localtunnels-vpn-<region>`, so regions do not collide on one account.

| Alias | Hetzner | AWS |
|---|---|---|
| `us-west` *(default)* | `hil` — Hillsboro, OR (`cpx11`) | `us-west-2` — Oregon (`t3.micro`) |
| `us-east` | `ash` — Ashburn, VA (`cpx11`) | `us-east-1` — N. Virginia (`t3.micro`) |
| `eu-central` | `fsn1` — Falkenstein, DE (`cx23`) | `eu-central-1` — Frankfurt (`t3.micro`) |
| `eu-north` | `hel1` — Helsinki, FI (`cx23`) | — |
| `ap-southeast` | `sin` — Singapore (`cpx11`) | `ap-southeast-1` — Singapore (`t3.micro`) |

Two constraints shaped that table:

- **The size travels with the region, not the provider.** Hetzner's US and Singapore locations are cloud‑only and do not carry the `cx` (Intel) or `cax` (ARM) lines — only `cpx` (shared AMD) and `ccx` (dedicated AMD). A `cx23` that provisions fine in `fsn1` is simply not orderable in `hil`.
- **Bandwidth is the binding constraint on an exit node, not CPU.** Hetzner's US and Singapore boxes include ~1 TB of egress against ~20 TB in the EU, so a busy tunnel exhausts its traffic allowance long before it saturates two cores. On AWS, egress is metered per GB, which makes it the expensive way to run this.

## Credentials

- **Hetzner** — set `HCLOUD_TOKEN` or `HETZNER_API_TOKEN`.
- **AWS** — uses the ambient credentials/profile. An `AWS_REGION` in the environment is honoured as a legacy region selector, but only when `--region` is not passed, so it cannot silently redirect an explicit choice.

Nothing secret is written into the `deploy/` directory. The deploy state and the generated client config are kept locally and git‑ignored.

## How it works

1. **Provision** (`deploy/vpn.ts`, via ts‑cloud's box provisioner): ensure an Ubuntu 24.04 box in the selected region (see the table above) with `udp/51820` + `icmp` open and your SSH key authorized for root.
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

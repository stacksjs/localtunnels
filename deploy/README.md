# localtunnels VPN deployment

A fully-automated, end-to-end-verified VPN / exit node that runs the **localtunnels** WireGuard-style stack — our own Zig crypto core ([`packages/vpn-core`](../packages/vpn-core)), Linux TUN device, raw datapath, and cryptokey routing — not stock kernel WireGuard.

Provisioning goes through [`@stacksjs/ts-cloud`](https://github.com/stacksjs/ts-cloud)'s provider-agnostic box provisioner (plus `sshExec` / `scpUpload` / boot waits), so this directory only contains what is localtunnels-specific: the service setup, the first-boot bootstrap, and the e2e verifier. Pick the provider with `--provider hetzner|aws` (Hetzner is the default) and the location with `--region` (`us-west` is the default); more providers land as ts-cloud grows.

## Usage

```sh
# Deploy: provision box + firewall, build/ship the localtunnels binary, start the service.
bun run deploy:vpn                                  # Hetzner, us-west (defaults)
bun run deploy:vpn -- --region eu-central           # another region
bun run deploy:vpn -- --provider aws --region us-west

# Verify end-to-end: our stack on both ends (handshake, tunnel ping, exit routing).
bun run verify:vpn

# Tear everything down (provider + region are remembered from the deploy state).
bun run destroy:vpn
```

### Regions

`--region` (or `DEPLOY_REGION`) takes a provider-agnostic alias and resolves it to a
provider-native location plus a size that is actually orderable there. The box is named
`localtunnels-vpn-<region>`, so regions do not collide on one account.

| Alias | Hetzner | AWS |
|---|---|---|
| `us-west` *(default)* | `hil` — Hillsboro, OR (`cpx11`) | `us-west-2` — Oregon (`t3.micro`) |
| `us-east` | `ash` — Ashburn, VA (`cpx11`) | `us-east-1` — N. Virginia (`t3.micro`) |
| `eu-central` | `fsn1` — Falkenstein, DE (`cx23`) | `eu-central-1` — Frankfurt (`t3.micro`) |
| `eu-north` | `hel1` — Helsinki, FI (`cx23`) | — |
| `ap-southeast` | `sin` — Singapore (`cpx11`) | `ap-southeast-1` — Singapore (`t3.micro`) |

Two things worth knowing before picking one:

- **The size travels with the region, not the provider.** Hetzner's US and Singapore
  locations are cloud-only and do not carry the `cx` (Intel) or `cax` (ARM) lines — only
  `cpx` (shared AMD) and `ccx` (dedicated AMD). A `cx23` that provisions fine in `fsn1` is
  simply not orderable in `hil`.
- **Bandwidth is the binding constraint on an exit node, not CPU.** Hetzner's US and
  Singapore boxes include ~1 TB of egress against ~20 TB in the EU, so a busy tunnel
  exhausts its traffic allowance long before it saturates two cores. On AWS, egress is
  metered per GB, which makes it the expensive way to run this.

The Hetzner token is read from `HCLOUD_TOKEN` / `HETZNER_API_TOKEN` (falling back to the ts-cloud checkout's `.env`); AWS uses the ambient credentials, and an `AWS_REGION` in the environment is honoured as a legacy region selector when `--region` is not passed. Nothing secret is ever written into this directory. Deploy state and the generated client config are written locally and git-ignored.

## How it works

- **Provisioning** (`vpn.ts`, via ts-cloud's box provisioner): ensure an Ubuntu 24.04 box in the selected region (see the table above) with `udp/51820` + `icmp` open and the SSH key authorized.
- **Build + ship**: compile the localtunnels CLI for `bun-linux-x64` and cross-compile `libltvpn.so` for `x86_64-linux-gnu.2.31` (glibc, old enough to load on anything newer), then `scp` both to the server.
- **Service** (`lt-server-setup.sh`): generate server + client identities with `lt vpn keygen`, then run `lt vpn up` in server mode as the systemd unit `localtunnels-vpn` — a TUN interface at `10.8.0.1/24`, listening `udp/51820`, with IP forwarding + `iptables` MASQUERADE so client traffic egresses via the server IP (exit node).

Everything on the datapath — the WireGuard handshake, ChaCha20-Poly1305 transport, the TUN device, and cryptokey routing — is the localtunnels implementation. Because the protocol is WireGuard v1, the emitted `client-lt.conf` also works with `lt vpn up` client mode or a stock WireGuard client.

## E2E test

`verify.ts` runs on the server over SSH. It checks server posture (service active, TUN up, `udp/51820` listening, forwarding on, NAT rule present), then spins up a **localtunnels client inside a network namespace** — our stack on both ends — connected to the running server over a host-local veth, and asserts:

- **Handshake + tunnel ping**: `ping 10.8.0.1` from the netns client succeeds.
- **Exit routing**: `curl https://api.ipify.org` from inside the netns returns the server's public IP, proving the full path through the localtunnels datapath (handshake, encrypt, tunnel, server decrypt, server TUN, kernel forward + NAT, internet, back).

The test tears its netns/client down afterward, so it is fully repeatable.

## Using the VPN from your machine

Run the localtunnels client (`sudo lt vpn up --peer <server-key> --endpoint <ip>:51820 --address 10.8.0.2/24 --allowed-ips 0.0.0.0/0`), or import `client-lt.conf` into a WireGuard client. Your traffic then egresses via the server.

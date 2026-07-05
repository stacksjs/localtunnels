# localtunnels VPN deployment

A fully-automated, end-to-end-verified VPN / exit node that runs the **localtunnels** WireGuard-style stack — our own Zig crypto core ([`packages/vpn-core`](../packages/vpn-core)), Linux TUN device, raw datapath, and cryptokey routing — not stock kernel WireGuard.

Provisioning goes through [`@stacksjs/ts-cloud`](https://github.com/stacksjs/ts-cloud)'s provider-agnostic box provisioner (plus `sshExec` / `scpUpload` / boot waits), so this directory only contains what is localtunnels-specific: the service setup, the first-boot bootstrap, and the e2e verifier. Pick the provider with `--provider hetzner|aws` (Hetzner is the default); more providers land as ts-cloud grows.

## Usage

```sh
# Deploy: provision box + firewall, build/ship the localtunnels binary, start the service.
bun run deploy:vpn                     # Hetzner (default)
bun run deploy:vpn -- --provider aws   # AWS EC2

# Verify end-to-end: our stack on both ends (handshake, tunnel ping, exit routing).
bun run verify:vpn

# Tear everything down.
bun run destroy:vpn
```

The Hetzner token is read from `HCLOUD_TOKEN` / `HETZNER_API_TOKEN` (falling back to the ts-cloud checkout's `.env`); AWS uses the ambient credentials/`AWS_REGION`. Nothing secret is ever written into this directory. Deploy state and the generated client config are written locally and git-ignored.

## How it works

- **Provisioning** (`vpn.ts`, via ts-cloud's box provisioner): ensure an Ubuntu 24.04 box (`cx23` in `fsn1`, or `t3.micro` on AWS) with `udp/51820` + `icmp` open and the SSH key authorized.
- **Build + ship**: compile the localtunnels CLI for `bun-linux-x64` and cross-compile `libltvpn.so` for `x86_64-linux-musl` (self-contained, no libc dependency), then `scp` both to the server.
- **Service** (`lt-server-setup.sh`): generate server + client identities with `lt vpn keygen`, then run `lt vpn up` in server mode as the systemd unit `localtunnels-vpn` — a TUN interface at `10.8.0.1/24`, listening `udp/51820`, with IP forwarding + `iptables` MASQUERADE so client traffic egresses via the server IP (exit node).

Everything on the datapath — the WireGuard handshake, ChaCha20-Poly1305 transport, the TUN device, and cryptokey routing — is the localtunnels implementation. Because the protocol is WireGuard v1, the emitted `client-lt.conf` also works with `lt vpn up` client mode or a stock WireGuard client.

## E2E test

`verify.ts` runs on the server over SSH. It checks server posture (service active, TUN up, `udp/51820` listening, forwarding on, NAT rule present), then spins up a **localtunnels client inside a network namespace** — our stack on both ends — connected to the running server over a host-local veth, and asserts:

- **Handshake + tunnel ping**: `ping 10.8.0.1` from the netns client succeeds.
- **Exit routing**: `curl https://api.ipify.org` from inside the netns returns the server's public IP, proving the full path through the localtunnels datapath (handshake, encrypt, tunnel, server decrypt, server TUN, kernel forward + NAT, internet, back).

The test tears its netns/client down afterward, so it is fully repeatable.

## Using the VPN from your machine

Run the localtunnels client (`sudo lt vpn up --peer <server-key> --endpoint <ip>:51820 --address 10.8.0.2/24 --allowed-ips 0.0.0.0/0`), or import `client-lt.conf` into a WireGuard client. Your traffic then egresses via the server.

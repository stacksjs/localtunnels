# VPN Mode

Beyond exposing a single port, localtunnels can join machines into a private, encrypted layer‑3 network — a self‑hosted, WireGuard‑style VPN. It implements the actual **WireGuard v1 protocol** (`Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s`) in a dependency‑free **Zig** core (`libltvpn`, consumed from Bun over `bun:ffi`), with the control plane in TypeScript.

Because the protocol is WireGuard v1, the peers and configs are wire‑compatible with stock WireGuard clients — you can connect with `lt vpn up` on both ends, or import the generated config into any WireGuard app.

> [!NOTE]
> VPN mode is optional and degrades gracefully. If the native `libltvpn` library isn't present, the HTTP tunnel (`localtunnels start` / `server`) is completely unaffected — only the `vpn:*` commands require it.

## What you can build

- **Private mesh** — connect laptops, servers, and CI boxes into one encrypted `10.x`/`100.x` network with automatic peer discovery and IP assignment.
- **Exit node** — route all of a peer's traffic out through a server's public IP (like a personal VPN), with IP forwarding + NAT handled for you.
- **Point‑to‑point link** — a direct encrypted tunnel between two machines over raw UDP, with UDP hole‑punching and an encrypted relay fallback when a direct path can't be formed.

## Requirements

- **Bun** (the control plane runs on Bun).
- The native **`libltvpn`** shared library. It ships prebuilt in the npm package; to build from source you need [Zig](https://ziglang.org):

  ```sh
  bun run build:native   # → packages/vpn-core/zig-out/lib/libltvpn.*
  bun run test:native    # Zig unit + known-answer + fuzz tests
  ```

- Bringing up a real network interface (`vpn:up`, `vpn:tun-check`) needs **root** (TUN devices: `utun` on macOS, `/dev/net/tun` on Linux). The crypto/demo commands do not.

## CLI commands

```sh
lt vpn:keygen        # Generate (or show) this machine's WireGuard-style identity
lt vpn:selftest      # Verify the native core: keygen, handshake, encryption, replay
lt vpn:demo          # Two peers over real UDP exchanging encrypted traffic
lt vpn:tun-check     # Check whether a TUN device can be opened (needs root)
lt vpn:up            # Bring up a layer-3 VPN interface bridged to a peer (root)
lt vpn:coordinator   # Run the peer-discovery + IP-assignment server
lt vpn:mesh-demo     # Coordinator + two auto-discovering nodes, end-to-end
```

### Generate an identity

Every machine has an X25519 keypair. The private key is stored `0600`; share the **public** key with peers so they can authorize you.

```sh
lt vpn:keygen
# Public key:   Fc3S…keep-this-shareable…=
# Private key:  ~/.localtunnels/vpn/privatekey (keep secret, mode 0600)
```

### Verify the core is healthy

`vpn:selftest` runs an in‑process handshake and an encrypted round‑trip, and confirms replay protection — a fast way to check the native library loaded correctly:

```sh
lt vpn:selftest
# Key generation:      ok
# Handshake (IKpsk2):  ok
# Transport roundtrip: ok
# Replay protection:   ok
```

`vpn:demo` goes further, standing up two peers on real UDP sockets and measuring the handshake time and message throughput.

### Bring up a real interface

`vpn:up` creates a TUN interface and bridges it to a peer using cryptokey routing (packets are encrypted to whichever peer owns the destination IP). Run it as **server** (listening) or **client** (dialing `--endpoint`).

Server (also acting as an exit node):

```sh
sudo lt vpn:up \
  --address 10.8.0.1/24 \
  --listen 51820 \
  --peer <client-pubkey> --allowed-ips 10.8.0.2/32 \
  --exit-node
```

Client (route everything through the server):

```sh
sudo lt vpn:up \
  --address 10.8.0.2/24 \
  --peer <server-pubkey> --endpoint <server-ip>:51820 \
  --allowed-ips 0.0.0.0/0
```

#### `vpn:up` options

| Flag | Description | Default |
|---|---|---|
| `--address <cidr>` | This node's tunnel address, e.g. `10.8.0.1/24` | `100.100.0.1/24` |
| `--listen <port>` | Local UDP port | `51820` |
| `--peer <pubkey>` | Base64 public key of a peer to authorize | — |
| `--allowed-ips <cidrs>` | Comma‑separated CIDRs routed to `--peer` (client default `0.0.0.0/0`) | — |
| `--endpoint <host:port>` | Dial this peer (client mode); omit to listen (server mode) | — |
| `--psk <key>` | Optional base64 preshared key (extra symmetric layer) | — |
| `--exit-node` | Enable IP forwarding + NAT so peer traffic egresses via this host | off |
| `--wan <iface>` | WAN interface for exit‑node NAT (auto‑detected if omitted) | auto |
| `--mtu <mtu>` | Tunnel MTU | `1420` |

### Zero‑config mesh with a coordinator

Instead of exchanging keys and endpoints by hand, run a **coordinator**. Nodes connect to it, get an IP assigned from the tunnel network, discover each other's public keys and endpoints, and form encrypted links automatically. The coordinator only ever brokers metadata — it never sees plaintext, and even the relay fallback carries only ciphertext.

```sh
# On a reachable host
lt vpn:coordinator --network 100.100.0.0/16
# Listening:  ws://<this-host>:51821
# Auth key:   <generated>  — nodes must present this to join

# Reuse a key across restarts instead of minting a new one each time
lt vpn:coordinator --auth-key "$LT_VPN_AUTH_KEY"

# See the whole flow end-to-end (coordinator + two nodes)
lt vpn:mesh-demo
```

#### Joining is authenticated

A coordinator hands out a tunnel IP and the whole peer directory, so it does not
accept anonymous nodes: every `register` has to carry a shared secret, compared
in constant time. `lt vpn:coordinator` mints one on startup and prints it unless
you pass `--auth-key`, and nodes present it as `authKey`:

```ts
const node = new VpnNode({
  keyPair,
  coordinatorUrl: 'ws://coordinator.example:51821',
  authKey: process.env.LT_VPN_AUTH_KEY,
})
```

A public key can also be claimed by only one live connection at a time, so a
second node cannot register a key someone else is using and draw the relayed
frames addressed to it. (It could never read them — those are end-to-end
encrypted between the real peers — but it could strand the node that owns the
key.) Tunnel IPs are leased per public key and survive a reconnect, so a node
that drops and returns keeps its address.

`--insecure-no-auth` turns the check off for localhost and testing. On anything
reachable it means exactly what it says.

#### Bringing up an interface on a coordinator

`lt vpn:up --coordinator` joins through the control plane instead of taking
peers on the command line. The tunnel address is whatever the coordinator
assigns, and routes are derived from its directory — each peer is routed its own
assigned address — so a node needs to know nothing about the other members:

```sh
sudo lt vpn:up \
  --coordinator ws://coordinator.example:51821 \
  --auth-key "$LT_VPN_AUTH_KEY"
```

`--address`, `--peer`, `--allowed-ips` and `--endpoint` are for the static mode
and are ignored here. Peers appearing and leaving are logged as they happen, and
a peer that leaves has its routes withdrawn — which also revokes its permission
to source that address.

The same thing from the library, which is what a GUI would drive:

```ts
import { VpnInterface, loadOrCreateIdentity } from 'localtunnels'

const vpn = new VpnInterface({
  keyPair: loadOrCreateIdentity().keyPair,
  coordinatorUrl: 'ws://coordinator.example:51821',
  authKey: process.env.LT_VPN_AUTH_KEY,
})
const { name, address } = await vpn.up()  // e.g. utun4, 100.100.0.2
// ... later
vpn.down()
```

## Concepts

### The native core (`libltvpn`)

The datapath — the WireGuard handshake, ChaCha20‑Poly1305 transport, the TUN device, and cryptokey routing — is implemented in Zig and validated for wire‑correctness against an independent reference implementation (`packages/vpn-core/testvectors/wg_ref.py`, itself checked against the RFC 7748 / 8439 / 7693 vectors). The Zig code produces byte‑identical handshake messages, transport keys, and the canonical WireGuard `InitialChainKey`.

### Cryptokey routing (allowed‑ips)

Like WireGuard, each peer is associated with a set of allowed IP ranges. Outbound packets are encrypted to the peer that owns the destination address; inbound packets are only accepted from the peer allowed to send that source. A client typically uses `0.0.0.0/0` (send everything to the server); a server allows just the client's tunnel IP (e.g. `10.8.0.2/32`).

### Exit node

With `--exit-node`, the server enables IPv4 forwarding and installs an `iptables` MASQUERADE rule so a client routing `0.0.0.0/0` through it egresses to the internet via the server's public IP — a personal VPN.

In static mode the client opts in by naming the route: `--allowed-ips 0.0.0.0/0`.
Through a coordinator it is discovered instead. The server advertises itself, and
clients ask for an exit by key or by `auto`:

```sh
# On the server: NAT, and tell the network it is an exit
sudo lt vpn:up --coordinator ws://coordinator.example:51821 \
  --auth-key "$LT_VPN_AUTH_KEY" --exit-node

# On a laptop: send everything not bound for a tunnel peer through it
sudo lt vpn:up --coordinator ws://coordinator.example:51821 \
  --auth-key "$LT_VPN_AUTH_KEY" --use-exit <server-pubkey>
```

Tunnel peers keep their direct routes either way — longest prefix wins, so only
traffic no peer claims takes the default route. With no exit configured, that
traffic has no route at all and is dropped rather than leaking out of the host's
own interface.

> [!IMPORTANT]
> `--use-exit auto` takes the lowest-sorted peer that advertises. The choice is
> deterministic, so every node agrees and a reconnect will not quietly move your
> traffic to a different volunteer — but the advertisement is a **claim the
> coordinator cannot verify**, and any member holding the auth key can make it.
> Routing all of your traffic through a peer you did not choose means trusting
> whoever that peer turns out to be. **Pin the public key** for anything you care
> about; `auto` is for networks where you control every member.

Advertising and NAT are separate steps. `--exit-node` does both, but
`advertiseExitNode` in the library only advertises — pair it with
`enableExitNode`, or clients will route traffic into a node that drops it.

### NAT traversal and relay

Peers behind NAT exchange UDP hole‑punching datagrams to open a direct link. When a direct path can't be formed, traffic falls back to an encrypted relay through the coordinator — which still only sees ciphertext.

> [!NOTE]
> Endpoint discovery is currently *reflective*, not STUN‑based: the coordinator combines the source address it sees on the node's WebSocket with the UDP port the node reports for itself. That is accurate on a LAN, behind the same NAT, and behind a cone NAT that preserves the port — and those cases punch through to a direct link. A symmetric NAT that rewrites the port per destination gets an endpoint that doesn't match, so the link settles on the encrypted relay instead of a direct path. Real STUN binding discovery is tracked in [#33](https://github.com/stacksjs/localtunnels/issues/33).

## Library API

The VPN primitives are exported from the `localtunnels/vpn` subpath. The most common entry points:

```ts
import {
  generateKeyPair,
  encodeKey,
  VpnPeer,
  VpnCoordinator,
  VpnNode,
  isVpnAvailable,
} from 'localtunnels/vpn'

// Guard so the rest of your app keeps working without the native lib.
if (!isVpnAvailable()) {
  console.warn('libltvpn not available — VPN features disabled')
}
```

### Two peers over UDP

```ts
import { generateKeyPair, VpnPeer } from 'localtunnels/vpn'

const alice = generateKeyPair()
const bob = generateKeyPair()

const a = new VpnPeer({ keyPair: alice, host: '127.0.0.1' })
const b = new VpnPeer({ keyPair: bob, host: '127.0.0.1' })
a.addPeer({ publicKey: bob.publicKey })
b.addPeer({ publicKey: alice.publicKey })
await a.start()
await b.start()

b.on('message', (data, from) => b.send(from, data)) // echo
a.on('message', data => console.log('got', new TextDecoder().decode(data)))

await a.connect(bob.publicKey, '127.0.0.1', b.port)
a.send(bob.publicKey, new TextEncoder().encode('hello over the tunnel'))
```

### Auto‑discovered mesh

```ts
import { generateKeyPair, VpnCoordinator, VpnNode } from 'localtunnels/vpn'

const coordinator = new VpnCoordinator({ host: '127.0.0.1' })
coordinator.start()
const url = `ws://127.0.0.1:${coordinator.port}`

const alice = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url })
const bob = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url })

const aInfo = await alice.start() // { assignedIp, network }
const bInfo = await bob.start()

bob.on('message', (data, from) => bob.send(from, data))
alice.send(bob.publicKeyB64, new TextEncoder().encode('mesh hello'))
```

### Key exports

| Export | Purpose |
|---|---|
| `generateKeyPair()` | New X25519 identity (`{ publicKey, privateKey }` as `Uint8Array`) |
| `encodeKey()` / `decodeKey()` | Base64 ↔ raw key bytes |
| `publicKeyFromPrivate()` | Derive the public key from a private key |
| `VpnPeer` | A single peer over raw UDP (`addPeer`, `start`, `connect`, `send`, `stop`) |
| `VpnCoordinator` | Peer‑discovery + IP‑assignment server (`start`, `stop`, `port`) |
| `VpnNode` | Self‑configuring node that joins via a coordinator |
| `TunDevice` | Open/read/write a TUN device (`TunDevice.open()`) |
| `Handshake`, `Session` | Low‑level IKpsk2 handshake and transport session |
| `RoutingTable` | Cryptokey routing (allowed‑ips → peer) |
| `enableExitNode()` | Enable forwarding + NAT for an interface |
| `isVpnAvailable()` | Whether `libltvpn` is present and loadable (never throws) |

## Feature summary

- X25519 identities, ChaCha20‑Poly1305 transport with RFC‑6479 replay protection, and session rekeying.
- Cryptokey routing (allowed‑ips) and an optional preshared key.
- A coordinator for zero‑config peer discovery and IP assignment.
- UDP hole‑punching with an encrypted relay fallback (the coordinator only ever sees ciphertext). See the note under [NAT traversal and relay](#nat-traversal-and-relay) for which NAT types reach a direct path today.
- IPv6 and exit‑node routing.
- TUN devices on macOS (`utun`) and Linux (`/dev/net/tun`); Windows support in the native core.

## Deploying a VPN server

To provision a cloud VPN / exit node end‑to‑end (build, ship, and run the localtunnels VPN as a systemd service, on AWS or Hetzner), see **[VPN Deployment](/advanced/vpn-deployment)**.

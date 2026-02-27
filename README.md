<p align="center"><img src="https://github.com/stacksjs/localtunnels/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# localtunnels

> A zero-config local tunnel that's simple, lightweight, and secure.

## Features

- Simple, lightweight local tunnel
- Security built-in, including HTTPS
- Smart subdomains _(APP_NAME-aware, memorable random names, auto-collision handling)_
- Auto DNS resolution _(bypasses broken system DNS on macOS `.dev` TLD)_
- IAC, self-hostable _(via AWS)_
- CLI & Library

## Install

```sh
bun install -d localtunnels
```

## Get Started

There are two ways of using this local tunnel: _as a library or as a CLI._

### Library

Given the npm package is installed:

```ts
import { startLocalTunnel } from 'localtunnels'

const client = await startLocalTunnel({
  port: 3000,
  // subdomain: 'myapp', // optional, see Subdomains below
  // verbose: true, // optional
})

console.log(`Tunnel URL: ${client.getTunnelUrl()}`)

// later...
client.disconnect()
```

Or use the `TunnelClient` class directly:

```ts
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
})

client.on('connected', (info) => {
  console.log(`Public URL: ${info.url}`)
})

await client.connect()
```

### CLI

```sh
# Expose local port 3000 (default)
localtunnels start

# Expose a specific port
localtunnels start --port 8080

# Request a specific subdomain
localtunnels start --port 3000 --subdomain myapp

# Use a custom tunnel server
localtunnels start --port 3000 --server mytunnel.example.com

# Disable auto DNS resolution
localtunnels start --port 3000 --no-manage-hosts

# Show all requests
localtunnels start --port 3000 --verbose
```

Output:

```
  Connecting to localtunnel.dev...

  Public:     https://swift-fox.localtunnel.dev
  Forwarding: https://swift-fox.localtunnel.dev -> http://localhost:3000

  Press Ctrl+C to stop sharing
```

## Subdomains

localtunnels uses a smart subdomain resolution chain:

1. **Explicit flag**: `--subdomain myapp` or `subdomain: 'myapp'` in code
2. **`APP_NAME` env var**: automatically slugified _(e.g. `My Cool App` becomes `my-cool-app`)_
3. **Random memorable name**: adjective-noun combos like `swift-fox`, `bold-comet`, `lazy-elk`

### Collision Handling

If a subdomain is already in use by another client, localtunnels automatically appends an incrementing suffix:

- `myapp` is taken -> tries `myapp-2`
- `myapp-2` is taken -> tries `myapp-3`
- and so on...

This happens transparently — no crashes, no manual intervention needed.

### Examples

```sh
# Uses APP_NAME env var if set
APP_NAME="My App" localtunnels start --port 3000
# -> https://my-app.localtunnel.dev

# Explicit subdomain
localtunnels start --port 3000 --subdomain demo
# -> https://demo.localtunnel.dev

# Random memorable name (no APP_NAME, no --subdomain)
localtunnels start --port 3000
# -> https://bold-comet.localtunnel.dev
```

## DNS Resolution

On some machines (especially macOS with `.dev` TLD), the system DNS resolver can't reach `localtunnel.dev` even though tools like `dig` and `nslookup` work fine. localtunnels detects this automatically and resolves the server IP via DNS-over-HTTPS (Cloudflare) or `dig @8.8.8.8`, then connects directly to the IP.

This is on by default. Disable with `--no-manage-hosts` or `manageHosts: false`.

## Self-Hosting

Start your own tunnel server:

```sh
localtunnels server --port 8080 --domain mytunnel.example.com
```

Or deploy to AWS:

```sh
localtunnels deploy --domain mytunnel.example.com --key-name my-keypair
```

## Benchmarks

localtunnels ships with a benchmark suite built on [mitata](https://github.com/evanwashere/mitata). The suite covers utility functions, connection lifecycle, request throughput, latency distribution, scalability under load, and cross-tool comparisons.

```sh
# Run all benchmarks
bun benchmarks/index.ts

# Run individual suites
bun benchmarks/utils.ts          # Utility function microbenchmarks
bun benchmarks/connection.ts     # Connection lifecycle
bun benchmarks/throughput.ts     # Request forwarding throughput
bun benchmarks/latency.ts        # End-to-end latency distribution
bun benchmarks/scalability.ts    # Multi-connection scalability
bun benchmarks/comparison.ts     # Cross-tool comparison
```

### Results

_Measured on Apple M3 Pro, bun 1.3.10 (arm64-darwin). Competitor tools: cloudflared 2026.2.0, ngrok 3.36.1, bore-cli 0.6.0, frpc 0.67.0._

#### localtunnels vs Competitors — Request Forwarding

Real end-to-end request forwarding through each tool's tunnel. localtunnels runs on localhost, bore routes through bore.pub.

**GET `/` (plain text):**

| Tool | avg | vs direct |
|---|---|---|
| Direct (no tunnel) | 35.67 µs | 1x (baseline) |
| **localtunnels** | **105.97 µs** | 2.97x |
| **bore** | 188.60 ms | 5,290x |

**GET `/json` (10-item JSON array):**

| Tool | avg | vs direct |
|---|---|---|
| Direct (no tunnel) | 30.67 µs | 1x (baseline) |
| **localtunnels** | **109.58 µs** | 3.57x |
| **bore** | 180.11 ms | 5,872x |

**POST 1 KB body:**

| Tool | avg | vs direct |
|---|---|---|
| Direct (no tunnel) | 29.43 µs | 1x (baseline) |
| **localtunnels** | **106.89 µs** | 3.63x |
| **bore** | 180.74 ms | 6,143x |

**10 Concurrent Requests (GET /json):**

| Tool | avg | vs direct |
|---|---|---|
| Direct (no tunnel) | 108.05 µs | 1x (baseline) |
| **localtunnels** | **592.58 µs** | 5.48x |
| **bore** | 188.46 ms | 1,744x |

#### localtunnels vs Competitors — Startup Time

| Tool | Time to tunnel ready |
|---|---|
| **localtunnels** | **~324 µs** |
| **bore** | 195 ms |
| **Cloudflare Tunnels** | 3,969 ms |

#### localtunnels vs Competitors — Subdomain Generation

| Tool | Strategy | Example Output | avg | vs localtunnels |
|---|---|---|---|---|
| **localtunnels** | Adjective-noun | `fast-deer`, `quick-surf`, `fond-opal` | **3.00 ns** | 1x |
| **frp** | Counter prefix | `tunnel-1`, `tunnel-2`, `tunnel-3` | 25.66 ns | 8.55x slower |
| **Cloudflare Tunnels** | UUID prefix | `a7ed76b1`, `ee76358d`, `d25abca3` | 42.69 ns | 14.23x slower |
| **Expose** | UUID slug | `a432cef06efa`, `15b07c93bc27` | 96.60 ns | 32.20x slower |
| **bore** | Short hex | `df28e3`, `1cb723`, `06189e` | 191.94 ns | 63.98x slower |
| **ngrok** | Random hex | `c2a8b92e`, `5c219911`, `65a2aba4` | 279.09 ns | 93.03x slower |

#### localtunnels vs Competitors — ID Generation

| Tool | Strategy | avg | vs fastest |
|---|---|---|---|
| **frp** | Counter-based | **22.19 ns** | 1x |
| **ngrok / Cloudflare Tunnels** | `crypto.randomUUID()` | 30.94 ns | 1.39x |
| **localtunnels** | `crypto.randomUUID().substring()` | 42.42 ns | 1.91x |
| **bore** | `crypto.getRandomValues` | 358.60 ns | 16.16x |

#### localtunnels vs Competitors — Protocol Overhead

localtunnels uses WebSocket + JSON. bore and frp use binary protocols. This measures per-message encode/decode cost.

| Tool | Operation | avg | vs fastest |
|---|---|---|---|
| **localtunnels** | JSON serialize | **123.05 ns** | 1x |
| **bore / frp** | Binary header encode | 159.04 ns | 1.29x |
| **bore / frp** | Binary header decode | 176.33 ns | 1.43x |
| **localtunnels** | JSON parse | 434.87 ns | 3.53x |

#### localtunnels vs Competitors — State Machine

| Tool | Strategy | avg | vs fastest |
|---|---|---|---|
| **frp / bore** (Go-style) | Enum-based | **2.20 ns** | 1x |
| **localtunnels** | String-based | 2.35 ns | 1.07x |
| **ngrok / Expose** | Object-based | 3.54 ns | 1.61x |

#### Throughput (GET, direct vs tunnel)

| Payload | Direct | localtunnels | Overhead |
|---|---|---|---|
| 20 B | 33 µs | 102 µs | 3.1x |
| 1 KB | 30 µs | 116 µs | 3.8x |
| 64 KB | 47 µs | 350 µs | 7.5x |
| 512 KB | 144 µs | 2.08 ms | 14.4x |
| 1 MB | 234 µs | 4.16 ms | 17.8x |

#### Latency

| Scenario | avg |
|---|---|
| Instant response (pure overhead) | 182 µs |
| JSON API (10-item array) | 210 µs |
| With 10 ms backend | 10.44 ms _(1.05x over direct)_ |
| With 50 ms backend | 50.51 ms _(1.01x over direct)_ |

#### Scalability

| Active Tunnels | Request Latency (avg) |
|---|---|
| 1 | 235 µs |
| 10 | 237 µs |
| 50 | 234 µs |

#### Connection Lifecycle

| Operation | avg |
|---|---|
| Server start + stop | 325 µs |
| Client connect + register + disconnect | 296 µs |
| 5 clients sequential | 1.61 ms |
| 5 clients concurrent | 921 µs |

The cross-tool comparison auto-detects installed tunneling tools (`cloudflared`, `ngrok`, `bore`, `frpc`, `expose`) and includes them in results. See the [benchmark documentation](https://localtunnels.sh/benchmarks) for full results, suite descriptions, and methodology.

## Testing

```sh
bun test
```

## Changelog

Please see our [releases](https://github.com/stacksjs/localtunnels/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where `localtunnels` is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States 🌎

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/localtunnels?style=flat-square
[npm-version-href]: https://npmjs.com/package/localtunnels
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/localtunnels/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/localtunnels/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/localtunnels/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/localtunnels -->

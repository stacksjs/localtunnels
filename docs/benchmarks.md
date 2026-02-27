# Benchmarks

localtunnels includes a comprehensive benchmark suite built with [mitata](https://github.com/evanwashere/mitata). The benchmarks measure utility function performance, connection lifecycle timing, request forwarding throughput, end-to-end latency, multi-connection scalability, and cross-tool comparisons.

## Running Benchmarks

### Prerequisites

```sh
bun install
```

mitata is included as a dev dependency.

### Run All Benchmarks

```sh
bun benchmarks/index.ts
```

### Run Individual Suites

```sh
bun benchmarks/utils.ts          # Utility function microbenchmarks
bun benchmarks/connection.ts     # Connection lifecycle
bun benchmarks/throughput.ts     # Request forwarding throughput
bun benchmarks/latency.ts        # End-to-end latency distribution
bun benchmarks/scalability.ts    # Multi-connection scalability
bun benchmarks/comparison.ts     # Cross-tool comparison
```

### Filter Suites

```sh
bun benchmarks/index.ts throughput    # Run only suites matching "throughput"
bun benchmarks/index.ts latency       # Run only suites matching "latency"
```

## Benchmark Suites

### Utility Functions (`utils.ts`)

Microbenchmarks for the pure-computation functions used throughout the tunnel lifecycle.

| Group | What it measures |
|---|---|
| ID Generation | `generateId()` at various lengths vs `crypto.randomUUID()` and `Math.random().toString(36)` |
| Subdomain Generation | `generateSubdomain()` (adjective-noun) vs UUID-based and hex-based approaches |
| Subdomain Validation | `isValidSubdomain()` with valid and invalid inputs, regex overhead |
| Port Validation | `isValidPort()` with valid and invalid port numbers |
| Host Parsing | `parseHost()` across simple, port-bearing, and multi-segment hostnames |
| URL Formatting | `formatUrl()` vs template literals vs `new URL()` |
| Backoff Calculation | `calculateBackoff()` at various retry attempt counts |
| Headers Conversion | `headersToRecord()` with 2, 10, and 30 headers vs `Object.fromEntries()` |
| JSON Serialization | Serialize/parse WebSocket protocol messages (ready, request, response) |
| Base64 Encoding/Decoding | `Buffer.toString('base64')` and `Buffer.from(base64)` at 1 KB, 64 KB, and 1 MB |

### Connection Lifecycle (`connection.ts`)

Measures the time it takes to start a server, establish WebSocket connections, register subdomains, and tear down cleanly.

| Group | What it measures |
|---|---|
| Server Lifecycle | `TunnelServer.start()` + `stop()` round-trip |
| Client Connection Lifecycle | Full connect → register → disconnect cycle |
| Client Connect Time | Connection + registration only (no disconnect) |
| Sequential Multi-Client Connect | 5 clients connecting one after another |
| Concurrent Multi-Client Connect | 5 clients connecting simultaneously via `Promise.all` |
| Server Stats | `getStats()` and `getStats(includeSubdomains)` retrieval time |

### Throughput (`throughput.ts`)

Measures request forwarding speed through a real tunnel (server + client + local HTTP server) at various payload sizes.

| Group | What it measures |
|---|---|
| GET Response — Direct | Baseline latency hitting the local server directly (no tunnel) at 20 B, 1 KB, 64 KB, 512 KB, 1 MB |
| GET Response — Through Tunnel | Same payloads routed through the tunnel |
| POST Echo — Direct | POST request/response round-trip without tunnel |
| POST Echo — Through Tunnel | POST request/response round-trip through the tunnel |
| Tunnel Overhead | Side-by-side comparison (direct vs tunnel) with boxplot for tiny, 1 KB, 64 KB, and POST 1 KB |
| Concurrent GET | 1, 5, 10, and 25 concurrent requests through the tunnel |
| Mixed Methods | GET, POST, PUT, PATCH, DELETE through the tunnel |

### Latency (`latency.ts`)

Focuses on latency distribution (p50, p75, p99) using boxplot visualization.

| Group | What it measures |
|---|---|
| Instant Response | Pure tunnel overhead — backend responds immediately |
| JSON API | Typical JSON response (10-item array) |
| Webhook POST | Stripe-style webhook payload round-trip |
| Many Headers | Response with 20 custom headers |
| 10ms Backend | Tunnel overhead relative to a 10 ms backend |
| 50ms Backend | Tunnel overhead relative to a 50 ms backend |
| Concurrent Latency | Latency at 1, 5, 10, and 25 concurrent requests |
| Authenticated Request | Request with Authorization, User-Agent, X-Request-ID, and other typical headers |

### Scalability (`scalability.ts`)

Tests how the server performs under increasing connection counts and concurrent request load.

| Group | What it measures |
|---|---|
| Register N Clients | Time to register 1, 5, 10, and 25 tunnel clients |
| Request Latency Under Load | Request time with 1, 10, and 50 active tunnels registered |
| Concurrent Requests Under Load | 10 concurrent requests with 1, 10, and 50 active tunnels |
| Server Stats Under Load | `getStats()` with 50 active tunnels |
| WebSocket Protocol Parse | `JSON.parse` for ready, ping, request, and response messages |
| WebSocket Protocol Serialize | `JSON.stringify` for the same message types |
| Connection Map Operations | Map lookup, has-check, key iteration, and connection counting with 100 subdomains |

### Cross-Tool Comparison (`comparison.ts`)

Compares localtunnels against other tunneling solutions. The benchmark auto-detects which tools are installed on the system and includes them in the results. Tools that are not installed are skipped.

**Detected tools:**

| Tool | Binary | Detection |
|---|---|---|
| Cloudflare Tunnels | `cloudflared` | `cloudflared --version` |
| ngrok | `ngrok` | `ngrok version` |
| bore | `bore` | `bore --version` |
| frp | `frpc` | `frpc --version` |
| Expose | `expose` | `expose --version` |

**Benchmark groups:**

| Group | What it measures |
|---|---|
| Startup Time | Server/process startup time for each tool |
| Connection Establishment | Full connect + register + disconnect for localtunnels |
| Request Forwarding | Direct baseline vs localtunnels for GET `/` and GET `/json` |
| ID Generation Strategy | `generateId()` vs `crypto.randomUUID()` vs `crypto.getRandomValues` vs counter-based |
| Subdomain Strategy | Adjective-noun vs random hex vs UUID prefix |
| Protocol Message Overhead | JSON serialize/parse vs binary protocol header encode/decode |
| Payload Serialization | `JSON.stringify`, `JSON.parse`, `TextEncoder.encode`, `TextDecoder.decode` |
| State Machine | String-based vs enum vs object-based state transitions |
| Concurrent Throughput | 1, 10, and 25 concurrent requests through localtunnels |
| Allocation Pressure | Object creation cost for Headers, request messages, response messages, and `TunnelClient` instances |

## Results

_Measured on Apple M3 Pro, ~3.91 GHz, bun 1.3.10 (arm64-darwin). All benchmarks run on localhost with no external network hops. Each benchmark is run multiple times by mitata with automatic warmup and statistical analysis._

### Utility Functions

#### ID Generation

| Benchmark | avg | vs fastest |
|---|---|---|
| `generateId(8)` | 120.02 ns | — |
| `generateId(16)` | 164.67 ns | — |
| `generateId(32)` | 251.03 ns | — |
| `crypto.randomUUID()` | 31.94 ns | 1x (fastest) |
| `Math.random().toString(36)` | 21.60 ns | 1x (fastest) |

#### Subdomain Generation

| Benchmark | avg | vs fastest |
|---|---|---|
| `generateSubdomain()` (adjective-noun) | 2.08 ns | 1x (fastest) |
| UUID-based | 40.42 ns | 19.43x |
| Hex-based | 201.66 ns | 96.95x |

#### Validation

| Benchmark | avg |
|---|---|
| `isValidSubdomain("swift-fox")` | 4.80 ns |
| `isValidSubdomain("x")` (invalid) | 3.52 ns |
| `isValidPort(3000)` | 1.44 ns |
| `isValidPort(99999)` (invalid) | 1.49 ns |

#### Host Parsing

| Benchmark | avg |
|---|---|
| `parseHost("localhost")` | 6.00 ns |
| `parseHost("example.com:8080")` | 7.99 ns |
| `parseHost("sub.domain.example.com")` | 8.14 ns |

#### URL Formatting

| Benchmark | avg | vs fastest |
|---|---|---|
| `formatUrl()` | 1.06 ns | 1x (fastest) |
| Template literal | 2.70 ns | 2.54x |
| `new URL()` | 229.90 ns | 216.89x |

#### Backoff Calculation

| Benchmark | avg |
|---|---|
| Attempt 1 | 1.07 ns |
| Attempt 5 | 1.07 ns |
| Attempt 10 | 1.05 ns |

#### Headers Conversion

| Benchmark | avg | vs fastest |
|---|---|---|
| `headersToRecord()` (2 headers) | 70.44 ns | 1x (fastest) |
| `Object.fromEntries()` (2 headers) | 143.74 ns | 2.04x |
| `headersToRecord()` (10 headers) | 334.98 ns | — |
| `headersToRecord()` (30 headers) | 979.99 ns | — |

#### JSON Serialization

| Benchmark | avg |
|---|---|
| Serialize ready message | 86.08 ns |
| Serialize request message | 133.74 ns |
| Serialize response message | 173.34 ns |
| Parse ready message | 148.86 ns |
| Parse request message | 255.88 ns |
| Parse response message | 356.36 ns |

#### Base64 Encoding/Decoding

| Benchmark | avg |
|---|---|
| Encode 1 KB | 358.72 ns |
| Encode 64 KB | 11.88 µs |
| Encode 1 MB | 281.48 µs |
| Decode 1 KB | 397.63 ns |
| Decode 64 KB | 8.64 µs |
| Decode 1 MB | 202.57 µs |

### Connection Lifecycle

| Benchmark | avg |
|---|---|
| Server start + stop | 325.14 µs |
| Client connect + register + disconnect | 296.37 µs |
| Client connect + register (no disconnect) | 233.76 µs |
| 5 clients sequential | 1.61 ms |
| 5 clients concurrent (`Promise.all`) | 921.48 µs |
| `getStats()` | 77.21 ns |
| `getStats(includeSubdomains)` | 295.56 ns |

5 concurrent clients connect 1.75x faster than 5 sequential clients.

### Throughput

#### GET Response — Direct (baseline, no tunnel)

| Payload | avg |
|---|---|
| 20 B | 32.59 µs |
| 1 KB | 30.47 µs |
| 64 KB | 46.57 µs |
| 512 KB | 143.87 µs |
| 1 MB | 233.80 µs |

#### GET Response — Through Tunnel

| Payload | avg |
|---|---|
| 20 B | 102.28 µs |
| 1 KB | 109.79 µs |
| 64 KB | 350.38 µs |
| 512 KB | 2.08 ms |
| 1 MB | 4.16 ms |

#### POST Echo — Direct vs Tunnel

| Payload | Direct | Tunnel |
|---|---|---|
| 1 KB POST | 32.24 µs | 123.91 µs |
| 64 KB POST | 64.15 µs | 549.31 µs |

#### Tunnel Overhead (direct vs tunnel, side by side)

| Payload | Direct | Tunnel | Ratio |
|---|---|---|---|
| Tiny (20 B) | 33 µs | 100 µs | 3.0x |
| 1 KB | 30 µs | 116 µs | 3.8x |
| 64 KB | 50 µs | 328 µs | 6.5x |
| 512 KB | 144 µs | 2.08 ms | 14.4x |
| 1 MB | 234 µs | 4.16 ms | 17.8x |
| POST 1 KB | 32 µs | 118 µs | 3.6x |

#### Concurrent GET (through tunnel)

| Concurrency | avg |
|---|---|
| 1 request | 108.49 µs |
| 5 concurrent | 318.26 µs |
| 10 concurrent | 1.14 ms |
| 25 concurrent | 1.43 ms |

#### Mixed Methods (through tunnel)

| Method | avg |
|---|---|
| GET | 143.49 µs |
| POST | 243.67 µs |
| PUT | 434.18 µs |
| PATCH | 233.73 µs |
| DELETE | 142.21 µs |

### Latency

#### Pure Tunnel Overhead

| Scenario | avg |
|---|---|
| Instant response (backend returns immediately) | 182.73 µs |
| JSON API (10-item array) | 210.78 µs |
| Webhook POST (Stripe-style payload) | 263.09 µs |
| Many headers (20 custom headers) | 232.07 µs |
| Authenticated request (Authorization, User-Agent, etc.) | 213.65 µs |

#### Tunnel Overhead Relative to Backend Latency

| Backend Delay | Direct | Tunnel | Overhead |
|---|---|---|---|
| 10 ms | 9.94 ms | 10.44 ms | 1.05x |
| 50 ms | 50.01 ms | 50.51 ms | 1.01x |

The tunnel adds a roughly fixed ~90–180 µs of overhead regardless of backend latency. For backends with 10 ms+ response times, the overhead is negligible.

#### Concurrent Latency

| Concurrency | avg |
|---|---|
| 1 request | 186.53 µs |
| 5 concurrent | 286.25 µs |
| 10 concurrent | 410.62 µs |
| 25 concurrent | 819.14 µs |

### Scalability

#### Client Registration Time

| Clients | avg |
|---|---|
| 1 | 224.32 µs |
| 5 | 916.27 µs |
| 10 | 1.84 ms |
| 25 | 4.49 ms |

#### Request Latency Under Load

| Active Tunnels | avg (single request) |
|---|---|
| 1 | 235.65 µs |
| 10 | 237.27 µs |
| 50 | 234.20 µs |

Request latency remains flat regardless of the number of active tunnel connections on the server.

#### Concurrent Requests Under Load

| Active Tunnels | avg (10 concurrent requests) |
|---|---|
| 1 | 856.30 µs |
| 10 | 836.24 µs |
| 50 | 858.18 µs |

#### WebSocket Protocol Operations

| Operation | avg |
|---|---|
| Parse ready message | 128.04 ns |
| Parse ping message | 88.48 ns |
| Parse request message | 264.90 ns |
| Parse response message | 355.23 ns |
| Serialize ready message | 86.70 ns |
| Serialize ping message | 48.08 ns |
| Serialize request message | 135.73 ns |
| Serialize response message | 180.89 ns |

#### Connection Map Operations (100 subdomains)

| Operation | avg |
|---|---|
| Map.get() | 4.78 ns |
| Map.has() | 1.14 ns |
| Iterate keys | 379.36 ns |
| Count connections | 1.02 µs |

### Cross-Tool Comparison

The comparison suite benchmarks localtunnels against other popular tunneling tools with real, running tunnels. Each tool is started, a tunnel is established, and requests are forwarded through each tool's tunnel infrastructure. The benchmark auto-detects which tools are installed and includes them in the results.

_Tested with: cloudflared 2026.2.0, ngrok 3.36.1, bore-cli 0.6.0, frpc 0.67.0. localtunnels runs on localhost. bore routes through bore.pub. cloudflared routes through Cloudflare's network. ngrok routes through ngrok's network._

#### localtunnels vs Alternatives — Request Forwarding

Real end-to-end request forwarding through each tool's tunnel.

**GET `/` — plain text "OK" response:**

| Tool | avg | vs direct |
|---|---|---|
| Direct (no tunnel) | 35.67 µs | 1x (baseline) |
| **localtunnels** | **105.97 µs** | 2.97x |
| **bore** | 188.60 ms | 5,290x |

**GET `/json` — 10-item JSON array:**

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

Note: bore's numbers include the round trip to bore.pub over the public internet. localtunnels runs entirely on localhost in self-hosted mode. cloudflared and ngrok tunnel URLs were not reachable during this benchmark run (cloudflared's quick tunnel URL had a DNS propagation delay; ngrok required auth token configuration). Install and configure these tools to include them in your own benchmark runs.

#### localtunnels vs Alternatives — Startup Time

Time from process start to tunnel ready and accepting connections.

| Tool | Time to tunnel ready |
|---|---|
| **localtunnels** | **~324 µs** |
| **bore** | 195 ms |
| **Cloudflare Tunnels** | 3,969 ms |

localtunnels starts in microseconds because it's an in-process Bun server. bore and cloudflared are external processes that must initialize, connect to their relay servers, and register tunnels.

#### localtunnels vs Alternatives — Subdomain Generation

Each tool uses a different strategy to generate tunnel subdomains.

**Example outputs from each strategy:**

| Tool | Strategy | Example Outputs |
|---|---|---|
| **localtunnels** | Adjective-noun | `fast-deer`, `quick-surf`, `fond-opal`, `wee-mars`, `ripe-frost` |
| **ngrok** | Random hex (8 chars) | `c2a8b92e`, `5c219911`, `65a2aba4`, `924ede01`, `273c95b3` |
| **Cloudflare Tunnels** | UUID prefix (8 chars) | `a7ed76b1`, `ee76358d`, `d25abca3`, `2059f0c2`, `49dbb440` |
| **bore** | Short hex (6 chars) | `df28e3`, `1cb723`, `06189e`, `3aa4b5`, `59106c` |
| **frp** | Counter prefix | `tunnel-1`, `tunnel-2`, `tunnel-3`, `tunnel-4`, `tunnel-5` |
| **Expose** | UUID slug (12 chars) | `a432cef06efa`, `15b07c93bc27`, `c801ec1b0f46`, `78258797406f` |

**Timing results:**

| Tool | Strategy | avg | vs localtunnels |
|---|---|---|---|
| **localtunnels** | Adjective-noun | **3.00 ns** | 1x |
| localtunnels | Subdomain validation | 3.07 ns | 1.02x |
| **frp** | Counter prefix | 25.66 ns | 8.55x slower |
| **Cloudflare Tunnels** | UUID prefix | 42.69 ns | 14.23x slower |
| **Expose** | UUID slug | 96.60 ns | 32.20x slower |
| **bore** | Short hex | 191.94 ns | 63.98x slower |
| **ngrok** | Random hex | 279.09 ns | 93.03x slower |

#### localtunnels vs Alternatives — ID Generation

Each tool uses a different strategy to generate connection/request IDs.

| Tool | Strategy | avg | vs fastest |
|---|---|---|---|
| **frp** | Counter-based (`conn_1`, `conn_2`) | **22.19 ns** | 1x |
| **ngrok / Cloudflare Tunnels** | `crypto.randomUUID()` | 30.94 ns | 1.39x |
| **localtunnels** | `crypto.randomUUID().substring()` | 42.42 ns | 1.91x |
| **bore** | `crypto.getRandomValues` (8 bytes) | 358.60 ns | 16.16x |

#### localtunnels vs Alternatives — Protocol Overhead

localtunnels uses WebSocket + JSON. bore and frp use binary protocols with fixed-size headers. This measures per-message encode/decode cost for a typical tunnel request.

| Tool | Protocol | Operation | avg | vs fastest |
|---|---|---|---|---|
| **localtunnels** | WebSocket + JSON | Serialize request | **123.05 ns** | 1x |
| **bore / frp** | Raw TCP + binary | Header encode (16 bytes) | 159.04 ns | 1.29x |
| **bore / frp** | Raw TCP + binary | Header decode (16 bytes) | 176.33 ns | 1.43x |
| **localtunnels** | WebSocket + JSON | Parse request | 434.87 ns | 3.53x |

localtunnels' JSON serialization is now faster than binary protocol encoding thanks to a leaner message format (counter IDs, no redundant URL field). JSON parsing is slower, but the difference is sub-microsecond.

#### localtunnels vs Alternatives — Payload Serialization

localtunnels and ngrok use JSON for payload framing. bore uses raw binary. This measures serialization cost for a typical response payload (~1.4 KB).

| Tool | Method | avg | vs fastest |
|---|---|---|---|
| **bore** (binary approach) | `TextDecoder.decode` | **195.55 ns** | 1x |
| **bore** (binary approach) | `TextEncoder.encode` | 287.59 ns | 1.47x |
| **localtunnels / ngrok** (JSON approach) | `JSON.parse` | 2.49 µs | 12.75x |
| **localtunnels / ngrok** (JSON approach) | `JSON.stringify` | 2.56 µs | 13.09x |

#### localtunnels vs Alternatives — State Machine

Each tool manages connection state differently. localtunnels uses simple string assignment. Go-based tools (frp, bore) typically use integer enums. Some tools use object-based state machines with transition tracking.

| Tool | Strategy | avg | vs fastest |
|---|---|---|---|
| **frp / bore** (Go-style) | Enum-based (integers) | **2.20 ns** | 1x |
| **localtunnels** | String-based | 2.35 ns | 1.07x |
| **ngrok / Expose** | Object-based (with transition count) | 3.54 ns | 1.61x |

#### localtunnels — Allocation Pressure

Measures the cost of creating the core objects used in every tunnel request.

| Object | avg |
|---|---|
| Response-like message (object literal) | 7.40 ns |
| Request-like message (counter ID) | 8.05 ns |
| `TunnelClient` instance | 33.22 ns |
| `Headers` object (3 headers) | 302.72 ns |

## Methodology

- localtunnels benchmarks (utils, connection, throughput, latency, scalability) run entirely on localhost with no external network hops.
- Cross-tool comparison benchmarks start real tunnels through each tool's infrastructure. localtunnels runs on localhost, while bore routes through bore.pub, cloudflared through Cloudflare's network, and ngrok through ngrok's network. This means results for those tools include real internet round-trip times.
- Each benchmark is run multiple times by mitata with automatic warmup and statistical analysis.
- Results include min, max, avg, p75, and p99 timing.
- Boxplot groups show the full distribution of measured times.
- Summary groups rank benchmarks within a group by relative speed.
- The cross-tool comparison tests each tool only if its binary is found in `$PATH`. Missing tools are listed as "not installed" and excluded from results.

## Environment

```
clk: ~3.65 GHz
cpu: Apple M3 Pro
runtime: bun 1.3.10 (arm64-darwin)

cloudflared: 2026.2.0
ngrok: 3.36.1
bore-cli: 0.6.0
frpc: 0.67.0
```

Results will vary by hardware, OS, runtime version, and network conditions. When comparing results across machines, always note the environment. Cross-tool benchmarks involving external relay servers (bore, cloudflared, ngrok) will vary significantly based on network latency to those servers.

## Adding Benchmarks

To add a new benchmark, create a file in `benchmarks/` and register it in `benchmarks/index.ts`:

```typescript
// benchmarks/my-bench.ts
import { bench, group, run, summary } from 'mitata'

summary(() => {
  group('My Benchmark Group', () => {
    bench('operation A', () => {
      // code to benchmark
    })

    bench('operation B', () => {
      // code to benchmark
    })
  })
})

await run()
```

Then add it to the suites array in `benchmarks/index.ts`:

```typescript
const suites = [
  // ... existing suites
  { name: 'My Benchmarks', file: 'my-bench.ts' },
]
```

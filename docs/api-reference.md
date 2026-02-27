# API Reference

## TunnelClient

The client class that connects to a tunnel server and forwards requests to a local server.

### Constructor

```ts
new TunnelClient(options?: TunnelOptions)
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Tunnel server port |
| `host` | `string` | `'localhost'` | Tunnel server hostname |
| `secure` | `boolean` | `false` | Use secure WebSocket (wss://) |
| `verbose` | `boolean` | `false` | Enable verbose logging |
| `localPort` | `number` | `8000` | Local port to forward requests to |
| `localHost` | `string` | `'localhost'` | Local host to forward requests to |
| `subdomain` | `string` | auto | Subdomain (see [Subdomains](/features/subdomains)) |
| `timeout` | `number` | `10000` | Connection timeout in ms |
| `maxReconnectAttempts` | `number` | `10` | Max reconnection attempts |
| `apiKey` | `string` | `''` | API key for server authentication |
| `manageHosts` | `boolean` | `true` | Auto-resolve DNS when system resolver fails |
| `ssl` | `object` | - | SSL/TLS options (`key`, `cert`, `ca`) |

### Methods

#### `connect()`

```ts
public async connect(): Promise<void>
```

Connects to the tunnel server. If `manageHosts` is enabled and the server is unreachable via system DNS, automatically resolves the IP via DNS-over-HTTPS or `dig` and connects directly.

If the requested subdomain is taken, automatically retries with `-2`, `-3`, etc.

#### `disconnect()`

```ts
public disconnect(): void
```

Disconnects from the tunnel server and stops reconnection attempts.

#### `getState()`

```ts
public getState(): ClientState
// Returns: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
```

#### `getSubdomain()`

```ts
public getSubdomain(): string
```

Returns the actual subdomain assigned by the server (may differ from the requested one if collision handling occurred).

#### `getTunnelUrl()`

```ts
public getTunnelUrl(): string
```

Returns the full public tunnel URL (e.g. `https://myapp.localtunnel.dev`).

#### `isConnected()`

```ts
public isConnected(): boolean
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{ url, subdomain, tunnelServer }` | Tunnel is active and registered |
| `disconnected` | - | Tunnel disconnected |
| `reconnecting` | `{ attempt, delay, maxAttempts }` | Attempting reconnection |
| `request` | `{ method, url, path }` | HTTP request received |
| `response` | `{ status, size, duration }` | Response sent |
| `error` | `Error` | An error occurred |
| `close` | - | WebSocket closed |

---

## TunnelServer

The server class that accepts tunnel client connections and routes HTTP requests.

### Constructor

```ts
new TunnelServer(options?: TunnelOptions)
```

### Methods

#### `start()`

```ts
public async start(): Promise<void>
```

Starts the tunnel server (HTTP + WebSocket).

#### `stop()`

```ts
public stop(): void
```

Stops the server and closes all connections.

#### `getStats()`

```ts
public getStats(includeSubdomains?: boolean): ServerStats
```

Returns server statistics including active connections, request count, and uptime.

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `start` | `{ host, port }` | Server started |
| `stop` | - | Server stopped |
| `connection` | `{ subdomain, totalConnections }` | Client connected |
| `disconnection` | `{ subdomain }` | Client disconnected |
| `error` | `Error` | An error occurred |

### Built-in Endpoints

| Path | Description |
|------|-------------|
| `/health` | Health check (returns `OK`) |
| `/status` | JSON server stats |
| `/metrics` | Prometheus-format metrics |

---

## `startLocalTunnel()`

Convenience function for quick tunnel setup:

```ts
const client = await startLocalTunnel({
  port: 3000,
  server: 'localtunnel.dev', // optional
  subdomain: 'myapp', // optional
  verbose: true, // optional
  manageHosts: true, // optional, default true
  onConnect: (info) => console.log(info.url),
  onRequest: (req) => console.log(req.method, req.url),
  onResponse: (res) => console.log(res.status),
  onError: (err) => console.error(err),
  onReconnecting: (info) => console.log(`Attempt ${info.attempt}`),
})
```

Returns a `TunnelClient` instance.

---

## `resolveHostname()`

Exported utility to resolve a hostname via multiple DNS strategies:

```ts
import { resolveHostname } from 'localtunnels'

const ip = await resolveHostname('localtunnel.dev', true)
// Tries: system DNS -> Cloudflare DoH -> dig @8.8.8.8
```

---

## WebSocket Protocol

### Message Types

#### Client -> Server

| Type | Fields | Description |
|------|--------|-------------|
| `ready` | `subdomain` | Register with a subdomain |
| `response` | `id`, `status`, `headers`, `body`, `isBase64Encoded` | Response to a forwarded request |
| `ping` | - | Keep-alive ping |

#### Server -> Client

| Type | Fields | Description |
|------|--------|-------------|
| `connected` | - | WebSocket connection established |
| `registered` | `subdomain`, `url` | Subdomain confirmed |
| `subdomain_taken` | `subdomain` | Requested subdomain is in use |
| `request` | `id`, `method`, `url`, `path`, `headers`, `body`, `isBase64Encoded` | HTTP request to forward |
| `pong` | - | Keep-alive response |
| `error` | `message` | Error message |

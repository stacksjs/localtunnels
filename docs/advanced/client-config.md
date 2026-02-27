# Client Configuration

Advanced configuration options for the localtunnels client.

## Basic Configuration

```ts
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  localHost: 'localhost',
})

await client.connect()
```

## All Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `'localhost'` | Tunnel server hostname |
| `port` | `number` | `3000` | Tunnel server port |
| `secure` | `boolean` | `false` | Use WSS/HTTPS |
| `localPort` | `number` | `8000` | Local server port to forward to |
| `localHost` | `string` | `'localhost'` | Local server host to forward to |
| `subdomain` | `string` | auto | Requested subdomain |
| `timeout` | `number` | `10000` | Connection timeout (ms) |
| `maxReconnectAttempts` | `number` | `10` | Max reconnect attempts |
| `verbose` | `boolean` | `false` | Enable debug logging |
| `apiKey` | `string` | `''` | Server API key |
| `manageHosts` | `boolean` | `true` | Auto DNS resolution |
| `ssl` | `object` | - | TLS options |

## Subdomain Configuration

### Explicit Subdomain

```ts
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  subdomain: 'myapp',
})

await client.connect()
// https://myapp.localtunnel.dev
// (or https://myapp-2.localtunnel.dev if taken)
```

### APP_NAME Auto-Detection

If no subdomain is specified, localtunnels checks the `APP_NAME` environment variable:

```bash
APP_NAME="My App" node my-script.js
```

```ts
// No subdomain specified — uses APP_NAME
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
})

await client.connect()
// https://my-app.localtunnel.dev
```

### Random Names

With no `subdomain` option and no `APP_NAME` env var, a memorable random name is generated:

```ts
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
})

await client.connect()
console.log(client.getSubdomain()) // e.g. 'swift-fox', 'bold-comet'
```

## DNS Resolution

On some machines (especially macOS), the system DNS resolver can't reach `.dev` domains. localtunnels detects this automatically and connects directly to the server IP.

The resolution strategy:

1. Try reaching the server normally (actual HTTP request)
2. If unreachable, resolve IP via DNS-over-HTTPS (Cloudflare)
3. Fallback to `dig @8.8.8.8`
4. Connect WebSocket directly to the IP

Disable with:

```ts
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  manageHosts: false, // disable DNS fallback
})
```

## Event Handling

```ts
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
})

// Tunnel is active and registered with the server
client.on('connected', (info) => {
  console.log(`URL: ${info.url}`)
  console.log(`Subdomain: ${info.subdomain}`)
})

// Tunnel disconnected
client.on('disconnected', () => {
  console.log('Disconnected')
})

// Attempting to reconnect
client.on('reconnecting', (info) => {
  console.log(`Reconnecting (${info.attempt}/${info.maxAttempts})`)
})

// HTTP request forwarded through tunnel
client.on('request', (req) => {
  console.log(`${req.method} ${req.url}`)
})

// Response sent back through tunnel
client.on('response', (res) => {
  console.log(`${res.status} (${res.size} bytes, ${res.duration}ms)`)
})

// Error occurred
client.on('error', (err) => {
  console.error(err.message)
})

await client.connect()
```

## Reconnection

The client automatically reconnects with exponential backoff when the connection drops:

```ts
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  maxReconnectAttempts: 10, // default
})
```

To disable reconnection, call `disconnect()` which sets `shouldReconnect = false`.

## Using `startLocalTunnel()`

For simpler use cases, the convenience function handles setup:

```ts
import { startLocalTunnel } from 'localtunnels'

const client = await startLocalTunnel({
  port: 3000,
  server: 'localtunnel.dev',
  subdomain: 'myapp',
  verbose: true,
  manageHosts: true,
  onConnect: (info) => console.log(`Active: ${info.url}`),
  onRequest: (req) => console.log(`-> ${req.method} ${req.url}`),
  onResponse: (res) => console.log(`<- ${res.status}`),
  onError: (err) => console.error(err.message),
  onReconnecting: (info) => console.log(`Reconnecting (${info.attempt})`),
})

// later...
client.disconnect()
```

# Usage

There are two ways of using localtunnels: _as a library or as a CLI._

## CLI

The quickest way to expose a local server:

```bash
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

### All CLI Commands

```bash
localtunnels start       # Start a tunnel client (default command)
localtunnels server      # Start a self-hosted tunnel server
localtunnels deploy      # Deploy tunnel server to AWS EC2
localtunnels destroy     # Remove AWS infrastructure
localtunnels status      # Check tunnel server status
localtunnels info        # Show help information
localtunnels version     # Show version
```

## Library

### Quick Start

```ts
import { startLocalTunnel } from 'localtunnels'

const client = await startLocalTunnel({
  port: 3000,
  onConnect: (info) => {
    console.log(`Tunnel active: ${info.url}`)
  },
})

// later...
client.disconnect()
```

### TunnelClient Class

For more control, use the `TunnelClient` class directly:

```ts
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  subdomain: 'myapp', // optional
  verbose: true, // optional
})

client.on('connected', (info) => {
  console.log(`Public URL: ${info.url}`)
  console.log(`Subdomain: ${info.subdomain}`)
})

client.on('request', (req) => {
  console.log(`${req.method} ${req.url}`)
})

client.on('error', (err) => {
  console.error('Tunnel error:', err.message)
})

await client.connect()
```

### Self-Hosted Server

```ts
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  host: '0.0.0.0',
  verbose: true,
})

server.on('connection', (info) => {
  console.log(`Client connected: ${info.subdomain}`)
})

await server.start()
```

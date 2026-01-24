# Local Tunneling

Local tunneling is the core feature of localtunnels. It allows you to expose your local development server to the public internet through a secure WebSocket-based connection.

## How It Works

localtunnels creates a bidirectional tunnel between your local machine and a publicly accessible server. When someone accesses your tunnel URL, the request is forwarded through the WebSocket connection to your local server, and the response is sent back the same way.

```
Internet Request → Tunnel Server → WebSocket → Local Server
                                      ↓
Internet Response ← Tunnel Server ← WebSocket ← Local Response
```

## Basic Usage

### Using the CLI

The simplest way to create a tunnel is using the CLI:

```bash
# Expose port 3000 to the internet
localtunnel --port 3000

# Or use the start command
localtunnel start --from localhost:3000
```

### Using the Library

You can also create tunnels programmatically:

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  localPort: 3000,
  localHost: 'localhost',
  verbose: true,
})

await client.connect()
console.log('Tunnel is now active!')

// To disconnect
client.disconnect()
```

## Configuration Options

When creating a tunnel, you can specify various options:

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  // The local port to forward traffic to
  localPort: 3000,

  // The local host (default: 'localhost')
  localHost: 'localhost',

  // The tunnel server port
  port: 443,

  // The tunnel server host
  host: 'tunnels.example.com',

  // Use secure WebSocket (wss://)
  secure: true,

  // Custom subdomain
  subdomain: 'my-app',

  // Enable verbose logging
  verbose: true,
})
```

## Server Component

localtunnels also includes a server component that you can self-host:

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  host: '0.0.0.0',
  verbose: true,
})

await server.start()
console.log('Tunnel server is running!')

// To stop the server
server.stop()
```

## Events and Logging

When verbose mode is enabled, localtunnels provides detailed logging:

```typescript
const client = new TunnelClient({
  localPort: 3000,
  verbose: true, // Enable detailed logging
})

await client.connect()
// Logs: Connecting to WebSocket server at ws://...
// Logs: Connected to tunnel server
// Logs: Forwarding request to: http://localhost:3000/...
```

## Use Cases

Local tunneling is useful for:

- **Webhook Development**: Test webhooks from services like Stripe, GitHub, or Slack
- **Mobile App Testing**: Connect mobile devices to your local backend
- **Client Demos**: Share work-in-progress with clients without deploying
- **API Testing**: Allow external services to reach your local API
- **Collaborative Development**: Let teammates access your local environment

## Next Steps

- Learn about [Custom Subdomains](/features/custom-subdomains) for consistent URLs
- Set up [HTTPS Support](/features/https-support) for secure connections
- Consider [Self-Hosting](/features/self-hosting) for complete control

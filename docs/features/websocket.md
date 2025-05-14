# WebSocket Support

localtunnels provides full WebSocket support for real-time communication between your local server and clients. This enables features like live updates, chat applications, and real-time data streaming.

## How It Works

The tunnel server acts as a WebSocket proxy, forwarding WebSocket connections from the internet to your local server. Here's how it works:

1. Client connects to the tunnel server via WebSocket
2. Tunnel server establishes a WebSocket connection to your local server
3. All WebSocket messages are forwarded bidirectionally

## Usage

### Server Side

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  secure: true, // Enable secure WebSocket (wss://)
  verbose: true // Enable detailed logging
})

await server.start()
```

### Client Side

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  secure: true,
  localPort: 8000
})

await client.connect()
```

## WebSocket Protocol

The tunnel uses a custom WebSocket protocol for communication. See the [API Reference](/api-reference) for detailed protocol documentation.

## Best Practices

1. **Error Handling**: Always implement proper error handling for WebSocket connections
2. **Reconnection**: Implement automatic reconnection logic for dropped connections
3. **Heartbeats**: Use periodic heartbeats to keep connections alive
4. **Security**: Always use secure WebSocket (wss://) in production

## Example: Real-time Chat Application

Here's a simple example of how to use WebSocket support in a chat application:

```typescript
// Server
const server = new TunnelServer({
  port: 3000,
  secure: true
})

await server.start()

// Local WebSocket server
const ws = new WebSocket.Server({ port: 8000 })

ws.on('connection', (socket) => {
  socket.on('message', (message) => {
    // Broadcast message to all connected clients
    ws.clients.forEach((client) => {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    })
  })
})
```

## Limitations

1. WebSocket connections are subject to the same timeout and connection limits as HTTP connections
2. Large message payloads may impact performance
3. Some proxy servers may not properly support WebSocket connections

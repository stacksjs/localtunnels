# Self-Hosting

localtunnels can be self-hosted on your own infrastructure, giving you complete control over your tunneling setup. This is ideal for teams that need custom domains, enhanced security, or want to avoid dependency on third-party services.

## Why Self-Host?

- **Custom Domains**: Use your own domain for tunnel URLs
- **Data Privacy**: Keep all traffic within your infrastructure
- **No Rate Limits**: Control your own usage limits
- **Enterprise Security**: Meet compliance requirements
- **Cost Control**: Predictable infrastructure costs

## Architecture Overview

A self-hosted localtunnels setup consists of:

1. **Tunnel Server**: Handles incoming requests and WebSocket connections
2. **DNS Configuration**: Routes subdomains to your server
3. **SSL Certificates**: Provides HTTPS for secure connections

```
Users → Your Domain (*.tunnels.yourcompany.com)
         ↓
     Tunnel Server
         ↓
     WebSocket Connection
         ↓
     Developer's Local Machine
```

## Quick Start

### Starting the Server

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  host: '0.0.0.0',
  verbose: true,
})

await server.start()
console.log('Tunnel server running on port 3000')
```

### Connecting Clients

Once your server is running, clients can connect:

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  host: 'tunnels.yourcompany.com',
  port: 443,
  secure: true,
  localPort: 3000,
  subdomain: 'my-app',
})

await client.connect()
```

## Infrastructure Setup

### AWS Deployment

localtunnels includes Infrastructure as Code (IaC) support for AWS:

```typescript
// Using the cloud module
import { deployTunnelStack } from 'localtunnels/cloud'

await deployTunnelStack({
  region: 'us-east-1',
  domain: 'tunnels.yourcompany.com',
})
```

### Docker Deployment

Create a Docker container for your tunnel server:

```dockerfile
FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
```

```typescript
// server.ts
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: Number(process.env.PORT) || 3000,
  host: '0.0.0.0',
  verbose: process.env.VERBOSE === 'true',
})

await server.start()
```

### Docker Compose

```yaml
version: '3.8'
services:
  tunnel-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - VERBOSE=true
    restart: unless-stopped
```

## DNS Configuration

Configure wildcard DNS to route all subdomains to your server:

### Using Cloudflare

1. Add an A record: `tunnels.yourcompany.com` → `your-server-ip`
2. Add a wildcard A record: `*.tunnels.yourcompany.com` → `your-server-ip`

### Using AWS Route 53

```json
{
  "Changes": [
    {
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "*.tunnels.yourcompany.com",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "your-server-ip"}]
      }
    }
  ]
}
```

## SSL/TLS Configuration

### Using Nginx as Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name *.tunnels.yourcompany.com;

    ssl_certificate /etc/letsencrypt/live/tunnels.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tunnels.yourcompany.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Wildcard Certificate with Let's Encrypt

```bash
# Using certbot with DNS challenge
sudo certbot certonly \
  --manual \
  --preferred-challenges dns \
  -d "tunnels.yourcompany.com" \
  -d "*.tunnels.yourcompany.com"
```

## Server Configuration

### Full Configuration Example

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  // Network settings
  port: 3000,
  host: '0.0.0.0',

  // Enable HTTPS
  secure: true,

  // Logging
  verbose: true,

  // Local forwarding defaults
  localPort: 8000,
  localHost: 'localhost',
})

// Start the server
await server.start()

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down tunnel server...')
  server.stop()
  process.exit(0)
})
```

## Monitoring and Logging

### Enable Verbose Logging

```typescript
const server = new TunnelServer({
  port: 3000,
  verbose: true, // Enables detailed logging
})
```

Verbose mode logs:
- Incoming WebSocket connections
- Request forwarding events
- Connection closures
- Error details

### Health Checks

Implement a health check endpoint:

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({ port: 3000 })
await server.start()

// Simple health check server
Bun.serve({
  port: 3001,
  fetch(req) {
    if (new URL(req.url).pathname === '/health') {
      return new Response('OK', { status: 200 })
    }
    return new Response('Not Found', { status: 404 })
  },
})
```

## Security Considerations

### Network Security

- Use firewall rules to restrict access
- Consider VPN or private networking for internal use
- Implement rate limiting to prevent abuse

### Authentication (Coming Soon)

Future versions will support authentication:

```typescript
// Planned feature
const server = new TunnelServer({
  port: 3000,
  auth: {
    type: 'token',
    tokens: ['secret-token-1', 'secret-token-2'],
  },
})
```

## Next Steps

- Review [Server Setup](/advanced/server-setup) for production configurations
- Learn about [Performance](/advanced/performance) optimization
- Set up [CI/CD Integration](/advanced/ci-cd-integration) for automated deployments

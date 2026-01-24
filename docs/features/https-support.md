# HTTPS Support

localtunnels provides built-in HTTPS support, ensuring secure connections between clients and your tunnel. This is essential for testing secure APIs, OAuth integrations, and any application requiring encrypted communication.

## Why HTTPS Matters

- **Security**: Encrypt data in transit to prevent eavesdropping
- **OAuth Requirements**: Many OAuth providers require HTTPS redirect URLs
- **Browser Features**: Some browser APIs only work over HTTPS (geolocation, camera, etc.)
- **Production Parity**: Test with the same security as production

## Automatic HTTPS

When connecting to the default localtunnels service, HTTPS is automatically provided:

```bash
localtunnel start --from localhost:3000 --subdomain my-app
# Your app is available at https://my-app.tunnels.dev
```

The tunnel server handles SSL/TLS termination, so your local server can remain HTTP:

```
Client (HTTPS) → Tunnel Server (SSL Termination) → Your Local Server (HTTP)
```

## Configuring Secure Connections

### CLI Configuration

Enable secure WebSocket connections with the `--secure` flag:

```bash
localtunnel start --from localhost:3000 --secure
```

### Library Configuration

Configure HTTPS in your TunnelClient:

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  localPort: 3000,
  secure: true, // Use wss:// instead of ws://
  host: 'tunnels.example.com',
  port: 443,
})

await client.connect()
```

### Configuration File

Set up secure connections in your config file:

```typescript
// tunnel.config.ts
import type { LocalTunnelConfig } from 'localtunnels'

const config: LocalTunnelConfig = {
  from: 'localhost:3000',
  subdomain: 'my-app',
  secure: true,
}

export default config
```

## Self-Hosted HTTPS Setup

When running your own tunnel server, you need to configure SSL certificates.

### Providing SSL Certificates

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  localPort: 3000,
  secure: true,
  ssl: {
    key: '/path/to/private-key.pem',
    cert: '/path/to/certificate.pem',
    ca: '/path/to/ca-certificate.pem', // Optional
  },
})

await client.connect()
```

### Using Let's Encrypt

For self-hosted setups, Let's Encrypt provides free SSL certificates:

```bash
# Install certbot
sudo apt install certbot

# Obtain certificate
sudo certbot certonly --standalone -d tunnels.yourdomain.com

# Certificates are stored at:
# /etc/letsencrypt/live/tunnels.yourdomain.com/privkey.pem
# /etc/letsencrypt/live/tunnels.yourdomain.com/fullchain.pem
```

Then configure your tunnel:

```typescript
// tunnel.config.ts
import type { LocalTunnelConfig } from 'localtunnels'

const config: LocalTunnelConfig = {
  from: 'localhost:3000',
  secure: true,
  ssl: {
    key: '/etc/letsencrypt/live/tunnels.yourdomain.com/privkey.pem',
    cert: '/etc/letsencrypt/live/tunnels.yourdomain.com/fullchain.pem',
  },
}

export default config
```

## Local HTTPS Development

If your local server itself runs on HTTPS:

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  localPort: 3443, // Your local HTTPS port
  localHost: 'localhost',
  secure: true,
})

await client.connect()
```

## Certificate Configuration Options

The SSL configuration supports several options:

```typescript
interface SSLConfig {
  // Path to the private key file
  key: string

  // Path to the certificate file
  cert: string

  // Optional: Path to CA certificate for certificate chain
  ca?: string
}
```

### Example with Full Certificate Chain

```typescript
// tunnel.config.ts
import type { LocalTunnelConfig } from 'localtunnels'

const config: LocalTunnelConfig = {
  from: 'localhost:3000',
  secure: true,
  ssl: {
    key: './certs/server.key',
    cert: './certs/server.crt',
    ca: './certs/ca.crt',
  },
}

export default config
```

## Testing HTTPS Locally

For development, you can generate self-signed certificates:

```bash
# Generate a self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

Then use them in your configuration:

```typescript
const client = new TunnelClient({
  localPort: 3000,
  secure: true,
  ssl: {
    key: './key.pem',
    cert: './cert.pem',
  },
})
```

## Troubleshooting

### Certificate Errors

If you encounter certificate errors:

1. **Check certificate paths**: Ensure paths are correct and files are readable
2. **Verify certificate validity**: Certificates may have expired
3. **Check certificate chain**: Ensure intermediate certificates are included

### Mixed Content Warnings

If your local app makes HTTP requests while accessed via HTTPS:

- Update API URLs to use HTTPS
- Use relative URLs where possible
- Configure your app's base URL to match the tunnel URL

## Next Steps

- Learn about [Self-Hosting](/features/self-hosting) your own tunnel server
- Review [Server Setup](/advanced/server-setup) for production deployments
- Explore [Configuration](/advanced/configuration) for advanced SSL options

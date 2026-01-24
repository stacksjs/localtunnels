# Advanced Configuration

This guide covers advanced configuration options for localtunnels, including environment-based settings, programmatic configuration, and integration with different frameworks.

## Configuration Methods

localtunnels supports multiple configuration methods with the following precedence (highest to lowest):

1. CLI arguments
2. Environment variables
3. Configuration file
4. Default values

## Configuration File

Create a configuration file named `tunnel.config.ts` (or `.js`) in your project root:

```typescript
// tunnel.config.ts
import type { TunnelOptions } from 'localtunnels'

const config: TunnelOptions = {
  // Network configuration
  port: 3000,
  host: 'tunnels.example.com',
  secure: true,

  // Local server settings
  localPort: 5173,
  localHost: 'localhost',

  // Subdomain configuration
  subdomain: 'my-app',

  // SSL certificates (for self-hosted)
  ssl: {
    key: './certs/server.key',
    cert: './certs/server.crt',
    ca: './certs/ca.crt',
  },

  // Logging
  verbose: true,
}

export default config
```

## Environment Variables

Configure localtunnels using environment variables:

```bash
# .env
TUNNEL_PORT=3000
TUNNEL_HOST=tunnels.example.com
TUNNEL_SECURE=true
TUNNEL_LOCAL_PORT=5173
TUNNEL_LOCAL_HOST=localhost
TUNNEL_SUBDOMAIN=my-app
TUNNEL_VERBOSE=true
```

### Using with dotenv

```typescript
import { config as dotenv } from 'dotenv'
import { TunnelClient } from 'localtunnels'

dotenv()

const client = new TunnelClient({
  port: Number(process.env.TUNNEL_PORT) || 3000,
  host: process.env.TUNNEL_HOST || 'localhost',
  secure: process.env.TUNNEL_SECURE === 'true',
  localPort: Number(process.env.TUNNEL_LOCAL_PORT) || 5173,
  localHost: process.env.TUNNEL_LOCAL_HOST || 'localhost',
  subdomain: process.env.TUNNEL_SUBDOMAIN,
  verbose: process.env.TUNNEL_VERBOSE === 'true',
})
```

## Complete Configuration Reference

### TunnelOptions Interface

```typescript
interface TunnelOptions {
  /**
   * The tunnel server port
   * @default 3000
   */
  port?: number

  /**
   * The tunnel server hostname
   * @default 'localhost'
   */
  host?: string

  /**
   * Enable secure WebSocket connection (wss://)
   * @default false
   */
  secure?: boolean

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean

  /**
   * The local port to forward traffic to
   * @default 8000
   */
  localPort?: number

  /**
   * The local hostname
   * @default 'localhost'
   */
  localHost?: string

  /**
   * Custom subdomain for the tunnel URL
   * If not provided, a random subdomain is generated
   */
  subdomain?: string

  /**
   * SSL certificate configuration
   */
  ssl?: {
    /** Path to the private key file */
    key: string
    /** Path to the certificate file */
    cert: string
    /** Path to the CA certificate (optional) */
    ca?: string
  }
}
```

## Environment-Specific Configuration

### Development vs Production

```typescript
// tunnel.config.ts
import type { TunnelOptions } from 'localtunnels'

const isDev = process.env.NODE_ENV !== 'production'

const config: TunnelOptions = {
  // Use different settings for dev/prod
  port: isDev ? 3000 : 443,
  secure: !isDev, // HTTPS in production
  verbose: isDev, // Verbose logging in development

  // Dynamic subdomain based on environment
  subdomain: isDev ? `dev-${process.env.USER}` : 'production',

  // Local server port
  localPort: isDev ? 5173 : 3000,
}

export default config
```

### Team-Based Configuration

```typescript
// tunnel.config.ts
import type { TunnelOptions } from 'localtunnels'
import { execSync } from 'child_process'

// Get git username for unique subdomain
const gitUser = execSync('git config user.name')
  .toString()
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '-')

const config: TunnelOptions = {
  port: 443,
  host: 'tunnels.company.com',
  secure: true,
  subdomain: `${gitUser}-dev`,
  localPort: 3000,
}

export default config
```

## Framework Integration

### Vite Integration

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { TunnelClient } from 'localtunnels'

let tunnelClient: TunnelClient | null = null

export default defineConfig({
  server: {
    port: 5173,
  },
  plugins: [
    {
      name: 'localtunnel',
      async configureServer(server) {
        server.httpServer?.once('listening', async () => {
          tunnelClient = new TunnelClient({
            localPort: 5173,
            subdomain: 'my-vite-app',
            verbose: true,
          })
          await tunnelClient.connect()
          console.log('Tunnel connected!')
        })
      },
      async closeBundle() {
        tunnelClient?.disconnect()
      },
    },
  ],
})
```

### Express Integration

```typescript
import express from 'express'
import { TunnelClient } from 'localtunnels'

const app = express()
const PORT = 3000

app.get('/', (req, res) => {
  res.send('Hello from Express!')
})

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`)

  const tunnel = new TunnelClient({
    localPort: PORT,
    subdomain: 'my-express-app',
  })

  await tunnel.connect()
  console.log('Tunnel established!')
})
```

### Next.js Integration

```typescript
// scripts/tunnel.ts
import { TunnelClient } from 'localtunnels'

const tunnel = new TunnelClient({
  localPort: 3000,
  subdomain: 'my-next-app',
  verbose: true,
})

await tunnel.connect()
console.log('Tunnel ready for Next.js!')

// Keep the script running
process.on('SIGINT', () => {
  tunnel.disconnect()
  process.exit(0)
})
```

Run alongside your Next.js dev server:

```json
{
  "scripts": {
    "dev": "next dev",
    "tunnel": "bun run scripts/tunnel.ts",
    "dev:tunnel": "concurrently \"npm run dev\" \"npm run tunnel\""
  }
}
```

## Programmatic Configuration

### Dynamic Configuration

```typescript
import { TunnelClient } from 'localtunnels'

async function createTunnel(options: Partial<TunnelOptions> = {}) {
  const defaultConfig = {
    localPort: 3000,
    verbose: process.env.DEBUG === 'true',
  }

  const client = new TunnelClient({
    ...defaultConfig,
    ...options,
  })

  await client.connect()
  return client
}

// Usage
const tunnel = await createTunnel({
  subdomain: 'custom-subdomain',
})
```

### Configuration Validation

```typescript
import { TunnelClient } from 'localtunnels'

function validateConfig(config: TunnelOptions): void {
  if (config.localPort && (config.localPort < 1 || config.localPort > 65535)) {
    throw new Error('Invalid port number')
  }

  if (config.subdomain && !/^[a-z0-9-]+$/.test(config.subdomain)) {
    throw new Error('Invalid subdomain format')
  }

  if (config.ssl) {
    if (!config.ssl.key || !config.ssl.cert) {
      throw new Error('SSL requires both key and cert')
    }
  }
}

const config: TunnelOptions = {
  localPort: 3000,
  subdomain: 'my-app',
}

validateConfig(config)
const client = new TunnelClient(config)
```

## Configuration Patterns

### Singleton Pattern

```typescript
import { TunnelClient, TunnelOptions } from 'localtunnels'

class TunnelManager {
  private static instance: TunnelClient | null = null

  static async getInstance(options?: TunnelOptions): Promise<TunnelClient> {
    if (!this.instance) {
      this.instance = new TunnelClient(options)
      await this.instance.connect()
    }
    return this.instance
  }

  static disconnect(): void {
    this.instance?.disconnect()
    this.instance = null
  }
}

// Usage
const tunnel = await TunnelManager.getInstance({
  localPort: 3000,
})
```

### Factory Pattern

```typescript
import { TunnelClient, TunnelServer, TunnelOptions } from 'localtunnels'

type TunnelType = 'client' | 'server'

function createTunnel(type: TunnelType, options: TunnelOptions) {
  switch (type) {
    case 'client':
      return new TunnelClient(options)
    case 'server':
      return new TunnelServer(options)
    default:
      throw new Error(`Unknown tunnel type: ${type}`)
  }
}

// Usage
const client = createTunnel('client', { localPort: 3000 })
const server = createTunnel('server', { port: 3000 })
```

## Next Steps

- Learn about [Server Setup](/advanced/server-setup) for self-hosted deployments
- Optimize [Performance](/advanced/performance) for production use
- Set up [CI/CD Integration](/advanced/ci-cd-integration)

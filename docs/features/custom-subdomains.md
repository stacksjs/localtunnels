# Custom Subdomains

Custom subdomains allow you to choose a memorable, consistent URL for your tunnel instead of using a randomly generated one. This makes it easier to share URLs and configure webhooks that persist across tunnel restarts.

## Why Use Custom Subdomains?

- **Consistent URLs**: Keep the same URL across tunnel sessions
- **Easy to Remember**: Use meaningful names like `my-app.tunnels.dev`
- **Webhook Friendly**: No need to update webhook URLs when restarting
- **Professional**: Share clean URLs with clients and teammates

## Using Custom Subdomains

### CLI Usage

Specify your preferred subdomain with the `--subdomain` flag:

```bash
localtunnel start --from localhost:3000 --subdomain my-app
```

This will create a tunnel at `my-app.tunnels.dev` (or your configured domain).

### Library Usage

Set the subdomain in your TunnelClient configuration:

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  localPort: 3000,
  subdomain: 'my-app',
})

await client.connect()
// Your tunnel is now available at my-app.tunnels.dev
```

### Configuration File

Define your subdomain in a configuration file for persistent settings:

```typescript
// tunnel.config.ts
import type { LocalTunnelConfig } from 'localtunnels'

const config: LocalTunnelConfig = {
  from: 'localhost:3000',
  subdomain: 'my-app',
  verbose: true,
}

export default config
```

Then run:

```bash
localtunnel start
```

## Subdomain Naming Rules

When choosing a subdomain, follow these guidelines:

- **Alphanumeric characters**: Use letters and numbers
- **Hyphens allowed**: Separate words with hyphens (e.g., `my-cool-app`)
- **Lowercase**: Subdomains are case-insensitive but conventionally lowercase
- **Length limits**: Keep subdomains reasonably short (typically under 63 characters)

### Valid Examples

```bash
localtunnel start --subdomain my-app
localtunnel start --subdomain staging-v2
localtunnel start --subdomain client-demo-2024
```

### Invalid Examples

```bash
# Avoid these patterns
localtunnel start --subdomain my_app        # underscores not recommended
localtunnel start --subdomain my.app        # dots not allowed
localtunnel start --subdomain -my-app       # can't start with hyphen
```

## Subdomain Availability

If your chosen subdomain is already in use by another tunnel, you'll receive an error:

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  localPort: 3000,
  subdomain: 'popular-name',
})

try {
  await client.connect()
} catch (error) {
  console.error('Subdomain might be in use, try another one')
}
```

### Handling Conflicts

Consider these strategies for handling subdomain conflicts:

```typescript
import { TunnelClient } from 'localtunnels'

async function connectWithFallback(preferredSubdomain: string) {
  const subdomains = [
    preferredSubdomain,
    `${preferredSubdomain}-dev`,
    `${preferredSubdomain}-${Date.now()}`,
  ]

  for (const subdomain of subdomains) {
    try {
      const client = new TunnelClient({
        localPort: 3000,
        subdomain,
      })
      await client.connect()
      console.log(`Connected with subdomain: ${subdomain}`)
      return client
    } catch (error) {
      console.log(`Subdomain ${subdomain} unavailable, trying next...`)
    }
  }

  throw new Error('All subdomains unavailable')
}
```

## Environment-Based Subdomains

Use environment variables for different environments:

```typescript
// tunnel.config.ts
import type { LocalTunnelConfig } from 'localtunnels'

const env = process.env.NODE_ENV || 'development'
const developer = process.env.USER || 'dev'

const config: LocalTunnelConfig = {
  from: 'localhost:3000',
  subdomain: `${developer}-${env}`,
  verbose: env === 'development',
}

export default config
```

This creates subdomains like `john-development` or `jane-staging`.

## Self-Hosted Subdomain Management

When running your own tunnel server, you have full control over subdomain management:

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  host: '0.0.0.0',
  verbose: true,
})

// The server automatically manages subdomain routing
await server.start()
```

## Next Steps

- Configure [HTTPS Support](/features/https-support) for secure connections
- Learn about [Self-Hosting](/features/self-hosting) for custom domains
- Review [Advanced Configuration](/advanced/configuration) options

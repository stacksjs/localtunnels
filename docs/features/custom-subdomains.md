# Custom Subdomains

Custom subdomains let you choose a consistent, memorable URL for your tunnel instead of using a randomly generated one.

## Why Custom Subdomains?

- **Consistent URLs**: Keep the same URL across tunnel sessions
- **Easy to remember**: Use meaningful names like `myapp.localtunnel.dev`
- **Webhook friendly**: No need to update webhook URLs when restarting
- **Professional**: Share clean URLs with clients and teammates

## Using Custom Subdomains

### CLI

```bash
localtunnels start --port 3000 --subdomain myapp
# -> https://myapp.localtunnel.dev
```

### Library

```ts
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  subdomain: 'myapp',
})

await client.connect()
// -> https://myapp.localtunnel.dev
```

### APP_NAME Environment Variable

Set `APP_NAME` and localtunnels will automatically use it as the subdomain (slugified):

```bash
APP_NAME="My Cool App" localtunnels start --port 3000
# -> https://my-cool-app.localtunnel.dev
```

This is useful in frameworks that already set `APP_NAME` — no extra configuration needed.

| `APP_NAME` | Subdomain |
|-----------|-----------|
| `My Cool App` | `my-cool-app` |
| `TrailBuddy` | `trailbuddy` |
| `stacks.js` | `stacks-js` |

## Automatic Collision Handling

If your chosen subdomain is already in use, localtunnels handles it automatically by appending `-2`, `-3`, etc.:

```
myapp     -> taken by another client
myapp-2   -> available, assigned to you
```

This means you never need to worry about crashes or manual fallback logic. The client negotiates with the server over the existing WebSocket connection — no reconnection needed.

```ts
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  subdomain: 'myapp',
})

await client.connect()

// If 'myapp' was taken:
console.log(client.getSubdomain()) // 'myapp-2'
console.log(client.getTunnelUrl()) // 'https://myapp-2.localtunnel.dev'
```

## Environment-Based Subdomains

Use environment variables for different environments:

```bash
# Development
APP_NAME="myapp-dev" localtunnels start --port 3000

# Staging
APP_NAME="myapp-staging" localtunnels start --port 3000

# Or use --subdomain directly
localtunnels start --port 3000 --subdomain myapp-$(whoami)
```

## Subdomain Rules

Valid subdomains must be lowercase alphanumeric with optional hyphens:

```bash
# Valid
localtunnels start --subdomain myapp
localtunnels start --subdomain my-cool-app
localtunnels start --subdomain staging-v2

# Invalid
localtunnels start --subdomain my_app       # underscores
localtunnels start --subdomain -my-app      # leading hyphen
localtunnels start --subdomain MY-APP       # uppercase
```

# Subdomains

localtunnels uses a smart subdomain system that's designed to be zero-config while still giving you full control when needed.

## Subdomain Resolution Chain

When no explicit subdomain is provided, localtunnels picks one automatically:

1. **`APP_NAME` environment variable** — slugified into a valid subdomain
2. **Random memorable name** — an adjective-noun combo like `swift-fox` or `bold-comet`

You can always override with an explicit subdomain via `--subdomain` or the `subdomain` option.

### APP_NAME Examples

| `APP_NAME` value | Resulting subdomain |
|------------------|-------------------|
| `My Cool App` | `my-cool-app` |
| `TrailBuddy` | `trailbuddy` |
| `stacks.js` | `stacks-js` |
| _(not set)_ | `swift-fox` _(random)_ |

### Random Names

When no `APP_NAME` is set and no `--subdomain` is specified, localtunnels generates a memorable adjective-noun combination from a dictionary of ~40,000 unique combos:

```
bold-comet    lazy-elk      nifty-lark    extra-storm
rocky-plum    wise-frog     brisk-stag    mint-reef
```

These are much easier to read and share than random strings like `rltelbqq`.

## Collision Handling

If your subdomain is already in use by another client on the same server, localtunnels automatically appends an incrementing suffix:

```
myapp        -> taken
myapp-2      -> taken
myapp-3      -> available, use this
```

This happens transparently over the WebSocket connection — no crashes, no reconnects, no manual intervention.

### How It Works

1. Client sends `ready` message with desired subdomain
2. Server checks if subdomain has an active connection
3. If taken, server responds with `subdomain_taken`
4. Client increments suffix and retries immediately (same WebSocket connection)
5. Server confirms with `registered` once a free subdomain is found

## CLI Usage

```bash
# Explicit subdomain
localtunnels start --port 3000 --subdomain myapp

# APP_NAME auto-detection
APP_NAME="My App" localtunnels start --port 3000

# Random name (no flags needed)
localtunnels start --port 3000
```

## Library Usage

```ts
import { TunnelClient } from 'localtunnels'

// Explicit subdomain
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  subdomain: 'myapp',
})

await client.connect()
// If 'myapp' was taken, client.getSubdomain() returns 'myapp-2', etc.
console.log(`Got subdomain: ${client.getSubdomain()}`)
```

```ts
import { startLocalTunnel } from 'localtunnels'

// Let APP_NAME or random name be used
const client = await startLocalTunnel({ port: 3000 })
console.log(`URL: ${client.getTunnelUrl()}`)
```

## Subdomain Rules

Valid subdomains must:

- Be lowercase alphanumeric with optional hyphens
- Start and end with a letter or number
- Be between 1 and 63 characters

### Valid

```
myapp
my-cool-app
staging-v2
client-demo
```

### Invalid

```
my_app         # underscores not allowed
my.app         # dots not allowed
-my-app        # can't start with hyphen
MY-APP         # must be lowercase
```

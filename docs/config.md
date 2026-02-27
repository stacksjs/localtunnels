# Configuration

localtunnels can be configured via CLI flags, constructor options, or environment variables.

## TunnelOptions

These options apply to both `TunnelClient` and the `startLocalTunnel()` convenience function:

```ts
interface TunnelOptions {
  /** Port to connect to (for server) or listen on (for client)
   * @default 3000 */
  port?: number

  /** Tunnel server hostname
   * @default 'localhost' for client, '0.0.0.0' for server */
  host?: string

  /** Use secure WebSocket (wss://) and HTTPS
   * @default false */
  secure?: boolean

  /** Enable verbose logging
   * @default false */
  verbose?: boolean

  /** Local port to forward requests to
   * @default 8000 */
  localPort?: number

  /** Local host to forward requests to
   * @default 'localhost' */
  localHost?: string

  /** Subdomain to use for the tunnel.
   * Resolution order: explicit value > APP_NAME env var > random name
   * If not specified, checks APP_NAME env var (slugified),
   * then falls back to a random adjective-noun combo. */
  subdomain?: string

  /** SSL/TLS options for secure connections */
  ssl?: {
    key: string
    cert: string
    ca?: string
  }

  /** Connection timeout in milliseconds
   * @default 10000 */
  timeout?: number

  /** Maximum reconnection attempts
   * @default 10 */
  maxReconnectAttempts?: number

  /** API key for authentication (if required by server) */
  apiKey?: string

  /** Auto-resolve DNS for tunnel server connectivity.
   * When the system resolver can't reach the server (common on macOS
   * with .dev TLD), resolves the IP via DoH/dig and connects directly.
   * @default true */
  manageHosts?: boolean
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `APP_NAME` | Used as the default subdomain (slugified). e.g. `My Cool App` becomes `my-cool-app` |
| `TUNNEL_SERVER` | Default tunnel server URL |
| `TUNNEL_SUBDOMAIN` | Default subdomain to request |

## CLI Flags

### `localtunnels start`

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Local port to expose | `3000` |
| `-s, --subdomain <name>` | Request a specific subdomain | auto |
| `-h, --host <host>` | Local hostname to forward to | `localhost` |
| `--server <url>` | Tunnel server URL | `localtunnel.dev` |
| `--verbose` | Enable verbose logging | `false` |
| `--secure` | Use secure WebSocket (wss://) | `false` |
| `--no-manage-hosts` | Disable auto DNS resolution | `false` |

### `localtunnels server`

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port to listen on | `3000` |
| `-h, --host <host>` | Host to bind to | `0.0.0.0` |
| `--domain <domain>` | Domain for tunnel URLs | `localhost` |
| `--verbose` | Enable verbose logging | `false` |

### `localtunnels deploy`

| Flag | Description | Default |
|------|-------------|---------|
| `--region <region>` | AWS region | `us-east-1` |
| `--prefix <prefix>` | Resource name prefix | `localtunnel` |
| `--domain <domain>` | Domain for tunnel URLs | |
| `--instance-type <type>` | EC2 instance type | `t3.micro` |
| `--key-name <name>` | EC2 key pair name for SSH | |
| `--enable-ssl` | Enable SSL via Let's Encrypt | `false` |
| `--verbose` | Enable verbose logging | `false` |

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

   * Resolution order: explicit value > APP*NAME env var > random name
   * If not specified, checks APP*NAME env var (slugified),
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
| `HCLOUD_TOKEN` / `HETZNER_API_TOKEN` | Hetzner API token for `deploy:tunnel --provider hetzner` and `deploy:vpn` |
| `AWS_REGION` | AWS region for `deploy:vpn --provider aws` (default `us-east-1`) |
| `PORKBUN_API_KEY` / `PORKBUN_SECRET_KEY` | Porkbun DNS-01 credentials for wildcard TLS (`--enable-ssl`) |
| `DEPLOY_PROVIDER` | Default provider for the `deploy:vpn` scripts (`hetzner` or `aws`) |

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
| `--insecure` | Skip TLS certificate verification (self-signed/mismatched certs only) | `false` |
| `--no-manage-hosts` | Disable auto DNS resolution | `false` |

When the system resolver can't reach the server and `manageHosts` resolves the IP directly, the client still verifies the server's certificate against the tunnel hostname (via SNI) rather than trusting the connection blindly. Pass `--insecure` only if your server presents a self-signed or mismatched certificate you trust — it disables that check and exposes the connection to MITM.

### `localtunnels server`

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port to listen on | `3000` |
| `-h, --host <host>` | Host to bind to | `0.0.0.0` |
| `--domain <domain>` | Domain for tunnel URLs | `localhost` |
| `--verbose` | Enable verbose logging | `false` |

### `localtunnels deploy:tunnel`

Deploys the tunnel server to the cloud. `--provider` selects the cloud (AWS EC2 or Hetzner Cloud, via ts-cloud).

| Flag | Description | Default |
|------|-------------|---------|
| `--provider <provider>` | Cloud provider: `aws` or `hetzner` | `aws` |
| `--region <region>` | AWS region (AWS only) | `us-east-1` |
| `--server-type <type>` | Hetzner server type (Hetzner only) | `cx23` |
| `--location <location>` | Hetzner location (Hetzner only) | `fsn1` |
| `--prefix <prefix>` | Resource name prefix | `localtunnel` |
| `--domain <domain>` | Domain for tunnel URLs (AWS sets up Route53; Hetzner prints records) | |
| `--instance-type <type>` | EC2 instance type (AWS only) | `t3.micro` |
| `--key-name <name>` | EC2 key pair name for SSH (AWS only) | |
| `--enable-ssl` | Wildcard Let's Encrypt TLS via Porkbun DNS-01 | `false` |
| `--porkbun-api-key <key>` | Porkbun API key (or the `PORKBUN_API_KEY` env var) | |
| `--porkbun-secret-key <key>` | Porkbun secret key (or the `PORKBUN_SECRET_KEY` env var) | |
| `--verbose` | Enable verbose logging | `false` |

For the VPN / exit-node deployment and its `deploy:vpn` / `verify:vpn` / `destroy:vpn` scripts, see [VPN Deployment](/advanced/vpn-deployment).

# Troubleshooting

Common issues and their solutions when using localtunnels.

## DNS / Connection Issues

### Connection Timeout on macOS (`.dev` TLD)

**Symptoms:**

- `localtunnels start` hangs at "Connecting..." then fails with "Connection timeout"
- `dig localtunnel.dev` works, but `curl https://localtunnel.dev` times out
- Only happens on macOS

**Cause:**

macOS has a built-in resolver override for `.dev` domains at `/etc/resolver/dev` that points to a local DNS server (often from Docker Desktop or other tools). This overrides `/etc/hosts` and the system DNS resolver, but `dig`/`nslookup` use their own resolvers so they work fine.

**Solution:**

localtunnels handles this automatically. When the system resolver can't reach the tunnel server, it:

1. Resolves the IP via DNS-over-HTTPS (Cloudflare) or `dig @8.8.8.8`
2. Connects the WebSocket directly to the IP with the correct Host header

This is enabled by default (`manageHosts: true`). If you disabled it, re-enable:

```bash
# manageHosts is on by default, just don't pass --no-manage-hosts
localtunnels start --port 3000
```

To verify your system has this issue:

```bash
# This works (uses its own resolver):
dig localtunnel.dev

# This times out (uses system resolver):
curl -sk https://localtunnel.dev/status

# This works (bypasses DNS):
curl -sk --resolve 'localtunnel.dev:443:18.210.211.229' https://localtunnel.dev/status

# Check for resolver override:
cat /etc/resolver/dev
```

### Connection Timeout (General)

**Symptoms:**

- Connection fails with "Connection timeout"
- Not macOS-specific

**Solutions:**

1. Check if the tunnel server is running:

```bash
localtunnels status --server localtunnel.dev
```

2. Increase the timeout:

```bash
localtunnels start --port 3000 --verbose
```

```ts
const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
  timeout: 30000, // 30 seconds
})
```

3. Check your firewall/proxy settings — WebSocket connections on port 443 need to be allowed.

## Subdomain Issues

### Subdomain Already in Use

**Symptoms:**

- Wanted `myapp` but got `myapp-2`

**Explanation:**

Another client already has `myapp` registered on the server. localtunnels automatically appends `-2`, `-3`, etc. to find a free subdomain. Check the actual subdomain:

```ts
await client.connect()
console.log(client.getSubdomain()) // might be 'myapp-2'
console.log(client.getTunnelUrl()) // https://myapp-2.localtunnel.dev
```

### Invalid Subdomain

**Symptoms:**

- Error: "Invalid subdomain format"

**Solution:**

Subdomains must be lowercase alphanumeric with optional hyphens, not starting/ending with a hyphen:

```bash
# Valid
localtunnels start --subdomain my-app
localtunnels start --subdomain staging-v2

# Invalid
localtunnels start --subdomain MY-APP       # uppercase
localtunnels start --subdomain my_app       # underscores
localtunnels start --subdomain -my-app      # leading hyphen
```

## Local Server Issues

### "Bad Gateway" Responses

**Symptoms:**

- Tunnel connects fine, but requests return 502 errors

**Solution:**

Make sure your local server is running on the port you specified:

```bash
# If you're tunneling port 3000, make sure something is listening there
curl http://localhost:3000
```

### Request Forwarding Fails

**Symptoms:**

- Requests reach the tunnel but don't arrive at your local server

**Solutions:**

1. Check the local host/port settings:

```bash
localtunnels start --port 3000 --host localhost --verbose
```

2. Try `127.0.0.1` instead of `localhost`:

```bash
localtunnels start --port 3000 --host 127.0.0.1
```

## Self-Hosted Server Issues

### Port Already in Use

```bash
# Find what's using the port
lsof -i :3000

# Use a different port
localtunnels server --port 8080
```

### Clients Can't Connect

1. Check firewall rules — ports 80/443 (or your custom port) must be open
2. Verify the server is listening on `0.0.0.0` (not just `localhost`):

```bash
localtunnels server --host 0.0.0.0 --port 3000
```

3. Check the server status:

```bash
curl http://your-server:3000/status
```

## Debugging

Enable verbose mode to see all messages:

```bash
localtunnels start --port 3000 --verbose
```

This shows:
- DNS resolution attempts and results
- WebSocket connection lifecycle
- All HTTP requests/responses forwarded through the tunnel
- Subdomain negotiation (taken/retry)
- Reconnection attempts

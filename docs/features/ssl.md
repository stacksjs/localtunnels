# SSL/TLS Support

localtunnels provides built-in SSL/TLS support for secure communication between clients and your local server. This ensures that all traffic is encrypted and secure.

## Configuration

SSL/TLS can be enabled by providing SSL certificate information in the tunnel options:

```typescript
import { TunnelServer } from 'localtunnels'
import { readFileSync } from 'fs'

const server = new TunnelServer({
  port: 3000,
  secure: true,
  ssl: {
    key: readFileSync('/path/to/private.key'),
    cert: readFileSync('/path/to/certificate.crt'),
    ca: readFileSync('/path/to/ca.crt') // Optional: for custom CA
  }
})

await server.start()
```

## Certificate Requirements

The SSL certificates should meet the following requirements:

1. Valid SSL certificate (self-signed certificates are not recommended for production)
2. Certificate should be issued for your domain
3. Certificate chain should be complete
4. Private key should be kept secure and not shared

## Automatic Certificate Management

For development purposes, you can use tools like [mkcert](https://github.com/FiloSottile/mkcert) to generate valid local certificates:

```bash
# Install mkcert
brew install mkcert
mkcert -install

# Generate certificates for your domain
mkcert tunnel.example.com
```

## Security Best Practices

1. **Always use HTTPS**: Enable SSL/TLS in production environments
2. **Certificate Rotation**: Regularly rotate SSL certificates
3. **Strong Ciphers**: Use strong encryption ciphers
4. **HSTS**: Consider enabling HTTP Strict Transport Security
5. **Certificate Validation**: Always validate certificates on both ends

## Example: Secure Server Setup

Here's a complete example of setting up a secure tunnel server:

```typescript
import { TunnelServer } from 'localtunnels'
import { readFileSync } from 'fs'

const server = new TunnelServer({
  port: 3000,
  host: '0.0.0.0',
  secure: true,
  ssl: {
    key: readFileSync('/path/to/private.key'),
    cert: readFileSync('/path/to/certificate.crt'),
    ca: readFileSync('/path/to/ca.crt')
  },
  verbose: true
})

// Error handling
server.on('error', (error) => {
  console.error('Server error:', error)
})

// Start the server
await server.start()
```

## Troubleshooting

Common SSL/TLS issues and solutions:

1. **Certificate Chain Issues**
   - Ensure all intermediate certificates are included
   - Verify certificate order in the chain

2. **Certificate Validation Errors**
   - Check certificate expiration dates
   - Verify domain names match
   - Ensure certificates are properly formatted

3. **Connection Issues**
   - Verify SSL/TLS is enabled on both ends
   - Check firewall settings
   - Ensure proper port forwarding

## Limitations

1. SSL/TLS adds some overhead to connections
2. Certificate management requires additional setup
3. Some older clients may not support modern SSL/TLS versions

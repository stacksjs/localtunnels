# Server Configuration

This guide covers advanced server configuration options and best practices for localtunnels.

## Advanced Options

### Basic Configuration

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  host: '0.0.0.0',
  secure: true,
  verbose: true
})
```

### Custom Domain Configuration

```typescript
const server = new TunnelServer({
  port: 3000,
  host: 'tunnel.example.com',
  secure: true,
  subdomain: 'custom' // Results in custom.tunnel.example.com
})
```

### SSL Configuration

```typescript
import { readFileSync } from 'node:fs'

const server = new TunnelServer({
  port: 3000,
  secure: true,
  ssl: {
    key: readFileSync('/path/to/private.key'),
    cert: readFileSync('/path/to/certificate.crt'),
    ca: readFileSync('/path/to/ca.crt')
  }
})
```

## Performance Tuning

### Connection Pooling

The server maintains a pool of connections for better performance. You can configure the pool size:

```typescript
const server = new TunnelServer({
  port: 3000,
  maxConnections: 1000, // Maximum number of concurrent connections
  connectionTimeout: 30000 // Connection timeout in milliseconds
})
```

### Request Timeouts

Configure timeouts for different types of operations:

```typescript
const server = new TunnelServer({
  port: 3000,
  requestTimeout: 30000, // HTTP request timeout
  websocketTimeout: 60000, // WebSocket connection timeout
  keepAliveTimeout: 30000 // Keep-alive timeout
})
```

## Security Configuration

### Rate Limiting

Implement rate limiting to prevent abuse:

```typescript
const server = new TunnelServer({
  port: 3000,
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  }
})
```

### IP Filtering

Restrict access to specific IP addresses:

```typescript
const server = new TunnelServer({
  port: 3000,
  allowedIps: ['192.168.1.1', '10.0.0.0/24']
})
```

## Monitoring and Logging

### Verbose Logging

Enable detailed logging for debugging:

```typescript
const server = new TunnelServer({
  port: 3000,
  verbose: true,
  logLevel: 'debug' // 'error' | 'warn' | 'info' | 'debug'
})
```

### Custom Logging

Implement custom logging:

```typescript
const server = new TunnelServer({
  port: 3000,
  logger: {
    info: message => console.log(`[INFO] ${message}`),
    error: message => console.error(`[ERROR] ${message}`),
    debug: message => console.debug(`[DEBUG] ${message}`)
  }
})
```

## High Availability

### Load Balancing

For high-traffic applications, you can run multiple tunnel servers behind a load balancer:

```typescript
// Server 1
const server1 = new TunnelServer({
  port: 3000,
  host: 'tunnel1.example.com'
})

// Server 2
const server2 = new TunnelServer({
  port: 3000,
  host: 'tunnel2.example.com'
})

// Configure load balancer to distribute traffic between servers
```

### Health Checks

Implement health checks for monitoring:

```typescript
const server = new TunnelServer({
  port: 3000,
  healthCheck: {
    path: '/health',
    interval: 30000 // Check every 30 seconds
  }
})
```

## Best Practices

1. **Security**
   - Always use SSL/TLS in production
   - Implement rate limiting
   - Use IP filtering when possible
   - Keep certificates up to date

2. **Performance**
   - Monitor connection pools
   - Adjust timeouts based on your needs
   - Implement proper error handling
   - Use appropriate logging levels

3. **Maintenance**
   - Regular security updates
   - Monitor server resources
   - Backup configurations
   - Document custom settings

## Troubleshooting

Common server issues and solutions:

1. **Connection Issues**
   - Check firewall settings
   - Verify port availability
   - Check SSL certificate validity
   - Monitor connection limits

2. **Performance Issues**
   - Monitor connection pool usage
   - Check for memory leaks
   - Verify network bandwidth
   - Review timeout settings

3. **Security Issues**
   - Review access logs
   - Check for suspicious activity
   - Verify SSL configuration
   - Update security settings

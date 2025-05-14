# Client Configuration

This guide covers advanced client configuration options and best practices for localtunnels.

## Basic Configuration

```typescript
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  localPort: 8000,
  localHost: 'localhost'
})

await client.connect()
```

## Advanced Options

### Connection Settings

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  localPort: 8000,
  localHost: 'localhost',
  secure: true,  // Use secure WebSocket
  reconnect: {
    retries: 5,
    minTimeout: 1000,
    maxTimeout: 5000
  }
})
```

### Custom Subdomain

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  subdomain: 'myapp',  // Request specific subdomain
  onSubdomainConflict: (subdomain) => {
    console.log(`Subdomain ${subdomain} is already in use`)
  }
})
```

## Event Handling

### Connection Events

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com'
})

client.on('connected', () => {
  console.log('Connected to tunnel server')
})

client.on('disconnected', () => {
  console.log('Disconnected from tunnel server')
})

client.on('error', (error) => {
  console.error('Tunnel error:', error)
})
```

### Request Events

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com'
})

client.on('request', (req) => {
  console.log('Received request:', req.url)
})

client.on('response', (res) => {
  console.log('Sent response:', res.statusCode)
})
```

## Performance Tuning

### Connection Pooling

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000
  }
})
```

### Request Timeouts

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  timeout: {
    connect: 5000,
    request: 30000,
    response: 30000
  }
})
```

## Security Configuration

### SSL/TLS

```typescript
import { readFileSync } from 'fs'

const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  secure: true,
  ssl: {
    key: readFileSync('/path/to/private.key'),
    cert: readFileSync('/path/to/certificate.crt'),
    ca: readFileSync('/path/to/ca.crt')
  }
})
```

### Authentication

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  auth: {
    username: 'user',
    password: 'pass'
  }
})
```

## Monitoring and Logging

### Verbose Logging

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  verbose: true,
  logLevel: 'debug'  // 'error' | 'warn' | 'info' | 'debug'
})
```

### Custom Logging

```typescript
const client = new TunnelClient({
  port: 3000,
  host: 'tunnel.example.com',
  logger: {
    info: (message) => console.log(`[INFO] ${message}`),
    error: (message) => console.error(`[ERROR] ${message}`),
    debug: (message) => console.debug(`[DEBUG] ${message}`)
  }
})
```

## Best Practices

1. **Connection Management**
   - Implement proper error handling
   - Use automatic reconnection
   - Monitor connection health
   - Handle disconnections gracefully

2. **Security**
   - Always use SSL/TLS in production
   - Implement proper authentication
   - Validate server certificates
   - Keep credentials secure

3. **Performance**
   - Use connection pooling
   - Set appropriate timeouts
   - Monitor resource usage
   - Implement proper error handling

## Troubleshooting

Common client issues and solutions:

1. **Connection Issues**
   - Check network connectivity
   - Verify server availability
   - Check firewall settings
   - Verify SSL configuration

2. **Performance Issues**
   - Monitor connection pool usage
   - Check timeout settings
   - Verify network bandwidth
   - Review error logs

3. **Security Issues**
   - Verify SSL certificates
   - Check authentication
   - Review security settings
   - Monitor for suspicious activity

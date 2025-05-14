# Troubleshooting

This guide covers common issues and their solutions when using localtunnels.

## Connection Issues

### Connection Timeout

**Symptoms:**

- Connection attempts fail with timeout errors
- Slow connection establishment
- Intermittent connection failures

**Solutions:**

```typescript
const server = new TunnelServer({
  port: 3000,
  timeout: {
    connect: 10000,    // Increase connection timeout
    request: 30000,    // Adjust request timeout
    response: 30000    // Adjust response timeout
  }
})
```

### Connection Refused

**Symptoms:**

- "Connection refused" errors
- Unable to establish connection
- Port already in use

**Solutions:**

1. Check if the port is already in use:

```bash
# Check if port is in use
lsof -i :3000
# Kill process using port
kill -9 <PID>
```

2. Verify firewall settings:

```typescript
const server = new TunnelServer({
  port: 3000,
  host: '0.0.0.0',  // Listen on all interfaces
  firewall: {
    allowedPorts: [3000],
    allowedIps: ['0.0.0.0/0']
  }
})
```

## SSL/TLS Issues

### Certificate Errors

**Symptoms:**

- SSL handshake failures
- Certificate validation errors
- Mixed content warnings

**Solutions:**

```typescript
const server = new TunnelServer({
  port: 3000,
  secure: true,
  ssl: {
    key: readFileSync('/path/to/private.key'),
    cert: readFileSync('/path/to/certificate.crt'),
    ca: readFileSync('/path/to/ca.crt'),
    rejectUnauthorized: true
  }
})
```

### SSL Handshake Failures

**Symptoms:**

- SSL handshake timeout
- Protocol version mismatch
- Cipher suite issues

**Solutions:**

```typescript
const server = new TunnelServer({
  port: 3000,
  secure: true,
  ssl: {
    key: readFileSync('/path/to/private.key'),
    cert: readFileSync('/path/to/certificate.crt'),
    ciphers: [
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256'
    ].join(':'),
    minVersion: 'TLSv1.2'
  }
})
```

## Performance Issues

### High Memory Usage

**Symptoms:**

- Memory leaks
- Slow performance
- Out of memory errors

**Solutions:**

```typescript
const server = new TunnelServer({
  port: 3000,
  memory: {
    maxHeapSize: 1024 * 1024 * 1024, // 1GB
    maxOldSpaceSize: 512 * 1024 * 1024, // 512MB
    gc: {
      enabled: true,
      interval: 30000
    }
  }
})
```

### Slow Response Times

**Symptoms:**

- High latency
- Slow request processing
- Connection delays

**Solutions:**

```typescript
const server = new TunnelServer({
  port: 3000,
  performance: {
    connectionPool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000
    },
    cache: {
      enabled: true,
      ttl: 3600
    }
  }
})
```

## WebSocket Issues

### WebSocket Connection Failures

**Symptoms:**

- WebSocket connection drops
- Connection timeouts
- Protocol errors

**Solutions:**

```typescript
const server = new TunnelServer({
  port: 3000,
  websocket: {
    pingInterval: 30000,
    pingTimeout: 5000,
    maxPayload: 1024 * 1024, // 1MB
    perMessageDeflate: true
  }
})
```

### WebSocket Message Issues

**Symptoms:**

- Message delivery failures
- Message corruption
- Protocol violations

**Solutions:**

```typescript
const server = new TunnelServer({
  port: 3000,
  websocket: {
    messageValidation: true,
    maxMessageSize: 1024 * 1024, // 1MB
    compression: {
      enabled: true,
      threshold: 1024 // Compress messages > 1KB
    }
  }
})
```

## Logging and Debugging

### Enable Debug Logging

```typescript
const server = new TunnelServer({
  port: 3000,
  logging: {
    level: 'debug',
    format: 'json',
    file: '/path/to/debug.log'
  }
})
```

### Custom Error Handling

```typescript
const server = new TunnelServer({
  port: 3000,
  errorHandling: {
    onError: (error) => {
      console.error('Server error:', error)
      // Custom error handling
    },
    onWarning: (warning) => {
      console.warn('Server warning:', warning)
      // Custom warning handling
    }
  }
})
```

## Common Error Codes

1. **Connection Errors**
   - ECONNREFUSED: Connection refused
   - ETIMEDOUT: Connection timeout
   - ECONNRESET: Connection reset
   - EADDRINUSE: Address already in use

2. **SSL/TLS Errors**
   - CERT_HAS_EXPIRED: Certificate expired
   - CERT_NOT_YET_VALID: Certificate not valid yet
   - DEPTH_ZERO_SELF_SIGNED_CERT: Self-signed certificate
   - UNABLE_TO_VERIFY_LEAF_SIGNATURE: Unable to verify certificate chain

3. **WebSocket Errors**
   - WS_ERR_INVALID_CLOSE_CODE: Invalid close code
   - WS_ERR_INVALID_UTF8: Invalid UTF-8 sequence
   - WS_ERR_UNEXPECTED_RESPONSE: Unexpected response
   - WS_ERR_HANDSHAKE_UNEXPECTED: Unexpected handshake

## Diagnostic Tools

### Health Check

```typescript
const server = new TunnelServer({
  port: 3000,
  healthCheck: {
    enabled: true,
    path: '/health',
    interval: 30000,
    timeout: 5000
  }
})
```

### Performance Monitoring

```typescript
const server = new TunnelServer({
  port: 3000,
  monitoring: {
    enabled: true,
    metrics: [
      'responseTime',
      'memoryUsage',
      'connectionCount',
      'errorRate'
    ],
    interval: 60000
  }
})
```

## Best Practices

1. **Error Handling**
   - Implement proper error handling
   - Log all errors
   - Monitor error rates
   - Set up alerts

2. **Monitoring**
   - Enable health checks
   - Monitor performance metrics
   - Track error rates
   - Set up logging

3. **Debugging**
   - Use debug logging
   - Implement custom error handling
   - Monitor system resources
   - Track connection states

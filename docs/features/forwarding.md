# Request Forwarding

localtunnels provides powerful request forwarding capabilities, allowing you to route traffic from the tunnel server to your local services with full control over the forwarding process.

## Basic Forwarding

The most basic form of forwarding is to specify the local port and host:

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  localPort: 8000, // Your local service port
  localHost: 'localhost' // Your local service host
})

await server.start()
```

## Advanced Forwarding Options

### Custom Headers

You can modify headers during forwarding:

```typescript
const server = new TunnelServer({
  port: 3000,
  localPort: 8000,
  forwardOptions: {
    headers: {
      'X-Forwarded-For': 'true',
      'X-Forwarded-Proto': 'https'
    }
  }
})
```

### Path Rewriting

Rewrite paths during forwarding:

```typescript
const server = new TunnelServer({
  port: 3000,
  localPort: 8000,
  forwardOptions: {
    pathRewrite: {
      '^/api': '/v1' // Rewrite /api to /v1
    }
  }
})
```

### Request Transformation

Transform requests before forwarding:

```typescript
const server = new TunnelServer({
  port: 3000,
  localPort: 8000,
  forwardOptions: {
    transformRequest: (req) => {
      // Modify request before forwarding
      req.headers['X-Custom-Header'] = 'value'
      return req
    }
  }
})
```

## Response Handling

### Response Transformation

Transform responses before sending to client:

```typescript
const server = new TunnelServer({
  port: 3000,
  localPort: 8000,
  forwardOptions: {
    transformResponse: (res) => {
      // Modify response before sending to client
      res.headers['X-Response-Time'] = Date.now().toString()
      return res
    }
  }
})
```

### Error Handling

Handle forwarding errors:

```typescript
const server = new TunnelServer({
  port: 3000,
  localPort: 8000,
  forwardOptions: {
    onError: (err, req, res) => {
      console.error('Forwarding error:', err)
      res.statusCode = 502
      res.end('Bad Gateway')
    }
  }
})
```

## Performance Optimization

### Connection Pooling

Optimize connection reuse:

```typescript
const server = new TunnelServer({
  port: 3000,
  localPort: 8000,
  forwardOptions: {
    keepAlive: true,
    maxSockets: 100
  }
})
```

### Timeout Configuration

Configure various timeouts:

```typescript
const server = new TunnelServer({
  port: 3000,
  localPort: 8000,
  forwardOptions: {
    timeout: 5000, // 5 seconds
    proxyTimeout: 30000 // 30 seconds
  }
})
```

## Best Practices

1. **Security**
   - Validate incoming requests
   - Sanitize headers
   - Implement rate limiting
   - Use HTTPS for sensitive data

2. **Performance**
   - Enable connection pooling
   - Set appropriate timeouts
   - Monitor forwarding metrics
   - Cache when possible

3. **Error Handling**
   - Implement proper error handling
   - Log forwarding errors
   - Provide meaningful error messages
   - Handle timeouts gracefully

## Troubleshooting

Common forwarding issues and solutions:

1. **Connection Issues**
   - Check local service availability
   - Verify port accessibility
   - Check firewall settings
   - Monitor connection limits

2. **Performance Issues**
   - Check connection pool settings
   - Monitor timeout values
   - Verify network bandwidth
   - Check for memory leaks

3. **Error Handling**
   - Review error logs
   - Check error handlers
   - Verify error responses
   - Monitor error rates

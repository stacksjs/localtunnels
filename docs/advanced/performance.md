# Performance Tuning

This guide covers performance optimization techniques and best practices for localtunnels.

## Connection Management

### Connection Pooling

Optimize connection reuse with connection pooling:

```typescript
const server = new TunnelServer({
  port: 3000,
  pool: {
    min: 2,  // Minimum connections in pool
    max: 10, // Maximum connections in pool
    idleTimeoutMillis: 30000, // Time before idle connections are closed
    acquireTimeoutMillis: 30000 // Time to wait for a connection
  }
})
```

### Keep-Alive

Enable keep-alive for better connection reuse:

```typescript
const server = new TunnelServer({
  port: 3000,
  keepAlive: {
    enabled: true,
    timeout: 60000, // Keep-alive timeout
    maxRequests: 100 // Maximum requests per connection
  }
})
```

## Request Handling

### Request Timeouts

Configure timeouts for different operations:

```typescript
const server = new TunnelServer({
  port: 3000,
  timeout: {
    connect: 5000,    // Connection timeout
    request: 30000,   // Request timeout
    response: 30000,  // Response timeout
    idle: 60000      // Idle timeout
  }
})
```

### Request Buffering

Optimize request buffering:

```typescript
const server = new TunnelServer({
  port: 3000,
  buffer: {
    maxSize: 1024 * 1024, // 1MB
    highWaterMark: 8192   // 8KB
  }
})
```

## Memory Management

### Memory Limits

Set memory limits to prevent OOM issues:

```typescript
const server = new TunnelServer({
  port: 3000,
  memory: {
    maxHeapSize: 1024 * 1024 * 1024, // 1GB
    maxOldSpaceSize: 512 * 1024 * 1024 // 512MB
  }
})
```

### Garbage Collection

Configure garbage collection:

```typescript
const server = new TunnelServer({
  port: 3000,
  gc: {
    enabled: true,
    interval: 30000, // Run GC every 30 seconds
    threshold: 0.8   // Run GC when memory usage is above 80%
  }
})
```

## Caching

### Response Caching

Implement response caching:

```typescript
const server = new TunnelServer({
  port: 3000,
  cache: {
    enabled: true,
    ttl: 3600, // Cache TTL in seconds
    maxSize: 1000, // Maximum number of cached items
    excludePaths: ['/api/dynamic'] // Paths to exclude from caching
  }
})
```

### Memory Cache

Use in-memory caching:

```typescript
const server = new TunnelServer({
  port: 3000,
  memoryCache: {
    enabled: true,
    maxSize: 100 * 1024 * 1024, // 100MB
    ttl: 300 // 5 minutes
  }
})
```

## Load Balancing

### Load Balancer Configuration

Configure load balancing:

```typescript
const server = new TunnelServer({
  port: 3000,
  loadBalancer: {
    enabled: true,
    algorithm: 'round-robin', // or 'least-connections'
    healthCheck: {
      path: '/health',
      interval: 30000
    }
  }
})
```

### Worker Threads

Use worker threads for better performance:

```typescript
const server = new TunnelServer({
  port: 3000,
  workers: {
    enabled: true,
    count: 4, // Number of worker threads
    maxMemory: 512 * 1024 * 1024 // 512MB per worker
  }
})
```

## Monitoring

### Performance Metrics

Enable performance monitoring:

```typescript
const server = new TunnelServer({
  port: 3000,
  metrics: {
    enabled: true,
    interval: 60000, // Collect metrics every minute
    metrics: [
      'responseTime',
      'memoryUsage',
      'connectionCount',
      'requestCount'
    ]
  }
})
```

### Profiling

Enable performance profiling:

```typescript
const server = new TunnelServer({
  port: 3000,
  profiling: {
    enabled: true,
    interval: 300000, // Profile every 5 minutes
    duration: 60000,  // Profile for 1 minute
    output: '/path/to/profiles'
  }
})
```

## Best Practices

1. **Connection Management**
   - Use connection pooling
   - Enable keep-alive
   - Monitor connection limits
   - Handle connection errors

2. **Memory Management**
   - Set memory limits
   - Monitor memory usage
   - Implement proper garbage collection
   - Handle memory leaks

3. **Caching**
   - Use appropriate cache strategies
   - Set proper TTLs
   - Monitor cache hit rates
   - Handle cache invalidation

4. **Load Balancing**
   - Use appropriate algorithms
   - Monitor server health
   - Handle failover
   - Scale horizontally

## Performance Checklist

1. **Connection Optimization**
   - [ ] Connection pooling configured
   - [ ] Keep-alive enabled
   - [ ] Timeouts set
   - [ ] Error handling implemented

2. **Memory Management**
   - [ ] Memory limits set
   - [ ] GC configured
   - [ ] Memory monitoring enabled
   - [ ] Leak detection implemented

3. **Caching**
   - [ ] Response caching configured
   - [ ] Memory cache enabled
   - [ ] Cache invalidation handled
   - [ ] Cache monitoring enabled

4. **Load Balancing**
   - [ ] Load balancer configured
   - [ ] Health checks enabled
   - [ ] Failover handled
   - [ ] Scaling configured

## Troubleshooting

Common performance issues and solutions:

1. **High Memory Usage**
   - Check for memory leaks
   - Adjust memory limits
   - Optimize garbage collection
   - Monitor memory patterns

2. **Slow Response Times**
   - Check connection pooling
   - Verify caching
   - Monitor network latency
   - Check server load

3. **Connection Issues**
   - Verify connection limits
   - Check timeout settings
   - Monitor connection errors
   - Review load balancing

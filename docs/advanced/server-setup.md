# Server Setup

This guide covers setting up and deploying a self-hosted localtunnels server for production use. Learn how to configure, deploy, and maintain your own tunnel infrastructure.

## Server Architecture

The localtunnels server handles:

- WebSocket connections from tunnel clients
- HTTP/HTTPS request forwarding
- Subdomain routing
- Connection management

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Internet      │────▶│  Tunnel Server  │────▶│  Local Client   │
│   (Requests)    │◀────│  (WebSocket)    │◀────│  (Developer)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Basic Server Setup

### Minimal Server

```typescript
// server.ts
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  host: '0.0.0.0',
  verbose: true,
})

await server.start()
console.log('Tunnel server running on port 3000')
```

### Production Server

```typescript
// server.ts
import { TunnelServer } from 'localtunnels'

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'
const VERBOSE = process.env.VERBOSE === 'true'

const server = new TunnelServer({
  port: PORT,
  host: HOST,
  verbose: VERBOSE,
  secure: process.env.NODE_ENV === 'production',
})

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...')
  server.stop()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...')
  server.stop()
  process.exit(0)
})

await server.start()
console.log(`Tunnel server running on ${HOST}:${PORT}`)
```

## Deployment Options

### Docker Deployment

#### Dockerfile

```dockerfile
FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy application code
COPY . .

# Build the application
RUN bun run build

# Expose the tunnel port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Run the server
CMD ["bun", "run", "dist/server.js"]
```

#### Docker Compose

```yaml
version: '3.8'

services:
  tunnel-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
      - VERBOSE=false
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - tunnel-server
    restart: unless-stopped
```

### Kubernetes Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tunnel-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tunnel-server
  template:
    metadata:
      labels:
        app: tunnel-server
    spec:
      containers:
      - name: tunnel-server
        image: your-registry/tunnel-server:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "3000"
        resources:
          limits:
            cpu: "500m"
            memory: "512Mi"
          requests:
            cpu: "100m"
            memory: "128Mi"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: tunnel-server
spec:
  selector:
    app: tunnel-server
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

### AWS Deployment

localtunnels includes AWS CDK support for infrastructure as code:

```typescript
// deploy.ts
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'

class TunnelStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // VPC
    const vpc = new ec2.Vpc(this, 'TunnelVpc', {
      maxAzs: 2,
    })

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'TunnelCluster', {
      vpc,
    })

    // Fargate Service
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TunnelTask', {
      memoryLimitMiB: 512,
      cpu: 256,
    })

    taskDefinition.addContainer('TunnelContainer', {
      image: ecs.ContainerImage.fromRegistry('your-registry/tunnel-server'),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: 'production',
      },
    })

    const service = new ecs.FargateService(this, 'TunnelService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
    })

    // Load Balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'TunnelLB', {
      vpc,
      internetFacing: true,
    })

    const listener = lb.addListener('Listener', {
      port: 443,
    })

    listener.addTargets('TunnelTargets', {
      port: 3000,
      targets: [service],
    })
  }
}

const app = new cdk.App()
new TunnelStack(app, 'TunnelStack')
```

## Reverse Proxy Configuration

### Nginx

```nginx
# nginx.conf
upstream tunnel_server {
    server localhost:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name *.tunnels.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name *.tunnels.example.com;

    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # WebSocket support
    location / {
        proxy_pass http://tunnel_server;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### Caddy

```caddyfile
*.tunnels.example.com {
    reverse_proxy localhost:3000

    # Enable WebSocket
    @websocket {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @websocket localhost:3000
}
```

## SSL/TLS Setup

### Let's Encrypt with Certbot

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain wildcard certificate
sudo certbot certonly \
  --manual \
  --preferred-challenges dns \
  -d "tunnels.example.com" \
  -d "*.tunnels.example.com" \
  --email admin@example.com \
  --agree-tos

# Auto-renewal
sudo certbot renew --dry-run
```

### Certificate Auto-Renewal

```bash
# /etc/cron.d/certbot-renewal
0 0,12 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
```

## Monitoring

### Health Check Endpoint

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({ port: 3000 })
await server.start()

// Health check server
Bun.serve({
  port: 3001,
  fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/metrics') {
      // Add your metrics here
      return new Response('# HELP tunnel_connections Active connections\n')
    }

    return new Response('Not Found', { status: 404 })
  },
})
```

### Logging

```typescript
import { TunnelServer } from 'localtunnels'

// Structured logging
function log(level: string, message: string, meta?: object) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  }))
}

const server = new TunnelServer({
  port: 3000,
  verbose: true,
})

await server.start()
log('info', 'Tunnel server started', { port: 3000 })
```

## Security Hardening

### Firewall Rules

```bash
# Allow only necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### Rate Limiting (Nginx)

```nginx
# Define rate limiting zone
limit_req_zone $binary_remote_addr zone=tunnel_limit:10m rate=10r/s;

server {
    # Apply rate limiting
    location / {
        limit_req zone=tunnel_limit burst=20 nodelay;
        proxy_pass http://tunnel_server;
    }
}
```

## Next Steps

- Optimize [Performance](/advanced/performance) for high-traffic scenarios
- Set up [CI/CD Integration](/advanced/ci-cd-integration) for automated deployments
- Review [Configuration](/advanced/configuration) options

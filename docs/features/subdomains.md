# Custom Subdomains

localtunnels allows you to use custom subdomains for your tunnels, making it easier to manage multiple services and provide memorable URLs.

## Basic Usage

To use a custom subdomain, simply specify it in the tunnel options:

```typescript
import { TunnelServer } from 'localtunnels'

const server = new TunnelServer({
  port: 3000,
  host: 'tunnel.example.com',
  subdomain: 'myapp' // Results in myapp.tunnel.example.com
})

await server.start()
```

## Subdomain Rules

1. **Format**: Subdomains must:
   - Be lowercase
   - Contain only letters, numbers, and hyphens
   - Start with a letter
   - Be between 3 and 63 characters long

2. **Reserved Names**: Some subdomains are reserved for system use:
   - `www`
   - `api`
   - `admin`
   - `status`

## Dynamic Subdomains

You can also generate random subdomains if you don't specify one:

```typescript
const server = new TunnelServer({
  port: 3000,
  host: 'tunnel.example.com'
  // No subdomain specified - will generate a random one
})
```

## Subdomain Management

### Checking Availability

```typescript
const server = new TunnelServer({
  port: 3000,
  host: 'tunnel.example.com',
  subdomain: 'myapp',
  onSubdomainConflict: (subdomain) => {
    console.log(`Subdomain ${subdomain} is already in use`)
    // Handle conflict (e.g., try another subdomain)
  }
})
```

### Subdomain Validation

```typescript
const server = new TunnelServer({
  port: 3000,
  host: 'tunnel.example.com',
  subdomain: 'myapp',
  validateSubdomain: (subdomain) => {
    // Custom validation logic
    return /^[a-z][a-z0-9-]{2,62}$/.test(subdomain)
  }
})
```

## Best Practices

1. **Naming Convention**
   - Use descriptive names
   - Follow a consistent pattern
   - Avoid using sensitive information in subdomains

2. **Environment-based Subdomains**

   ```typescript
   const subdomain = process.env.NODE_ENV === 'production'
     ? 'prod-myapp'
     : 'dev-myapp'

   const server = new TunnelServer({
     port: 3000,
     host: 'tunnel.example.com',
     subdomain
   })
   ```

3. **Subdomain Rotation**
   - Consider rotating subdomains for security
   - Use different subdomains for different environments
   - Document subdomain usage

## Limitations

1. Subdomain availability is first-come, first-served
2. Some subdomains may be blocked by DNS providers
3. Subdomain changes require DNS propagation time
4. Maximum length restrictions apply

## Troubleshooting

Common subdomain issues and solutions:

1. **Subdomain Already in Use**
   - Try a different subdomain
   - Wait for the previous tunnel to close
   - Use the `onSubdomainConflict` handler

2. **Invalid Subdomain**
   - Check the subdomain format
   - Ensure it meets length requirements
   - Verify it's not a reserved name

3. **DNS Issues**
   - Check DNS propagation
   - Verify DNS settings
   - Ensure proper DNS configuration

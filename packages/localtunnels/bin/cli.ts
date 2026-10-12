#!/usr/bin/env bun
/* eslint-disable node/prefer-global/process */
import type { TunDevice as TunDeviceT } from '../src/vpn'
import { randomBytes } from 'node:crypto'
import { CLI } from '@stacksjs/clapp'
import { version } from '../package.json'
import { TunnelClient, TunnelServer } from '../src/tunnel'
import { generateSubdomain, isValidPort, isValidSubdomain } from '../src/utils'

const cli = new CLI('localtunnels')

interface TunnelOptions {
  port: string
  subdomain?: string
  host?: string
  server?: string
  verbose?: boolean
  secure?: boolean
  insecure?: boolean
  manageHosts?: boolean
}

interface ServerOptions {
  port: string
  host?: string
  verbose?: boolean
  domain?: string
}

interface DeployOptions {
  provider?: string
  region?: string
  prefix?: string
  domain?: string
  instanceType?: string
  serverType?: string
  location?: string
  keyName?: string
  sshCidr?: string
  enableSsl?: boolean
  porkbunApiKey?: string
  porkbunSecretKey?: string
  verbose?: boolean
}

interface DestroyOptions {
  provider?: string
  region?: string
  prefix?: string
  domain?: string
  verbose?: boolean
}

// Default tunnel server — TUNNEL_SERVER env var overrides (see `lt info`)
const DEFAULT_SERVER = process.env.TUNNEL_SERVER || 'api.localtunnel.dev'

cli
  .command('start', 'Start a local tunnel to expose your local server')
  .alias('')
  .option('-p, --port <port>', 'Local port to expose', { default: '3000' })
  .option('-s, --subdomain <subdomain>', 'Request a specific subdomain')
  .option('--host <host>', 'Local hostname to forward to', { default: 'localhost' })
  .option('--server <server>', 'Tunnel server URL', { default: DEFAULT_SERVER })
  .option('--verbose', 'Enable verbose logging')
  .option('--secure', 'Use secure WebSocket (wss://)')
  .option('--insecure', 'Skip TLS certificate verification (only for self-signed/mismatched server certs)')
  .option('--no-manage-hosts', 'Disable automatic /etc/hosts management')
  .action(async (options: TunnelOptions) => {
    const localPort = Number.parseInt(options.port)

    if (!isValidPort(localPort)) {
      console.error(`Invalid port: ${options.port}`)
      process.exit(1)
    }

    const requestedSubdomain = options.subdomain || process.env.TUNNEL_SUBDOMAIN

    if (requestedSubdomain && !isValidSubdomain(requestedSubdomain)) {
      console.error(`Invalid subdomain: ${requestedSubdomain}`)
      console.error('Subdomains must be lowercase alphanumeric with optional hyphens')
      process.exit(1)
    }

    const subdomain = requestedSubdomain || generateSubdomain()

    try {
      const serverHost = options.server?.replace(/^(wss?|https?):\/\//, '') || DEFAULT_SERVER
      // The hosted service always speaks TLS; a custom server (flag or TUNNEL_SERVER env) must opt in
      const secure = options.secure || options.server?.startsWith('wss://') || options.server?.startsWith('https://') || serverHost === 'api.localtunnel.dev' || serverHost === 'localtunnel.dev'

      console.log('')
      console.log(`  Connecting to ${serverHost}...`)

      const client = new TunnelClient({
        host: serverHost,
        port: secure ? 443 : 80,
        secure,
        verbose: options.verbose,
        localPort,
        localHost: options.host || 'localhost',
        subdomain,
        manageHosts: options.manageHosts,
        insecure: options.insecure,
      })

      // Handle process signals for graceful shutdown
      let shuttingDown = false
      const cleanup = async () => {
        if (shuttingDown) return
        shuttingDown = true
        console.log('\n  Closing tunnel...')
        try {
          await client.disconnect()
        }
        catch {
          // Best-effort shutdown: a failed disconnect must still exit the
          // process rather than surface as an unhandled rejection that hangs.
        }
        process.exit(0)
      }

      process.on('SIGINT', () => { void cleanup() })
      process.on('SIGTERM', () => { void cleanup() })

      // Set up event listeners
      client.on('request', (req) => {
        if (options.verbose) {
          console.log(`  -> ${req.method} ${req.url}`)
        }
      })

      client.on('response', (res) => {
        if (options.verbose) {
          console.log(`  <- ${res.status} (${res.size} bytes, ${res.duration}ms)`)
        }
      })

      client.on('reconnecting', (info) => {
        console.log(`  Reconnecting... (attempt ${info.attempt}/${info.maxAttempts})`)
      })

      client.on('error', (err) => {
        if (options.verbose) {
          console.error(`  Error: ${err}`)
        }
      })

      await client.connect()

      const tunnelUrl = client.getTunnelUrl()

      console.log('')
      console.log(`  Public:     ${tunnelUrl}`)
      console.log(`  Forwarding: ${tunnelUrl} -> http://${options.host}:${localPort}`)
      console.log('')
      console.log(`  Press Ctrl+C to stop sharing`)
      console.log('')

      if (options.verbose) {
        console.log(`  Verbose mode — showing all requests`)
        console.log('')
      }

      // Keep the process running
      await new Promise(() => {})
    }
    catch (error: any) {
      console.error(`\n  Failed to connect: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('server', 'Start a tunnel server (self-hosted)')
  .option('-p, --port <port>', 'Port to listen on', { default: '3000' })
  .option('--host <host>', 'Host to bind to', { default: '0.0.0.0' })
  .option('--domain <domain>', 'Domain for tunnel URLs', { default: 'localhost' })
  .option('--verbose', 'Enable verbose logging')
  .action(async (options: ServerOptions) => {
    const port = Number.parseInt(options.port)

    if (!isValidPort(port)) {
      console.error(`Invalid port: ${options.port}`)
      process.exit(1)
    }

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   localtunnels server                        ║
╚══════════════════════════════════════════════════════════════╝
`)

    console.log(`Listening on:    ${options.host}:${port}`)
    console.log(`Domain:          ${options.domain}`)
    console.log('')

    try {
      const server = new TunnelServer({
        port,
        host: options.host,
        domain: options.domain,
        verbose: options.verbose,
      })

      // Handle process signals for graceful shutdown
      const cleanup = () => {
        console.log('\nShutting down server...')
        server.stop()
        process.exit(0)
      }

      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)

      // Set up event listeners
      server.on('connection', (info) => {
        console.log(`+ Client connected: ${info.subdomain}`)
      })

      server.on('disconnection', (info) => {
        console.log(`- Client disconnected: ${info.subdomain}`)
      })

      await server.start()

      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║                     SERVER RUNNING                           ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')
      console.log('')
      console.log(`WebSocket URL:   ws://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${port}`)
      console.log(`HTTP URL:        http://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${port}`)
      console.log('')
      console.log('Clients can connect with:')
      console.log(`  localtunnels --port 3000 --server ${options.host === '0.0.0.0' ? 'localhost' : options.host}:${port}`)
      console.log('')
      console.log('Press Ctrl+C to stop the server')
      console.log('')

      // Keep the process running
      await new Promise(() => {})
    }
    catch (error: any) {
      console.error(`Failed to start server: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('deploy:tunnel', 'Deploy the tunnel server to the cloud (AWS EC2 or Hetzner, via ts-cloud)')
  .option('--provider <provider>', 'Cloud provider: aws or hetzner', { default: 'aws' })
  .option('--region <region>', 'AWS region', { default: 'us-east-1' })
  .option('--prefix <prefix>', 'Resource name prefix', { default: 'localtunnel' })
  .option('--domain <domain>', 'Domain for tunnel URLs (AWS: sets up Route53 DNS; Hetzner: prints the records)')
  .option('--instance-type <type>', 'EC2 instance type', { default: 't3.micro' })
  .option('--server-type <type>', 'Hetzner server type', { default: 'cx23' })
  .option('--location <location>', 'Hetzner location', { default: 'fsn1' })
  .option('--key-name <name>', 'EC2 key pair name for SSH access')
  .option('--ssh-cidr <cidr>', 'CIDR allowed to reach SSH, e.g. 203.0.113.4/32 (AWS; default open, or set LT_SSH_CIDR)')
  .option('--enable-ssl', 'Enable SSL (HTTPS/WSS) via Caddy reverse proxy')
  .option('--porkbun-api-key <key>', 'Porkbun API key for DNS-01 TLS challenge (or set PORKBUN_API_KEY env)')
  .option('--porkbun-secret-key <key>', 'Porkbun secret key for DNS-01 TLS challenge (or set PORKBUN_SECRET_KEY env)')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options: DeployOptions) => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              localtunnels cloud deployment                   ║
╚══════════════════════════════════════════════════════════════╝
`)

    const provider = options.provider === 'hetzner' ? 'hetzner' : 'aws'
    console.log(`Provider:        ${provider}`)
    if (provider === 'aws') {
      console.log(`Region:          ${options.region}`)
      console.log(`Instance Type:   ${options.instanceType}`)
    }
    else {
      console.log(`Location:        ${options.location}`)
      console.log(`Server Type:     ${options.serverType}`)
    }
    console.log(`Prefix:          ${options.prefix}`)
    if (options.domain) {
      console.log(`Domain:          ${options.domain}`)
    }
    console.log('')
    console.log(`Deploying tunnel server to ${provider}...`)
    console.log('')

    try {
      let result: any
      if (provider === 'hetzner') {
        const hetznerModule = '../src/cloud/deploy-hetzner'
        const { deployTunnelHetzner } = await import(/* @vite-ignore */ hetznerModule) as any
        result = await deployTunnelHetzner({
          prefix: options.prefix,
          domain: options.domain,
          serverType: options.serverType,
          location: options.location,
          enableSsl: options.enableSsl,
          porkbunApiKey: options.porkbunApiKey,
          porkbunSecretKey: options.porkbunSecretKey,
          verbose: options.verbose,
        })
      }
      else {
        const cloudModule = '../src/cloud/deploy'
        const { deployTunnelInfrastructure } = await import(/* @vite-ignore */ cloudModule) as any
        result = await deployTunnelInfrastructure({
          region: options.region,
          prefix: options.prefix,
          domain: options.domain,
          instanceType: options.instanceType,
          keyName: options.keyName,
          sshCidr: options.sshCidr,
          enableSsl: options.enableSsl,
          porkbunApiKey: options.porkbunApiKey,
          porkbunSecretKey: options.porkbunSecretKey,
          verbose: options.verbose,
        })
      }

      console.log('')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║                   DEPLOYMENT COMPLETE                        ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')
      console.log('')
      console.log('Resources:')
      if (provider === 'aws') {
        console.log(`  Instance ID:     ${result.instanceId}`)
        console.log(`  Public IP:       ${result.publicIp}`)
        console.log(`  Security Group:  ${result.securityGroupId}`)
        console.log(`  Elastic IP:      ${result.allocationId}`)
        console.log(`  Region:          ${result.region}`)
      }
      else {
        console.log(`  Server:          ${result.serverName} (#${result.serverId})`)
        console.log(`  Public IP:       ${result.publicIp}`)
      }
      console.log('')
      console.log('Endpoints:')
      console.log(`  Server URL:      ${result.serverUrl}`)
      console.log(`  WebSocket URL:   ${result.wsUrl}`)
      if (result.domain) {
        console.log(`  Domain:          ${result.domain}`)
      }
      console.log('')
      console.log('Connect with:')
      console.log(`  localtunnels start --port 3000 --server ${result.domain ? `api.${result.domain}` : result.publicIp}`)
      console.log('')
    }
    catch (error: any) {
      console.error(`Deployment failed: ${error.message}`)
      if (options.verbose) {
        console.error(error.stack)
      }
      process.exit(1)
    }
  })

cli
  .command('destroy', 'Destroy tunnel infrastructure (AWS or Hetzner)')
  .option('--provider <provider>', 'Cloud provider: aws or hetzner', { default: 'aws' })
  .option('--region <region>', 'AWS region', { default: 'us-east-1' })
  .option('--prefix <prefix>', 'Resource name prefix', { default: 'localtunnel' })
  .option('--domain <domain>', 'Domain to clean up DNS records for (AWS only)')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options: DestroyOptions) => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              localtunnels cloud destruction                  ║
╚══════════════════════════════════════════════════════════════╝
`)

    console.log(`Region:          ${options.region}`)
    console.log(`Prefix:          ${options.prefix}`)
    if (options.domain) {
      console.log(`Domain:          ${options.domain}`)
    }
    console.log('')
    console.log('Destroying infrastructure...')
    console.log('')

    try {
      if (options.provider === 'hetzner') {
        const hetznerModuleD = '../src/cloud/deploy-hetzner'
        const { destroyTunnelHetzner } = await import(/* @vite-ignore */ hetznerModuleD) as any
        await destroyTunnelHetzner({ prefix: options.prefix })
      }
      else {
        const cloudModuleD = '../src/cloud/deploy'
        const { destroyTunnelInfrastructure } = await import(/* @vite-ignore */ cloudModuleD) as any

        await destroyTunnelInfrastructure({
          region: options.region,
          prefix: options.prefix,
          domain: options.domain,
          verbose: options.verbose,
        })
      }

      console.log('')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║                  DESTRUCTION COMPLETE                        ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')
      console.log('')
    }
    catch (error: any) {
      console.error(`Destruction failed: ${error.message}`)
      if (options.verbose) {
        console.error(error.stack)
      }
      process.exit(1)
    }
  })

interface SiteDeployOptions {
  region?: string
  domain?: string
  sourceDir?: string
  verbose?: boolean
}

cli
  .command('deploy:site', 'Deploy marketing site to S3+CloudFront')
  .option('--region <region>', 'AWS region', { default: 'us-east-1' })
  .option('--domain <domain>', 'Domain for the site', { default: 'localtunnel.dev' })
  .option('--source-dir <dir>', 'Source directory for static files', { default: './dist/.bunpress' })
  .option('--verbose', 'Enable verbose logging')
  .action(async (options: SiteDeployOptions) => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              localtunnels site deployment                    ║
╚══════════════════════════════════════════════════════════════╝
`)

    console.log(`Region:          ${options.region}`)
    console.log(`Domain:          ${options.domain}`)
    console.log(`Source:          ${options.sourceDir}`)
    console.log('')
    console.log('Deploying static site to S3+CloudFront...')
    console.log('')

    try {
      const siteModule = '../src/cloud/deploy-site'
      const { deploySite } = await import(/* @vite-ignore */ siteModule) as any

      const result = await deploySite({
        region: options.region,
        domain: options.domain,
        sourceDir: options.sourceDir,
        verbose: options.verbose,
      })

      console.log('')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║                   DEPLOYMENT COMPLETE                        ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')
      console.log('')
      console.log('Resources:')
      console.log(`  Domain:          ${result.domain}`)
      console.log(`  Bucket:          ${result.bucket}`)
      if (result.distributionId) {
        console.log(`  Distribution:    ${result.distributionId}`)
      }
      if (result.distributionDomain) {
        console.log(`  CloudFront:      ${result.distributionDomain}`)
      }
      if (result.filesUploaded) {
        console.log(`  Files uploaded:  ${result.filesUploaded}`)
      }
      console.log('')
    }
    catch (error: any) {
      console.error(`Site deployment failed: ${error.message}`)
      if (options.verbose) {
        console.error(error.stack)
      }
      process.exit(1)
    }
  })

interface AnalyticsDeployOptions {
  region?: string
  tableName?: string
  serviceName?: string
  verbose?: boolean
}

cli
  .command('deploy:analytics', 'Deploy ts-analytics backend (DynamoDB + Lambda API)')
  .option('--region <region>', 'AWS region', { default: 'us-east-1' })
  .option('--table-name <name>', 'DynamoDB table name', { default: 'ts-analytics' })
  .option('--service-name <name>', 'Service name prefix', { default: 'localtunnel-analytics' })
  .option('--verbose', 'Enable verbose logging')
  .action(async (options: AnalyticsDeployOptions) => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              localtunnels analytics deployment                ║
╚══════════════════════════════════════════════════════════════╝
`)

    console.log(`Region:          ${options.region}`)
    console.log(`Table:           ${options.tableName}`)
    console.log(`Service:         ${options.serviceName}`)
    console.log('')
    console.log('Deploying analytics backend (DynamoDB + Lambda + API Gateway)...')
    console.log('')

    try {
      const analyticsModule = '../src/cloud/deploy-analytics'
      const { deployAnalytics } = await import(/* @vite-ignore */ analyticsModule) as any

      const result = await deployAnalytics({
        region: options.region,
        tableName: options.tableName,
        serviceName: options.serviceName,
        verbose: options.verbose,
      })

      console.log('')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║                   DEPLOYMENT COMPLETE                        ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')
      console.log('')
      console.log('Resources:')
      console.log(`  API Endpoint:    ${result.apiEndpoint}`)
      console.log(`  DynamoDB Table:  ${result.tableName}`)
      console.log(`  Region:          ${result.region}`)
      console.log('')
      console.log('Collect endpoint:')
      console.log(`  ${result.apiEndpoint}/collect`)
      console.log('')
      console.log('Update your bunpress.config.ts:')
      console.log(`  analytics: {`)
      console.log(`    apiEndpoint: '${result.apiEndpoint}',`)
      console.log(`  }`)
      console.log('')
    }
    catch (error: any) {
      console.error(`Analytics deployment failed: ${error.message}`)
      if (options.verbose) {
        console.error(error.stack)
      }
      process.exit(1)
    }
  })

cli
  .command('destroy:analytics', 'Tear down analytics infrastructure')
  .option('--region <region>', 'AWS region', { default: 'us-east-1' })
  .option('--table-name <name>', 'DynamoDB table name', { default: 'ts-analytics' })
  .option('--service-name <name>', 'Service name prefix', { default: 'localtunnel-analytics' })
  .option('--verbose', 'Enable verbose logging')
  .action(async (options: AnalyticsDeployOptions) => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              localtunnels analytics destruction               ║
╚══════════════════════════════════════════════════════════════╝
`)

    console.log(`Region:          ${options.region}`)
    console.log(`Table:           ${options.tableName}`)
    console.log(`Service:         ${options.serviceName}`)
    console.log('')
    console.log('Destroying analytics infrastructure...')
    console.log('')

    try {
      const analyticsModuleD = '../src/cloud/deploy-analytics'
      const { destroyAnalytics } = await import(/* @vite-ignore */ analyticsModuleD) as any

      await destroyAnalytics({
        region: options.region,
        tableName: options.tableName,
        serviceName: options.serviceName,
        verbose: options.verbose,
      })

      console.log('')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║                  DESTRUCTION COMPLETE                        ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')
      console.log('')
    }
    catch (error: any) {
      console.error(`Analytics destruction failed: ${error.message}`)
      if (options.verbose) {
        console.error(error.stack)
      }
      process.exit(1)
    }
  })

cli
  .command('status', 'Check tunnel server status')
  .option('--server <server>', 'Tunnel server URL', { default: DEFAULT_SERVER })
  .action(async (options: { server: string }) => {
    console.log(`Checking server status: ${options.server}`)

    try {
      const serverUrl = options.server.startsWith('http')
        ? options.server
        : `https://${options.server}`

      const response = await fetch(`${serverUrl}/status`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      if (response.ok) {
        const status = await response.json() as {
          version?: string
          connections?: number
          uptime?: string
          activeSubdomains?: string[]
        }
        console.log('')
        console.log('Server Status: ONLINE')
        console.log(`Version: ${status.version || 'unknown'}`)
        if (status.connections !== undefined) {
          console.log(`Active connections: ${status.connections}`)
        }
        if (status.uptime) {
          console.log(`Uptime: ${status.uptime}`)
        }
        if (status.activeSubdomains?.length) {
          console.log(`Active subdomains: ${status.activeSubdomains.join(', ')}`)
        }
      }
      else {
        console.log('')
        console.log(`Server returned status: ${response.status}`)
      }
    }
    catch (error: any) {
      console.log('')
      console.log('Server Status: OFFLINE or UNREACHABLE')
      console.log(`Error: ${error.message}`)
    }
  })

cli
  .command('vpn:keygen', 'Generate (or show) this machine\'s WireGuard-style VPN identity')
  .option('--force', 'Overwrite an existing private key with a fresh one')
  .action(async (options: { force?: boolean }) => {
    try {
      const { loadOrCreateIdentity } = await import('../src/vpn/store')
      const { encodeKey } = await import('../src/vpn/keys')
      const identity = loadOrCreateIdentity(options.force)

      console.log('')
      console.log(identity.created ? '  Generated new VPN identity' : '  Existing VPN identity')
      console.log('')
      console.log(`  Public key:   ${encodeKey(identity.keyPair.publicKey)}`)
      console.log(`  Private key:  ${identity.privateKeyPath} (keep secret, mode 0600)`)
      console.log('')
      console.log('  Share the public key with peers to be added to their allowed list.')
      console.log('')
    }
    catch (error: any) {
      console.error(`\n  Could not generate VPN identity: ${error.message}`)
      if (error.name === 'VpnUnavailableError')
        console.error('  The native libltvpn library is required. Build it with: cd native && zig build')
      process.exit(1)
    }
  })

cli
  .command('vpn:selftest', 'Verify the native VPN core: keygen, handshake, and an encrypted roundtrip')
  .action(async () => {
    try {
      const { generateKeyPair, Handshake } = await import('../src/vpn')
      const a = generateKeyPair()
      const b = generateKeyPair()
      const ini = Handshake.initiator(a.privateKey, b.publicKey)
      const res = Handshake.responder(b.privateKey)
      res.consumeInitiation(ini.createInitiation(1))
      ini.consumeResponse(res.createResponse(2))
      const si = ini.intoSession(1)
      const sr = res.intoSession(2)
      const msg = new TextEncoder().encode('localtunnels vpn selftest')
      const wire = si.encrypt(msg)
      const back = sr.decrypt(wire)
      const ok = new TextDecoder().decode(back.subarray(0, msg.length)) === 'localtunnels vpn selftest'
      let replayRejected = false
      try {
        sr.decrypt(wire)
      }
      catch {
        replayRejected = true
      }
      si.free()
      sr.free()

      console.log('')
      console.log(`  Key generation:      ok`)
      console.log(`  Handshake (IKpsk2):  ok`)
      console.log(`  Transport roundtrip: ${ok ? 'ok' : 'FAILED'}`)
      console.log(`  Replay protection:   ${replayRejected ? 'ok' : 'FAILED'}`)
      console.log('')
      if (!ok || !replayRejected)
        process.exit(1)
      console.log('  VPN core is healthy.')
      console.log('')
    }
    catch (error: any) {
      console.error(`\n  VPN selftest failed: ${error.message}`)
      if (error.name === 'VpnUnavailableError')
        console.error('  The native libltvpn library is required. Build it with: cd native && zig build')
      process.exit(1)
    }
  })

cli
  .command('vpn:demo', 'Run two VPN peers over real UDP sockets and exchange encrypted traffic')
  .option('--count <n>', 'Number of messages to exchange', { default: '100' })
  .action(async (options: { count: string }) => {
    try {
      const { generateKeyPair, VpnPeer } = await import('../src/vpn')
      const count = Number.parseInt(options.count) || 100

      const alice = generateKeyPair()
      const bob = generateKeyPair()
      const a = new VpnPeer({ keyPair: alice, host: '127.0.0.1', keepaliveInterval: 0 })
      const b = new VpnPeer({ keyPair: bob, host: '127.0.0.1', keepaliveInterval: 0 })
      a.addPeer({ publicKey: bob.publicKey })
      b.addPeer({ publicKey: alice.publicKey })
      await a.start()
      await b.start()

      let received = 0
      let echoed = 0
      b.on('message', (data, from) => {
        received++
        b.send(from, data) // echo back
      })
      a.on('message', () => { echoed++ })

      console.log('')
      console.log(`  Alice :${a.port}  <-- encrypted UDP -->  Bob :${b.port}`)

      const t0 = performance.now()
      const link = await a.connect(bob.publicKey, '127.0.0.1', b.port)
      const handshakeMs = performance.now() - t0
      console.log(`  Handshake complete in ${handshakeMs.toFixed(1)}ms (localIndex ${link.localIndex}, peerIndex ${link.peerIndex})`)

      const send0 = performance.now()
      for (let i = 0; i < count; i++)
        a.send(bob.publicKey, new TextEncoder().encode(`packet-${i}`))

      const deadline = Date.now() + 5000
      while (echoed < count && Date.now() < deadline)
        await new Promise(r => setTimeout(r, 5))
      const rttMs = performance.now() - send0

      a.stop()
      b.stop()

      console.log('')
      console.log(`  Bob received:    ${received}/${count}`)
      console.log(`  Alice got echos: ${echoed}/${count}`)
      console.log(`  Round trip:      ${rttMs.toFixed(1)}ms for ${count} messages (${(count / (rttMs / 1000)).toFixed(0)} msg/s)`)
      console.log('')
      if (received !== count || echoed !== count) {
        console.error('  Demo FAILED: message loss detected')
        process.exit(1)
      }
      console.log('  Encrypted datapath working end-to-end.')
      console.log('')
    }
    catch (error: any) {
      console.error(`\n  VPN demo failed: ${error.message}`)
      if (error.name === 'VpnUnavailableError')
        console.error('  The native libltvpn library is required. Build it with: cd native && zig build')
      process.exit(1)
    }
  })

cli
  .command('vpn:tun-check', 'Check whether a TUN device can be opened (needs root)')
  .action(async () => {
    try {
      const { TunDevice, TunError } = await import('../src/vpn')
      try {
        const dev = TunDevice.open()
        console.log('')
        console.log(`  TUN device opened: ${dev.name} (fd ${dev.fd})`)
        console.log('  Layer-3 tunneling is available on this machine.')
        console.log('')
        dev.close()
      }
      catch (err: any) {
        if (err instanceof TunError) {
          console.log('')
          console.log(`  Could not open a TUN device: ${err.message}`)
          if (err.code === 1 || err.code === 13)
            console.log('  Re-run with sudo to use `lt vpn up`.')
          console.log('')
          process.exit(1)
        }
        throw err
      }
    }
    catch (error: any) {
      console.error(`\n  tun-check failed: ${error.message}`)
      if (error.name === 'VpnUnavailableError')
        console.error('  The native libltvpn library is required. Build it with: cd native && zig build')
      process.exit(1)
    }
  })

interface VpnUpOptions {
  listen: string
  address: string
  peer?: string
  allowedIps?: string
  endpoint?: string
  psk?: string
  exitNode?: boolean
  wan?: string
  mtu: string
  coordinator?: string
  authKey?: string
  useExit?: string
  fullTunnel?: boolean
  dns?: string
  killSwitch?: boolean
  allowLan?: boolean
}

async function detectWan(): Promise<string> {
  const proc = Bun.spawn(['ip', 'route', 'show', 'default'], { stdout: 'pipe', stderr: 'ignore' })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  const m = out.match(/\bdev\s+(\S+)/)
  return m?.[1] ?? 'eth0'
}

async function runCmd(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`\`${cmd.join(' ')}\` failed (${code}): ${err.trim()}`)
  }
}

cli
  .command('vpn:up', 'Bring up a layer-3 VPN interface (client or server) on the localtunnels datapath (needs root)')
  .option('--listen <port>', 'Local UDP port', { default: '51820' })
  .option('--address <cidr>', 'This node\'s tunnel address, e.g. 10.8.0.1/24', { default: '100.100.0.1/24' })
  .option('--peer <pubkey>', 'Base64 public key of a peer to authorize')
  .option('--allowed-ips <cidrs>', 'Comma-separated CIDRs routed to --peer (client default 0.0.0.0/0)')
  .option('--endpoint <host:port>', 'Dial this peer endpoint (client mode); omit to listen (server mode)')
  .option('--psk <key>', 'Optional base64 preshared key')
  .option('--exit-node', 'Enable IP forwarding + NAT so peer traffic egresses via this host')
  .option('--wan <iface>', 'WAN interface for exit-node NAT (auto-detected if omitted)')
  .option('--mtu <mtu>', 'Tunnel MTU', { default: '1420' })
  .option('--coordinator <url>', 'Join through a coordinator: address and peers come from discovery')
  .option('--auth-key <key>', 'Shared secret for the coordinator, when it requires one')
  .option('--use-exit <key>', 'Route all non-tunnel traffic through an exit node: a public key, or "auto"')
  .option('--full-tunnel', 'Send this machine\'s traffic and DNS through the exit node (needs --use-exit)')
  .option('--dns <servers>', 'Comma-separated resolvers to use while connected', { default: '1.1.1.1,1.0.0.1' })
  .option('--kill-switch', 'Block traffic that would leave outside the tunnel, including if it drops')
  .option('--allow-lan', 'With --kill-switch, still allow the local network')
  .action(async (options: VpnUpOptions) => {
    try {
      const { TunError, VpnInterface, decodeKey, enableExitNode } = await import('../src/vpn')
      const { captureTraffic, releaseTraffic } = await import('../src/vpn/capture')
      const { loadOrCreateIdentity } = await import('../src/vpn/store')
      const { encodeKey } = await import('../src/vpn/keys')

      const identity = loadOrCreateIdentity()
      const listenPort = Number.parseInt(options.listen) || 51820
      const mtu = Number.parseInt(options.mtu) || 1420
      const viaCoordinator = !!options.coordinator
      const isClient = !!options.endpoint

      // Static peers, when not joining through a coordinator. With a
      // coordinator the directory supplies these, so the flags are ignored.
      const peers = []
      if (!viaCoordinator && options.peer) {
        const allowed = (options.allowedIps ?? (isClient ? '0.0.0.0/0' : '')).split(',').map(s => s.trim()).filter(Boolean)
        if (allowed.length === 0)
          throw new Error('server mode requires --allowed-ips (the peer\'s tunnel IP, e.g. 10.8.0.2/32)')
        let endpoint: { host: string, port: number } | undefined
        if (options.endpoint) {
          const idx = options.endpoint.lastIndexOf(':')
          endpoint = { host: options.endpoint.slice(0, idx), port: Number.parseInt(options.endpoint.slice(idx + 1)) }
        }
        peers.push({ publicKey: options.peer, allowedIps: allowed, endpoint })
      }
      if (viaCoordinator && options.peer)
        console.log('  Note: --peer is ignored when --coordinator is set; peers come from the directory.')
      if (!viaCoordinator && options.useExit)
        console.log('  Note: --use-exit needs --coordinator; in static mode set --allowed-ips 0.0.0.0/0 instead.')
      // Without an exit there is nowhere for captured traffic to go, and
      // capturing it anyway is how you take a machine off the network.
      if (options.fullTunnel && !options.useExit)
        throw new Error('--full-tunnel needs --use-exit: capturing the default route with no exit node to carry it would take this machine off the network')

      const vpn = new VpnInterface({
        keyPair: identity.keyPair,
        listenPort,
        mtu,
        presharedKey: options.psk ? decodeKey(options.psk) : undefined,
        coordinatorUrl: options.coordinator,
        authKey: options.authKey,
        // With a coordinator, --exit-node also tells the network this node is
        // one. The NAT setup below is what makes the claim true.
        advertiseExitNode: viaCoordinator && options.exitNode,
        useExit: viaCoordinator ? options.useExit : undefined,
        address: viaCoordinator ? undefined : options.address,
        peers,
      })

      vpn.on('peerAdded', p => console.log(`  + peer ${p.publicKey.slice(0, 16)}\u2026 \u2192 ${p.allowedIps.join(', ')}`))
      vpn.on('peerRemoved', p => console.log(`  - peer ${p.publicKey.slice(0, 16)}\u2026 left`))
      vpn.on('link', l => console.log(`  \u2713 link up to ${l.peerPublicKey.slice(0, 16)}\u2026`))
      vpn.on('exitChanged', e => console.log(e.publicKey
        ? `  \u2192 exit node: ${e.publicKey.slice(0, 16)}\u2026 (all non-tunnel traffic)`
        : '  \u2192 no exit node; non-tunnel traffic has no route and is dropped'))

      /*
       * Full-tunnel mode is applied when the exit becomes known rather than
       * at bring-up, because in coordinator mode it is not known at bring-up:
       * the directory supplies the exit and its endpoint afterwards, and the
       * endpoint is exactly what has to be pinned before the default route is
       * captured.
       */
      let captured = false
      if (options.fullTunnel) {
        vpn.on('exitChanged', (e) => {
          void (async () => {
            if (!e.publicKey || !e.endpoint || captured)
              return
            try {
              await captureTraffic({
                tun: vpn.name ?? '',
                endpointIp: e.endpoint.host,
                endpointPort: e.endpoint.port,
                dnsServers: (options.dns ?? '1.1.1.1,1.0.0.1').split(',').map(d => d.trim()).filter(Boolean),
                killSwitch: options.killSwitch,
                allowLan: options.allowLan,
              })
              captured = true
              console.log(`  \u2192 full tunnel: default route and DNS via ${e.endpoint.host}`)
              // Said out loud, because it is a change to the machine that
              // outlives nothing else on this list being visible: v6-only
              // sites stop resolving, and that should not be a mystery.
              if (!e.endpoint.host.includes(':'))
                console.log('  \u2192 IPv6 turned off while connected (the tunnel carries IPv4 only)')
              if (options.killSwitch)
                console.log('  \u2192 kill switch armed: traffic outside the tunnel is blocked')
            }
            catch (err: any) {
              console.error(`  ! full tunnel failed, traffic is NOT being captured: ${err.message}`)
            }
          })()
        })
      }
      vpn.on('error', () => { /* transient handshake races and drops are expected */ })

      let info
      try {
        info = await vpn.up()
      }
      catch (err: any) {
        if (err instanceof TunError) {
          console.error(`\n  ${err.message}`)
          console.error('  `lt vpn:up` needs root to create a network interface. Try: sudo lt vpn:up ...\n')
          process.exit(1)
        }
        throw err
      }

      if (options.exitNode) {
        const wan = options.wan ?? await detectWan()
        await enableExitNode(info.name, wan)
        console.log(`  Exit node: forwarding + NAT via ${wan}`)
      }

      console.log('')
      console.log(`  Interface:   ${info.name} (${info.address}/${info.prefix}, mtu ${mtu})`)
      console.log(`  Public key:  ${encodeKey(identity.keyPair.publicKey)}`)
      console.log(`  Listening:   udp/${vpn.datapath?.port ?? listenPort}`)
      if (viaCoordinator)
        console.log(`  Mode:        coordinator (${options.coordinator}${info.network ? `, network ${info.network}` : ''})`)
      else
        console.log(`  Mode:        ${isClient ? 'client' : 'server (listening)'}`)
      if (viaCoordinator && options.exitNode)
        console.log(`  Advertising: exit node`)
      if (options.useExit && viaCoordinator)
        console.log(`  Exit:        ${options.useExit === 'auto' ? 'auto (lowest-sorted advertised peer)' : options.useExit}`)
      console.log('')
      console.log('  Press Ctrl+C to bring the tunnel down')
      console.log('')

      const shutdown = () => {
        void (async () => {
          console.log('\n  Bringing tunnel down...')
          // Routes and DNS come back first: once the interface is gone the
          // rules that point at it are the only thing standing between this
          // machine and no network at all.
          if (options.fullTunnel)
            await releaseTraffic()
          vpn.down()
          process.exit(0)
        })()
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)

      await new Promise(() => {})
    }
    catch (error: any) {
      console.error(`\n  vpn up failed: ${error.message}`)
      if (error.name === 'VpnUnavailableError')
        console.error('  The native libltvpn library is required. Build it with: cd native && zig build')
      process.exit(1)
    }
  })

cli
  .command('vpn:down', 'Undo full-tunnel mode: restore routes, DNS and firewall rules (needs root)')
  .action(async () => {
    /*
     * The counterpart to the restore file `captureTraffic` writes.
     *
     * A kill switch is meant to outlive the process that armed it, which
     * means a crashed `vpn:up` leaves a machine whose traffic is blocked and
     * whose routes point at an interface that no longer exists. Ctrl+C
     * handles the ordinary case; this handles the one where nothing was
     * around to handle it, and it is the only way back without knowing which
     * commands to reverse by hand.
     *
     * Safe to run when there is nothing to undo: every step tolerates having
     * already been undone.
     */
    try {
      const { readRestore, releaseTraffic } = await import('../src/vpn/capture')

      const pending = readRestore()
      if (pending.length === 0) {
        console.log('\n  Nothing to undo: no full-tunnel state is recorded.\n')
        return
      }

      console.log(`\n  Restoring ${pending.length} change(s)...`)
      const results = await releaseTraffic()
      const failed = results.filter(result => !result.ok)

      for (const result of failed)
        console.error(`  ! \`${result.command.join(' ')}\`: ${result.stderr || 'failed'}`)

      if (failed.length === 0) {
        console.log('  Routes, DNS and firewall rules are back to how they were.\n')
        return
      }

      // The record is cleared either way, so a command that can never succeed
      // does not make this unrunnable forever. Say what is left.
      console.error(`\n  ${failed.length} step(s) could not be undone. If this machine still has no network,`)
      console.error('  the rules above are what to remove by hand.\n')
      process.exit(1)
    }
    catch (error: any) {
      console.error(`\n  vpn down failed: ${error.message}`)
      console.error('  Restoring routes and firewall rules needs root. Try: sudo lt vpn:down\n')
      process.exit(1)
    }
  })

cli
  .command('vpn:coordinator', 'Run the VPN coordination server (peer discovery + IP assignment)')
  .option('-p, --port <port>', 'Port to listen on', { default: '51821' })
  .option('--host <host>', 'Host to bind to', { default: '0.0.0.0' })
  .option('--network <cidr>', 'Tunnel network to assign IPs from', { default: '100.100.0.0/16' })
  .option('--auth-key <key>', 'Shared secret nodes must present to join (generated if omitted)')
  .option('--insecure-no-auth', 'Accept any node that can reach the port — localhost/testing only')
  .action(async (options: { port: string, host: string, network: string, authKey?: string, insecureNoAuth?: boolean }) => {
    try {
      const { VpnCoordinator } = await import('../src/vpn')
      const port = Number.parseInt(options.port) || 51821

      // Secure by default: without a key the coordinator hands a tunnel IP and
      // the whole peer directory to anyone who can reach the port, so one is
      // minted here unless the operator explicitly opts out.
      const generated = !options.authKey && !options.insecureNoAuth
      const authKey = options.insecureNoAuth
        ? undefined
        : options.authKey || randomBytes(32).toString('base64url')

      const coordinator = new VpnCoordinator({ port, host: options.host, network: options.network, authKey })
      coordinator.start()

      console.log('')
      console.log('  localtunnels VPN coordinator')
      console.log('')
      console.log(`  Listening:  ws://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${coordinator.port}`)
      console.log(`  Network:    ${options.network}`)
      if (authKey) {
        console.log(`  Auth key:   ${authKey}${generated ? '  (generated)' : ''}`)
        if (generated)
          console.log('              Pass --auth-key to reuse a key across restarts.')
      }
      else {
        console.log('  Auth:       DISABLED — any node that reaches this port can join')
      }
      console.log('')
      console.log('  Nodes join through the VpnNode API:')
      console.log('    new VpnNode({')
      console.log('      keyPair,')
      console.log(`      coordinatorUrl: 'ws://<this-host>:${coordinator.port}',`)
      if (authKey)
        console.log('      authKey: \'<the key above>\',')
      console.log('    })')
      console.log('')
      console.log('  `lt vpn:mesh-demo` runs that flow end to end.')
      console.log('')
      console.log('  Press Ctrl+C to stop')
      console.log('')

      const shutdown = () => {
        console.log('\n  Stopping coordinator...')
        coordinator.stop()
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      await new Promise(() => {})
    }
    catch (error: any) {
      console.error(`\n  Coordinator failed: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('vpn:mesh-demo', 'Run a coordinator and two auto-discovering nodes end-to-end')
  .option('--count <n>', 'Messages to exchange each way', { default: '100' })
  .action(async (options: { count: string }) => {
    try {
      const { generateKeyPair, VpnCoordinator, VpnNode } = await import('../src/vpn')
      const count = Number.parseInt(options.count) || 100

      // Run the demo the way a real deployment should: an auth key the nodes
      // have to present, so the happy path exercised here is the closed one.
      const authKey = randomBytes(32).toString('base64url')
      const coordinator = new VpnCoordinator({ host: '127.0.0.1', authKey })
      coordinator.start()
      const url = `ws://127.0.0.1:${coordinator.port}`

      const alice = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url, authKey })
      const bob = new VpnNode({ keyPair: generateKeyPair(), coordinatorUrl: url, authKey })

      let atBob = 0
      let atAlice = 0
      bob.on('message', (data, from) => {
        atBob++
        bob.send(from, data) // echo
      })
      alice.on('message', () => { atAlice++ })
      alice.on('error', () => {})
      bob.on('error', () => {})

      console.log('')
      console.log(`  Coordinator: ${url}`)
      const aInfo = await alice.start()
      const bInfo = await bob.start()
      console.log(`  Alice joined as ${aInfo.assignedIp}, Bob as ${bInfo.assignedIp}`)

      // Wait for the encrypted link to form.
      const linkDeadline = Date.now() + 5000
      const linked = new Promise<void>((resolve) => {
        alice.on('link', () => resolve())
        bob.on('link', () => resolve())
      })
      await Promise.race([linked, new Promise(r => setTimeout(r, 5000))])
      while (Date.now() < linkDeadline && atAlice === 0) {
        await new Promise(r => setTimeout(r, 20))
        break
      }
      await new Promise(r => setTimeout(r, 200))

      const t0 = performance.now()
      for (let i = 0; i < count; i++)
        alice.send(bob.publicKeyB64, new TextEncoder().encode(`packet-${i}`))

      const deadline = Date.now() + 5000
      while (atAlice < count && Date.now() < deadline)
        await new Promise(r => setTimeout(r, 5))
      const rtt = performance.now() - t0

      alice.stop()
      bob.stop()
      coordinator.stop()

      console.log('')
      console.log(`  Bob received:    ${atBob}/${count}`)
      console.log(`  Alice got echos: ${atAlice}/${count}`)
      console.log(`  Round trip:      ${rtt.toFixed(1)}ms for ${count} messages`)
      console.log('')
      if (atBob < count || atAlice < count) {
        console.error('  Mesh demo FAILED: message loss')
        process.exit(1)
      }
      console.log('  Auto-discovered encrypted mesh working end-to-end.')
      console.log('')
    }
    catch (error: any) {
      console.error(`\n  Mesh demo failed: ${error.message}`)
      if (error.name === 'VpnUnavailableError')
        console.error('  The native libltvpn library is required. Build it with: cd native && zig build')
      process.exit(1)
    }
  })

cli
  .command('info', 'Show information about localtunnels')
  .action(() => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                       localtunnels                           ║
║              Zero-config local tunnel solution               ║
╚══════════════════════════════════════════════════════════════╝

localtunnels exposes your local server to the internet through
a secure tunnel connection.

USAGE:
  localtunnels [--port <port>] [options]
  localtunnels start --port 3000
  localtunnels server --port 8080

COMMANDS:
  start              Start a tunnel client (default)
  server             Start a self-hosted tunnel server
  vpn:keygen         Generate this machine's WireGuard-style VPN identity
  vpn:selftest       Verify the native VPN core (handshake + encryption)
  vpn:demo           Run two peers over real UDP and exchange encrypted traffic
  vpn:tun-check      Check whether a TUN device can be opened (needs root)
  vpn:up             Bring up a layer-3 VPN interface bridged to a peer (root)
  vpn:coordinator    Run the peer-discovery coordination server
  vpn:mesh-demo      Coordinator + two auto-discovering nodes, end-to-end
  deploy:tunnel      Deploy tunnel server to the cloud (--provider aws|hetzner)
  deploy:site        Deploy marketing site to S3+CloudFront
  deploy:analytics   Deploy analytics backend (DynamoDB + Lambda)
  destroy            Remove tunnel infrastructure (--provider aws|hetzner)
  destroy:analytics  Tear down analytics infrastructure
  status             Check tunnel server status
  info               Show this information

EXAMPLES:
  # Expose local port 3000 (default)
  localtunnels

  # Expose local port 8080
  localtunnels --port 8080

  # Request a specific subdomain
  localtunnels --port 3000 --subdomain myapp

  # Use a custom tunnel server
  localtunnels --port 3000 --server mytunnel.example.com

  # Start your own tunnel server
  localtunnels server --port 8080 --domain mytunnel.example.com

  # Deploy tunnel server to AWS EC2 or Hetzner Cloud
  localtunnels deploy:tunnel --region us-east-1 --domain localtunnel.dev
  localtunnels deploy:tunnel --provider hetzner --domain localtunnel.dev

  # Deploy marketing site to S3+CloudFront
  localtunnels deploy:site --domain localtunnel.dev

  # Deploy with SSH access
  localtunnels deploy:tunnel --domain localtunnel.dev --key-name my-keypair

  # Destroy deployed infrastructure
  localtunnels destroy --domain localtunnel.dev

ENVIRONMENT VARIABLES:
  TUNNEL_SERVER     - Default tunnel server URL
  TUNNEL_SUBDOMAIN  - Default subdomain to request

DEFAULT SERVER:
  ${DEFAULT_SERVER}

For more information, visit:
  https://github.com/stacksjs/localtunnels
`)
  })

cli.command('version', 'Show the version').action(() => {
  console.log(`localtunnels v${version}`)
})

cli.version(version)
cli.help()
cli.parse()

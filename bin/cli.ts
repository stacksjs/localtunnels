#!/usr/bin/env bun
import { CAC } from '@stacksjs/cli'
import { version } from '../package.json'
import { TunnelClient, TunnelServer } from '../src/tunnel'
import { generateId, isValidPort, isValidSubdomain } from '../src/utils'

const cli = new CAC('localtunnels')

interface TunnelOptions {
  port: string
  subdomain?: string
  host?: string
  server?: string
  verbose?: boolean
  secure?: boolean
}

interface ServerOptions {
  port: string
  host?: string
  verbose?: boolean
  domain?: string
}

// Default tunnel server
const DEFAULT_SERVER = 'localtunnel.dev'
const DEFAULT_PORT = 3000

cli
  .command('start', 'Start a local tunnel to expose your local server')
  .alias('')
  .option('-p, --port <port>', 'Local port to expose', { default: '3000' })
  .option('-s, --subdomain <subdomain>', 'Request a specific subdomain')
  .option('-h, --host <host>', 'Local hostname to forward to', { default: 'localhost' })
  .option('--server <server>', 'Tunnel server URL', { default: DEFAULT_SERVER })
  .option('--verbose', 'Enable verbose logging')
  .option('--secure', 'Use secure WebSocket (wss://)')
  .action(async (options: TunnelOptions) => {
    const localPort = Number.parseInt(options.port)

    if (!isValidPort(localPort)) {
      console.error(`Invalid port: ${options.port}`)
      process.exit(1)
    }

    const subdomain = options.subdomain || generateId(8)

    if (options.subdomain && !isValidSubdomain(options.subdomain)) {
      console.error(`Invalid subdomain: ${options.subdomain}`)
      console.error('Subdomains must be lowercase alphanumeric with optional hyphens')
      process.exit(1)
    }

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                       localtunnels                           ║
╚══════════════════════════════════════════════════════════════╝
`)

    console.log(`Local server:    http://${options.host}:${localPort}`)
    console.log(`Tunnel server:   ${options.server}`)
    console.log(`Subdomain:       ${subdomain}`)
    console.log('')
    console.log('Connecting...')

    try {
      const serverHost = options.server?.replace(/^(wss?|https?):\/\//, '') || DEFAULT_SERVER
      const secure = options.secure || options.server?.startsWith('wss://') || options.server?.startsWith('https://') || serverHost === DEFAULT_SERVER

      const client = new TunnelClient({
        host: serverHost,
        port: secure ? 443 : 80,
        secure,
        verbose: options.verbose,
        localPort,
        localHost: options.host || 'localhost',
        subdomain,
      })

      // Handle process signals for graceful shutdown
      const cleanup = () => {
        console.log('\nShutting down tunnel...')
        client.disconnect()
        process.exit(0)
      }

      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)

      await client.connect()

      const tunnelUrl = secure
        ? `https://${subdomain}.${serverHost}`
        : `http://${subdomain}.${serverHost}`

      console.log('')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║                      TUNNEL ACTIVE                           ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')
      console.log('')
      console.log(`Your public URL:  ${tunnelUrl}`)
      console.log('')
      console.log(`Forwarding:       ${tunnelUrl}`)
      console.log(`                  ↓`)
      console.log(`                  http://${options.host}:${localPort}`)
      console.log('')
      console.log('Press Ctrl+C to stop the tunnel')
      console.log('')

      if (options.verbose) {
        console.log('Verbose mode enabled - showing all requests')
        console.log('─'.repeat(60))
      }

      // Keep the process running
      await new Promise(() => {})
    }
    catch (error: any) {
      console.error(`Failed to connect: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('server', 'Start a tunnel server (self-hosted)')
  .option('-p, --port <port>', 'Port to listen on', { default: '3000' })
  .option('-h, --host <host>', 'Host to bind to', { default: '0.0.0.0' })
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
        const status = await response.json()
        console.log('')
        console.log('Server Status: ONLINE')
        console.log(`Version: ${status.version || 'unknown'}`)
        if (status.connections !== undefined) {
          console.log(`Active connections: ${status.connections}`)
        }
        if (status.uptime) {
          console.log(`Uptime: ${status.uptime}`)
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

/* eslint-disable no-console */
import process from 'node:process'
import { TunnelClient, TunnelServer } from './src/tunnel'

async function startTestServer() {
  console.log('Starting tunnel test...\n')

  // Create a simple Bun server to test with
  const localServer = Bun.serve({
    port: 8000,
    fetch(req) {
      console.log(`[Local Server] Received request: ${req.method} ${req.url}`)
      return new Response('Hello from local server!')
    },
  })

  console.log(`✅ Local server running on port ${localServer.port}`)

  // Start tunnel server
  const server = new TunnelServer({
    port: 3000,
    verbose: true,
  })

  await server.start()
  console.log('✅ Tunnel server running on port 3000')

  // Start tunnel client with specific subdomain
  const client = new TunnelClient({
    port: 3000,
    localPort: 8000,
    subdomain: 'test',
    verbose: true,
    host: 'localhost',
  })

  try {
    await client.connect()
    console.log('✅ Tunnel client connected successfully')
    console.log('\nTunnel is ready for testing!')
    console.log('You can now:')
    console.log('1. Visit http://test.localhost:3000')
    console.log('2. Or use curl: curl -H "Host: test.localhost" http://localhost:3000')
    console.log('\nPress Ctrl+C to stop the server')

    // Keep the process running
    await new Promise(() => {})
  }
  catch (err) {
    console.error('❌ Failed to establish tunnel:', err)
    localServer.stop()
    server.stop()
    process.exit(1)
  }

  // Handle cleanup
  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    client.disconnect()
    server.stop()
    localServer.stop()
    process.exit()
  })
}

startTestServer().catch((error) => {
  console.error('Error in test:', error)
  process.exit(1)
})

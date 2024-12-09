import { TunnelClient, TunnelServer } from './src/tunnel'

async function startTestServer() {
  // Create a simple Bun server to test with
  const localServer = Bun.serve({
    port: 8000,
    fetch(req) {
      return new Response('Hello from local server!')
    },
  })

  console.log(`Local server running on port ${localServer.port}`)

  // Start tunnel server
  const server = new TunnelServer({
    port: 3000,
    verbose: true,
  })

  await server.start()
  console.log('Tunnel server running on port 3000')

  // Start tunnel client
  const client = new TunnelClient({
    port: 3000,
    localPort: 8000,
    subdomain: 'test',
    verbose: true,
  })

  await client.connect()
  console.log('Tunnel client connected')

  // Handle cleanup
  process.on('SIGINT', () => {
    client.disconnect()
    localServer.stop()
    process.exit()
  })
}

startTestServer().catch(console.error)

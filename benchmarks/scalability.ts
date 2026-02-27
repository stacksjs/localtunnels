/**
 * Scalability benchmarks for localtunnels.
 *
 * Tests how the server performs under increasing connection counts
 * and concurrent request load. Measures connection management
 * overhead, socket lookup speed, and cleanup efficiency.
 *
 * Run: bun benchmarks/scalability.ts
 */
import { bench, boxplot, group, run, summary } from 'mitata'
import { TunnelClient, TunnelServer } from '../src/tunnel'

const BASE_PORT = 19400

// ─── Connection Pool Management ──────────────────────────────────────────────
// Measures how quickly the server can accept and register N clients.

summary(() => {
  group('Connection Pool — Register N Clients', () => {
    for (const count of [1, 5, 10, 25]) {
      bench(`${count} clients`, async () => {
        const port = BASE_PORT + Math.floor(Math.random() * 500)
        const server = new TunnelServer({ port, verbose: false })
        await server.start()

        const clients: TunnelClient[] = []
        const promises: Promise<void>[] = []

        for (let i = 0; i < count; i++) {
          const client = new TunnelClient({
            host: 'localhost',
            port,
            subdomain: `scale-${i}-${Math.random().toString(36).substring(2, 8)}`,
            verbose: false,
            manageHosts: false,
            timeout: 10000,
          })
          clients.push(client)
          promises.push(client.connect())
        }

        await Promise.all(promises)

        // Cleanup
        await Promise.all(clients.map(c => c.disconnect().catch(() => {})))
        server.stop()
      })
    }
  })
})

// ─── Requests Under Connection Load ──────────────────────────────────────────
// How does request latency change as more tunnels are registered?

async function benchWithNClients(clientCount: number) {
  const port = BASE_PORT + 500 + clientCount
  const localPort = port + 100

  // Local server
  const localServer = Bun.serve({
    port: localPort,
    fetch() {
      return new Response('OK')
    },
  })

  const server = new TunnelServer({ port, verbose: false })
  await server.start()

  // Connect N clients (all pointing to local server)
  const clients: TunnelClient[] = []
  const subdomains: string[] = []

  for (let i = 0; i < clientCount; i++) {
    const subdomain = `load-${i}-${Math.random().toString(36).substring(2, 8)}`
    subdomains.push(subdomain)
    const client = new TunnelClient({
      host: 'localhost',
      port,
      localPort,
      localHost: 'localhost',
      subdomain,
      verbose: false,
      manageHosts: false,
      timeout: 10000,
    })
    await client.connect()
    clients.push(client)
  }

  // Use the first client's tunnel for the actual request benchmark
  const tunnelUrl = `http://${subdomains[0]}.localhost:${port}`

  // Verify
  const check = await fetch(tunnelUrl)
  if (check.status !== 200) {
    throw new Error(`Health check failed for ${clientCount}-client setup: ${check.status}`)
  }

  return { server, clients, localServer, tunnelUrl }
}

// Pre-build setups for different connection counts
const setups: Record<number, Awaited<ReturnType<typeof benchWithNClients>>> = {}

for (const count of [1, 10, 50]) {
  try {
    setups[count] = await benchWithNClients(count)
    console.log(`Setup ready: ${count} concurrent tunnels`)
  }
  catch (err) {
    console.error(`Failed to setup ${count} clients:`, err)
  }
}

if (Object.keys(setups).length > 0) {
  boxplot(() => {
    group('Request Latency Under Connection Load', () => {
      for (const [count, setup] of Object.entries(setups)) {
        bench(`${count} active tunnels`, async () => {
          await fetch(setup.tunnelUrl)
        })
      }
    })
  })

  // ─── Concurrent requests under load ──────────────────────────────────────

  summary(() => {
    group('10 Concurrent Requests Under Load', () => {
      for (const [count, setup] of Object.entries(setups)) {
        bench(`${count} active tunnels`, async () => {
          await Promise.all(
            Array.from({ length: 10 }, () => fetch(setup.tunnelUrl).then(r => r.text())),
          )
        })
      }
    })
  })
}

// ─── Server Stats Under Load ─────────────────────────────────────────────────

if (setups[50]) {
  summary(() => {
    group('Server Stats — 50 Active Tunnels', () => {
      bench('getStats()', () => {
        setups[50].server.getStats()
      })
      bench('getStats(includeSubdomains)', () => {
        setups[50].server.getStats(true)
      })
    })
  })
}

// ─── WebSocket Message Processing ────────────────────────────────────────────
// Measures JSON parse/serialize for WebSocket protocol messages.

const messages = {
  ready: JSON.stringify({ type: 'ready', subdomain: 'bench-test' }),
  ping: '{"type":"ping"}',
  pong: '{"type":"pong"}',
  registered: JSON.stringify({ type: 'registered', subdomain: 'bench-test', url: 'http://bench-test.localhost:3000' }),
  request: JSON.stringify({
    type: 'request',
    id: 12345,
    method: 'GET',
    path: '/api/users',
    headers: { accept: 'application/json' },
  }),
  response: JSON.stringify({
    type: 'response',
    id: 12345,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i, name: `User ${i}` }))),
  }),
}

summary(() => {
  group('WebSocket Protocol — Parse', () => {
    bench('parse ready', () => JSON.parse(messages.ready))
    bench('parse ping', () => JSON.parse(messages.ping))
    bench('parse request', () => JSON.parse(messages.request))
    bench('parse response', () => JSON.parse(messages.response))
  })
})

summary(() => {
  group('WebSocket Protocol — Serialize', () => {
    const ready = JSON.parse(messages.ready)
    const ping = JSON.parse(messages.ping)
    const request = JSON.parse(messages.request)
    const response = JSON.parse(messages.response)

    bench('serialize ready', () => JSON.stringify(ready))
    bench('serialize ping', () => JSON.stringify(ping))
    bench('serialize request', () => JSON.stringify(request))
    bench('serialize response', () => JSON.stringify(response))
  })
})

// ─── Map Operations (connection tracking) ────────────────────────────────────
// Simulates the internal Map operations the server uses for socket tracking.

const socketMap = new Map<string, Set<number>>()
for (let i = 0; i < 100; i++) {
  const set = new Set<number>()
  for (let j = 0; j < 3; j++) set.add(j)
  socketMap.set(`subdomain-${i}`, set)
}

summary(() => {
  group('Connection Map Operations', () => {
    bench('lookup existing (100 subdomains)', () => {
      socketMap.get('subdomain-50')
    })

    bench('lookup missing', () => {
      socketMap.get('nonexistent')
    })

    bench('has check', () => {
      socketMap.has('subdomain-50')
    })

    bench('iterate all keys', () => {
      Array.from(socketMap.keys())
    })

    bench('count all connections', () => {
      let total = 0
      for (const set of socketMap.values()) total += set.size
      return total
    })
  })
})

// ─── Run and cleanup ─────────────────────────────────────────────────────────

await run()

for (const setup of Object.values(setups)) {
  await Promise.all(setup.clients.map(c => c.disconnect().catch(() => {})))
  setup.server.stop()
  setup.localServer.stop()
}

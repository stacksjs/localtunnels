/**
 * Connection lifecycle benchmarks for localtunnels.
 *
 * Measures server startup, WebSocket connection establishment, subdomain
 * registration, and teardown — the critical path for tunnel setup time.
 *
 * Run: bun benchmarks/connection.ts
 */
import { bench, boxplot, group, run, summary } from 'mitata'
import { TunnelClient, TunnelServer } from '../src/tunnel'

const SERVER_PORT = 19100

// ─── Server Startup / Shutdown ───────────────────────────────────────────────

boxplot(() => {
  group('Server Lifecycle', () => {
    bench('start + stop', async () => {
      const server = new TunnelServer({ port: SERVER_PORT + Math.floor(Math.random() * 1000), verbose: false })
      await server.start()
      server.stop()
    })
  })
})

// ─── Full Connection Lifecycle ───────────────────────────────────────────────
// Measures the time from client creation to fully registered tunnel,
// then clean disconnection.

let sharedServer: TunnelServer | null = null
let connId = 0

boxplot(() => {
  group('Client Connection Lifecycle', () => {
    bench('connect + register + disconnect', async () => {
      // Ensure a shared server is running
      if (!sharedServer) {
        sharedServer = new TunnelServer({ port: SERVER_PORT, verbose: false })
        await sharedServer.start()
      }

      const subdomain = `bench-${connId++}-${Math.random().toString(36).substring(2, 8)}`
      const client = new TunnelClient({
        host: 'localhost',
        port: SERVER_PORT,
        subdomain,
        verbose: false,
        manageHosts: false,
        timeout: 5000,
      })

      await client.connect()
      await client.disconnect()
    })
  })
})

// ─── Connection Only (no disconnect) ─────────────────────────────────────────
// Measures just the connection + registration phase.

const clients: TunnelClient[] = []

boxplot(() => {
  group('Client Connect Time', () => {
    bench('connect + register only', async () => {
      if (!sharedServer) {
        sharedServer = new TunnelServer({ port: SERVER_PORT, verbose: false })
        await sharedServer.start()
      }

      const subdomain = `bench-${connId++}-${Math.random().toString(36).substring(2, 8)}`
      const client = new TunnelClient({
        host: 'localhost',
        port: SERVER_PORT,
        subdomain,
        verbose: false,
        manageHosts: false,
        timeout: 5000,
      })

      await client.connect()
      clients.push(client) // disconnect later
    })
  })
})

// ─── Rapid Sequential Connections ────────────────────────────────────────────
// Simulates multiple clients connecting in rapid succession.

summary(() => {
  group('Sequential Multi-Client Connect', () => {
    bench('5 clients sequentially', async () => {
      if (!sharedServer) {
        sharedServer = new TunnelServer({ port: SERVER_PORT, verbose: false })
        await sharedServer.start()
      }

      const batch: TunnelClient[] = []
      for (let i = 0; i < 5; i++) {
        const subdomain = `seq-${connId++}-${Math.random().toString(36).substring(2, 8)}`
        const client = new TunnelClient({
          host: 'localhost',
          port: SERVER_PORT,
          subdomain,
          verbose: false,
          manageHosts: false,
          timeout: 5000,
        })
        await client.connect()
        batch.push(client)
      }

      // Cleanup
      await Promise.all(batch.map(c => c.disconnect()))
    })

    bench('5 clients concurrent', async () => {
      if (!sharedServer) {
        sharedServer = new TunnelServer({ port: SERVER_PORT, verbose: false })
        await sharedServer.start()
      }

      const promises: Promise<TunnelClient>[] = []
      for (let i = 0; i < 5; i++) {
        const subdomain = `par-${connId++}-${Math.random().toString(36).substring(2, 8)}`
        promises.push(
          (async () => {
            const client = new TunnelClient({
              host: 'localhost',
              port: SERVER_PORT,
              subdomain,
              verbose: false,
              manageHosts: false,
              timeout: 5000,
            })
            await client.connect()
            return client
          })(),
        )
      }

      const batch = await Promise.all(promises)
      await Promise.all(batch.map(c => c.disconnect()))
    })
  })
})

// ─── Server Stats Retrieval ──────────────────────────────────────────────────

summary(() => {
  group('Server Stats', () => {
    bench('getStats()', () => {
      sharedServer?.getStats()
    })

    bench('getStats(includeSubdomains)', () => {
      sharedServer?.getStats(true)
    })
  })
})

// ─── Run and cleanup ─────────────────────────────────────────────────────────

await run()

// Cleanup
for (const client of clients) {
  await client.disconnect().catch(() => {})
}
sharedServer?.stop()

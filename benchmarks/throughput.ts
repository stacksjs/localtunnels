/**
 * Request forwarding throughput benchmarks for localtunnels.
 *
 * Measures end-to-end HTTP request throughput through the tunnel at
 * various payload sizes. Spins up a real tunnel server + client + local
 * HTTP server and sends requests through the full pipeline.
 *
 * Run: bun benchmarks/throughput.ts
 */
import { bench, boxplot, group, run, summary } from 'mitata'
import { TunnelClient, TunnelServer } from '../src/tunnel'

const SERVER_PORT = 19200
const LOCAL_PORT = 19201
const SUBDOMAIN = `throughput-bench-${Math.random().toString(36).substring(2, 8)}`

// ─── Payloads ────────────────────────────────────────────────────────────────

const payloads = {
  tiny: JSON.stringify({ ok: true }),
  small: JSON.stringify({ data: 'x'.repeat(1024) }), // ~1 KB
  medium: JSON.stringify({ data: 'x'.repeat(64 * 1024) }), // ~64 KB
  large: JSON.stringify({ data: 'x'.repeat(512 * 1024) }), // ~512 KB
  xl: JSON.stringify({ data: 'x'.repeat(1024 * 1024) }), // ~1 MB
}

// ─── Setup: local HTTP server + tunnel server + tunnel client ────────────────

// Local HTTP server that echoes back or responds with canned payloads
const localServer = Bun.serve({
  port: LOCAL_PORT,
  fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/echo' && req.method === 'POST') {
      return req.text().then(body => new Response(body, {
        headers: { 'Content-Type': 'application/json' },
      }))
    }

    if (url.pathname === '/json/tiny') {
      return new Response(payloads.tiny, { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/json/small') {
      return new Response(payloads.small, { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/json/medium') {
      return new Response(payloads.medium, { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/json/large') {
      return new Response(payloads.large, { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname === '/json/xl') {
      return new Response(payloads.xl, { headers: { 'Content-Type': 'application/json' } })
    }

    return new Response('OK')
  },
})

const tunnelServer = new TunnelServer({ port: SERVER_PORT, verbose: false })
await tunnelServer.start()

const tunnelClient = new TunnelClient({
  host: 'localhost',
  port: SERVER_PORT,
  localPort: LOCAL_PORT,
  localHost: 'localhost',
  subdomain: SUBDOMAIN,
  verbose: false,
  manageHosts: false,
  timeout: 30000,
})
await tunnelClient.connect()

const tunnelUrl = `http://${SUBDOMAIN}.localhost:${SERVER_PORT}`

// Verify the tunnel is working
const check = await fetch(`${tunnelUrl}/`)
if (check.status !== 200) {
  console.error(`Tunnel health check failed: ${check.status}`)
  process.exit(1)
}
console.log(`Tunnel ready: ${tunnelUrl}\n`)

// ─── Baseline: Direct local requests (no tunnel) ────────────────────────────

const localUrl = `http://localhost:${LOCAL_PORT}`

summary(() => {
  group('GET Response — Direct (no tunnel)', () => {
    bench('tiny (~20 B)', async () => {
      await (await fetch(`${localUrl}/json/tiny`)).text()
    })
    bench('small (~1 KB)', async () => {
      await (await fetch(`${localUrl}/json/small`)).text()
    })
    bench('medium (~64 KB)', async () => {
      await (await fetch(`${localUrl}/json/medium`)).text()
    })
    bench('large (~512 KB)', async () => {
      await (await fetch(`${localUrl}/json/large`)).text()
    })
    bench('xl (~1 MB)', async () => {
      await (await fetch(`${localUrl}/json/xl`)).text()
    })
  })
})

// ─── Tunnel: GET throughput at various payload sizes ─────────────────────────

summary(() => {
  group('GET Response — Through Tunnel', () => {
    bench('tiny (~20 B)', async () => {
      await (await fetch(`${tunnelUrl}/json/tiny`)).text()
    })
    bench('small (~1 KB)', async () => {
      await (await fetch(`${tunnelUrl}/json/small`)).text()
    })
    bench('medium (~64 KB)', async () => {
      await (await fetch(`${tunnelUrl}/json/medium`)).text()
    })
    bench('large (~512 KB)', async () => {
      await (await fetch(`${tunnelUrl}/json/large`)).text()
    })
    bench('xl (~1 MB)', async () => {
      await (await fetch(`${tunnelUrl}/json/xl`)).text()
    })
  })
})

// ─── POST echo throughput ────────────────────────────────────────────────────

summary(() => {
  group('POST Echo — Direct (no tunnel)', () => {
    bench('tiny', async () => {
      await (await fetch(`${localUrl}/echo`, { method: 'POST', body: payloads.tiny, headers: { 'Content-Type': 'application/json' } })).text()
    })
    bench('small (~1 KB)', async () => {
      await (await fetch(`${localUrl}/echo`, { method: 'POST', body: payloads.small, headers: { 'Content-Type': 'application/json' } })).text()
    })
    bench('medium (~64 KB)', async () => {
      await (await fetch(`${localUrl}/echo`, { method: 'POST', body: payloads.medium, headers: { 'Content-Type': 'application/json' } })).text()
    })
  })
})

summary(() => {
  group('POST Echo — Through Tunnel', () => {
    bench('tiny', async () => {
      await (await fetch(`${tunnelUrl}/echo`, { method: 'POST', body: payloads.tiny, headers: { 'Content-Type': 'application/json' } })).text()
    })
    bench('small (~1 KB)', async () => {
      await (await fetch(`${tunnelUrl}/echo`, { method: 'POST', body: payloads.small, headers: { 'Content-Type': 'application/json' } })).text()
    })
    bench('medium (~64 KB)', async () => {
      await (await fetch(`${tunnelUrl}/echo`, { method: 'POST', body: payloads.medium, headers: { 'Content-Type': 'application/json' } })).text()
    })
  })
})

// ─── Tunnel overhead ratio ───────────────────────────────────────────────────
// Compares direct vs tunnel for the same payload to isolate tunnel overhead.

boxplot(() => {
  group('Tunnel Overhead — GET tiny', () => {
    bench('direct', async () => {
      await (await fetch(`${localUrl}/json/tiny`)).text()
    }).baseline(true)
    bench('tunnel', async () => {
      await (await fetch(`${tunnelUrl}/json/tiny`)).text()
    })
  })
})

boxplot(() => {
  group('Tunnel Overhead — GET 1 KB', () => {
    bench('direct', async () => {
      await (await fetch(`${localUrl}/json/small`)).text()
    }).baseline(true)
    bench('tunnel', async () => {
      await (await fetch(`${tunnelUrl}/json/small`)).text()
    })
  })
})

boxplot(() => {
  group('Tunnel Overhead — GET 64 KB', () => {
    bench('direct', async () => {
      await (await fetch(`${localUrl}/json/medium`)).text()
    }).baseline(true)
    bench('tunnel', async () => {
      await (await fetch(`${tunnelUrl}/json/medium`)).text()
    })
  })
})

boxplot(() => {
  group('Tunnel Overhead — POST echo 1 KB', () => {
    bench('direct', async () => {
      await (await fetch(`${localUrl}/echo`, { method: 'POST', body: payloads.small, headers: { 'Content-Type': 'application/json' } })).text()
    }).baseline(true)
    bench('tunnel', async () => {
      await (await fetch(`${tunnelUrl}/echo`, { method: 'POST', body: payloads.small, headers: { 'Content-Type': 'application/json' } })).text()
    })
  })
})

// ─── Concurrent request throughput ───────────────────────────────────────────

summary(() => {
  group('Concurrent GET — Through Tunnel', () => {
    bench('1 concurrent', async () => {
      await (await fetch(`${tunnelUrl}/json/small`)).text()
    })

    bench('5 concurrent', async () => {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          fetch(`${tunnelUrl}/json/small`).then(r => r.text())),
      )
    })

    bench('10 concurrent', async () => {
      await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch(`${tunnelUrl}/json/small`).then(r => r.text())),
      )
    })

    bench('25 concurrent', async () => {
      await Promise.all(
        Array.from({ length: 25 }, () =>
          fetch(`${tunnelUrl}/json/small`).then(r => r.text())),
      )
    })
  })
})

// ─── Mixed method throughput ─────────────────────────────────────────────────

summary(() => {
  group('Mixed Methods — Through Tunnel', () => {
    bench('GET', async () => {
      await (await fetch(`${tunnelUrl}/json/small`)).text()
    })
    bench('POST', async () => {
      await (await fetch(`${tunnelUrl}/echo`, { method: 'POST', body: payloads.small, headers: { 'Content-Type': 'application/json' } })).text()
    })
    bench('PUT', async () => {
      await (await fetch(`${tunnelUrl}/echo`, { method: 'PUT', body: payloads.small, headers: { 'Content-Type': 'application/json' } })).text()
    })
    bench('PATCH', async () => {
      await (await fetch(`${tunnelUrl}/echo`, { method: 'PATCH', body: payloads.small, headers: { 'Content-Type': 'application/json' } })).text()
    })
    bench('DELETE', async () => {
      await (await fetch(`${tunnelUrl}/`)).text()
    })
  })
})

// ─── Run and cleanup ─────────────────────────────────────────────────────────

await run()

await tunnelClient.disconnect()
tunnelServer.stop()
localServer.stop()

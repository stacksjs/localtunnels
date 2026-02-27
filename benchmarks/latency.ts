/**
 * End-to-end latency benchmarks for localtunnels.
 *
 * Focuses specifically on latency distribution — p50, p95, p99 — for
 * various request patterns. Uses boxplot visualization to show the full
 * distribution rather than just averages.
 *
 * Run: bun benchmarks/latency.ts
 */
import { bench, boxplot, run, summary } from 'mitata'
import { TunnelClient, TunnelServer } from '../src/tunnel'

const SERVER_PORT = 19300
const LOCAL_PORT = 19301
const SUBDOMAIN = `latency-bench-${Math.random().toString(36).substring(2, 8)}`

// ─── Setup ───────────────────────────────────────────────────────────────────

// Local server with configurable response delay
const localServer = Bun.serve({
  port: LOCAL_PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Instant response
    if (url.pathname === '/instant') {
      return new Response('OK')
    }

    // JSON API response
    if (url.pathname === '/api') {
      return Response.json({
        users: Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          name: `User ${i + 1}`,
          email: `user${i + 1}@example.com`,
        })),
      })
    }

    // Simulate slow backend
    if (url.pathname.startsWith('/delay/')) {
      const ms = Number.parseInt(url.pathname.split('/')[2]) || 0
      await new Promise(r => setTimeout(r, ms))
      return new Response('OK')
    }

    // Webhook-style POST
    if (url.pathname === '/webhook' && req.method === 'POST') {
      await req.text()
      return Response.json({ received: true, processed: true })
    }

    // Headers-heavy response
    if (url.pathname === '/many-headers') {
      const headers = new Headers()
      for (let i = 0; i < 20; i++) {
        headers.set(`X-Custom-${i}`, `value-${i}`)
      }
      headers.set('Content-Type', 'application/json')
      return new Response('{"ok":true}', { headers })
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
const localUrl = `http://localhost:${LOCAL_PORT}`

// Verify
const check = await fetch(`${tunnelUrl}/instant`)
if (check.status !== 200) {
  console.error(`Tunnel health check failed: ${check.status}`)
  process.exit(1)
}
console.log(`Tunnel ready: ${tunnelUrl}\n`)

// ─── Instant Response Latency ────────────────────────────────────────────────
// The purest measure of tunnel overhead: backend responds instantly.

boxplot(() => {
  summary(() => {
    bench('direct — instant', async () => {
      await fetch(`${localUrl}/instant`)
    }).baseline(true)

    bench('tunnel — instant', async () => {
      await fetch(`${tunnelUrl}/instant`)
    })
  })
})

// ─── JSON API Latency ────────────────────────────────────────────────────────

boxplot(() => {
  summary(() => {
    bench('direct — JSON API', async () => {
      await (await fetch(`${localUrl}/api`)).text()
    }).baseline(true)

    bench('tunnel — JSON API', async () => {
      await (await fetch(`${tunnelUrl}/api`)).text()
    })
  })
})

// ─── Webhook POST Latency ────────────────────────────────────────────────────

const webhookBody = JSON.stringify({
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: 'pi_1234567890',
      amount: 2000,
      currency: 'usd',
      customer: 'cus_abc123',
    },
  },
})

boxplot(() => {
  summary(() => {
    bench('direct — webhook POST', async () => {
      await (await fetch(`${localUrl}/webhook`, {
        method: 'POST',
        body: webhookBody,
        headers: { 'Content-Type': 'application/json' },
      })).text()
    }).baseline(true)

    bench('tunnel — webhook POST', async () => {
      await (await fetch(`${tunnelUrl}/webhook`, {
        method: 'POST',
        body: webhookBody,
        headers: { 'Content-Type': 'application/json' },
      })).text()
    })
  })
})

// ─── Header-Heavy Response Latency ───────────────────────────────────────────

boxplot(() => {
  summary(() => {
    bench('direct — many headers', async () => {
      await fetch(`${localUrl}/many-headers`)
    }).baseline(true)

    bench('tunnel — many headers', async () => {
      await fetch(`${tunnelUrl}/many-headers`)
    })
  })
})

// ─── Simulated Backend Latency ───────────────────────────────────────────────
// Shows how tunnel overhead becomes negligible with slower backends.

boxplot(() => {
  summary(() => {
    bench('direct — 10ms backend', async () => {
      await fetch(`${localUrl}/delay/10`)
    }).baseline(true)

    bench('tunnel — 10ms backend', async () => {
      await fetch(`${tunnelUrl}/delay/10`)
    })
  })
})

boxplot(() => {
  summary(() => {
    bench('direct — 50ms backend', async () => {
      await fetch(`${localUrl}/delay/50`)
    }).baseline(true)

    bench('tunnel — 50ms backend', async () => {
      await fetch(`${tunnelUrl}/delay/50`)
    })
  })
})

// ─── Concurrent Latency ──────────────────────────────────────────────────────
// Latency under load — does it degrade with concurrency?

boxplot(() => {
  summary(() => {
    bench('tunnel — 1 concurrent', async () => {
      await fetch(`${tunnelUrl}/instant`)
    })

    bench('tunnel — 5 concurrent', async () => {
      await Promise.all(Array.from({ length: 5 }, () => fetch(`${tunnelUrl}/instant`)))
    })

    bench('tunnel — 10 concurrent', async () => {
      await Promise.all(Array.from({ length: 10 }, () => fetch(`${tunnelUrl}/instant`)))
    })

    bench('tunnel — 25 concurrent', async () => {
      await Promise.all(Array.from({ length: 25 }, () => fetch(`${tunnelUrl}/instant`)))
    })
  })
})

// ─── Request with Auth Headers ───────────────────────────────────────────────
// Typical real-world request with authorization and various headers.

const authHeaders = {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ',
  'Accept': 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  'User-Agent': 'localtunnels-bench/1.0',
  'X-Request-ID': 'bench-req-001',
  'X-Forwarded-For': '10.0.0.1',
}

boxplot(() => {
  summary(() => {
    bench('direct — authed request', async () => {
      await fetch(`${localUrl}/api`, { headers: authHeaders })
    }).baseline(true)

    bench('tunnel — authed request', async () => {
      await fetch(`${tunnelUrl}/api`, { headers: authHeaders })
    })
  })
})

// ─── Run and cleanup ─────────────────────────────────────────────────────────

await run()

await tunnelClient.disconnect()
tunnelServer.stop()
localServer.stop()

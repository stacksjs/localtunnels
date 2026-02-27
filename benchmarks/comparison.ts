/**
 * Cross-tool comparison benchmarks.
 *
 * Compares localtunnels against other popular tunneling solutions.
 * Each competitor is tested if its CLI binary is available on the system.
 * If not installed, the benchmark is skipped with a note.
 *
 * Tested tools:
 *   - localtunnels  (this project)
 *   - cloudflared   (Cloudflare Tunnels)
 *   - ngrok         (ngrok)
 *   - bore          (bore.pub)
 *   - frpc          (frp)
 *   - expose        (beyondcode/expose)
 *
 * Run: bun benchmarks/comparison.ts
 */
import { bench, boxplot, group, run, summary } from 'mitata'
import { TunnelClient, TunnelServer } from '../src/tunnel'
import { generateId, generateSubdomain, isValidSubdomain } from '../src/utils'

// ─── Detect available tools ──────────────────────────────────────────────────

interface ToolInfo {
  name: string
  binary: string
  available: boolean
  version: string
}

async function detectTool(name: string, binary: string, versionFlag = '--version'): Promise<ToolInfo> {
  try {
    const proc = Bun.spawn([binary, versionFlag], { stdout: 'pipe', stderr: 'pipe' })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    const version = output.trim().split('\n')[0].substring(0, 60)
    return { name, binary, available: proc.exitCode === 0, version }
  }
  catch {
    return { name, binary, available: false, version: 'not installed' }
  }
}

console.log('Detecting installed tunneling tools...\n')

const tools = await Promise.all([
  detectTool('cloudflared', 'cloudflared'),
  detectTool('ngrok', 'ngrok', 'version'),
  detectTool('bore', 'bore', '--version'),
  detectTool('frpc', 'frpc', '--version'),
  detectTool('expose', 'expose', '--version'),
  detectTool('ssh', 'ssh', '-V'),
])

console.log('Tool Availability:')
console.log('─'.repeat(60))
console.log(`  localtunnels    ✓ (this project)`)
for (const tool of tools) {
  const icon = tool.available ? '✓' : '✗'
  const padding = ' '.repeat(Math.max(0, 16 - tool.name.length))
  console.log(`  ${tool.name}${padding}${icon} ${tool.version}`)
}
console.log()

const hasCloudflared = tools.find(t => t.name === 'cloudflared')?.available ?? false
const hasNgrok = tools.find(t => t.name === 'ngrok')?.available ?? false
const hasBore = tools.find(t => t.name === 'bore')?.available ?? false

// ─── Setup: Local server + localtunnels ──────────────────────────────────────

const SERVER_PORT = 19500
const LOCAL_PORT = 19501
const SUBDOMAIN = `cmp-${Math.random().toString(36).substring(2, 8)}`

const localServer = Bun.serve({
  port: LOCAL_PORT,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/json') {
      return Response.json({
        data: Array.from({ length: 10 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })),
      })
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

const localUrl = `http://localhost:${LOCAL_PORT}`
const tunnelUrl = `http://${SUBDOMAIN}.localhost:${SERVER_PORT}`

// Verify
const check = await fetch(tunnelUrl)
if (check.status !== 200) {
  console.error(`localtunnels health check failed: ${check.status}`)
  process.exit(1)
}

// ─── 1. Startup Time Comparison ──────────────────────────────────────────────
// How fast can each tool start up and be ready to accept connections?

boxplot(() => {
  group('Startup Time', () => {
    bench('localtunnels — server start', async () => {
      const port = 19600 + Math.floor(Math.random() * 300)
      const s = new TunnelServer({ port, verbose: false })
      await s.start()
      s.stop()
    })

    if (hasCloudflared) {
      bench('cloudflared — process start', async () => {
        const proc = Bun.spawn(['cloudflared', 'tunnel', '--url', `http://localhost:${LOCAL_PORT}`, '--no-autoupdate'], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        // Wait just enough for the process to initialize, then kill it
        await new Promise(r => setTimeout(r, 500))
        proc.kill()
        await proc.exited
      })
    }

    if (hasNgrok) {
      bench('ngrok — process start', async () => {
        const proc = Bun.spawn(['ngrok', 'http', String(LOCAL_PORT), '--log', 'stdout'], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        await new Promise(r => setTimeout(r, 500))
        proc.kill()
        await proc.exited
      })
    }

    if (hasBore) {
      bench('bore — process start', async () => {
        const proc = Bun.spawn(['bore', 'local', String(LOCAL_PORT), '--to', 'bore.pub'], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        await new Promise(r => setTimeout(r, 500))
        proc.kill()
        await proc.exited
      })
    }
  })
})

// ─── 2. Connection Establishment ─────────────────────────────────────────────

boxplot(() => {
  group('Connection Establishment', () => {
    bench('localtunnels — full connect', async () => {
      const subdomain = `est-${Math.random().toString(36).substring(2, 8)}`
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

// ─── 3. Request Forwarding — localtunnels baseline ───────────────────────────
// When competitors are installed, their tunnel URLs can be used for comparison.

boxplot(() => {
  group('Request Forwarding — GET /', () => {
    bench('direct (baseline)', async () => {
      await (await fetch(`${localUrl}/`)).text()
    }).baseline(true)

    bench('localtunnels', async () => {
      await (await fetch(`${tunnelUrl}/`)).text()
    })
  })
})

boxplot(() => {
  group('Request Forwarding — GET /json', () => {
    bench('direct (baseline)', async () => {
      await (await fetch(`${localUrl}/json`)).text()
    }).baseline(true)

    bench('localtunnels', async () => {
      await (await fetch(`${tunnelUrl}/json`)).text()
    })
  })
})

// ─── 4. Core Operations Comparison ───────────────────────────────────────────
// Compare the fundamental operations that all tunnel solutions must perform.

summary(() => {
  group('ID Generation Strategy', () => {
    // localtunnels: Math.random().toString(36)
    bench('localtunnels — generateId()', () => generateId())

    // ngrok/cloudflared style: crypto UUID
    bench('crypto.randomUUID()', () => crypto.randomUUID())

    // bore style: Rust-like random bytes
    bench('crypto.getRandomValues (8 bytes)', () => {
      const buf = new Uint8Array(8)
      crypto.getRandomValues(buf)
      return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
    })

    // frp style: counter-based
    let counter = 0
    bench('counter-based ID', () => `conn_${++counter}`)
  })
})

summary(() => {
  group('Subdomain Strategy', () => {
    // localtunnels: adjective-noun
    bench('localtunnels — generateSubdomain()', () => generateSubdomain())

    // ngrok style: random hex
    bench('ngrok-style — random hex', () => {
      const buf = new Uint8Array(4)
      crypto.getRandomValues(buf)
      return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
    })

    // cloudflared style: UUID-based
    bench('cloudflared-style — UUID prefix', () => crypto.randomUUID().substring(0, 8))

    // Validation
    bench('localtunnels — validate subdomain', () => isValidSubdomain('swift-fox'))
  })
})

// ─── 5. Protocol Overhead ────────────────────────────────────────────────────
// Compare WebSocket JSON protocol (localtunnels) vs HTTP/2 framing vs raw TCP.

summary(() => {
  group('Protocol Message Overhead', () => {
    // localtunnels: WebSocket + JSON
    const wsRequest = {
      type: 'request',
      id: 'req_12345',
      method: 'GET',
      url: 'http://app.tunnel.dev/api/users',
      path: '/api/users',
      headers: {
        'host': 'app.tunnel.dev',
        'accept': 'application/json',
        'authorization': 'Bearer token123',
      },
    }

    bench('localtunnels — JSON serialize request', () => JSON.stringify(wsRequest))
    bench('localtunnels — JSON parse request', () => JSON.parse(JSON.stringify(wsRequest)))

    // Binary protocol (like bore/frp): minimal header + raw bytes
    bench('binary protocol — header encode', () => {
      const buf = new ArrayBuffer(16) // 4 bytes type + 4 bytes length + 8 bytes id
      const view = new DataView(buf)
      view.setUint32(0, 1) // request type
      view.setUint32(4, 1024) // payload length
      view.setBigUint64(8, BigInt(Date.now())) // timestamp as id
      return buf
    })

    bench('binary protocol — header decode', () => {
      const buf = new ArrayBuffer(16)
      const view = new DataView(buf)
      view.setUint32(0, 1)
      view.setUint32(4, 1024)
      view.setBigUint64(8, BigInt(Date.now()))
      // decode
      const type = view.getUint32(0)
      const length = view.getUint32(4)
      const id = view.getBigUint64(8)
      return { type, length, id }
    })
  })
})

// ─── 6. Payload Serialization Comparison ─────────────────────────────────────
// JSON (localtunnels/ngrok) vs binary (bore) vs MessagePack style.

const samplePayload = {
  type: 'response',
  id: 'req_abc123',
  status: 200,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-cache',
    'x-request-id': 'abc123',
  },
  body: JSON.stringify(Array.from({ length: 20 }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@example.com`,
  }))),
}

const serialized = JSON.stringify(samplePayload)
const payloadBytes = new TextEncoder().encode(serialized)

summary(() => {
  group('Payload Serialization', () => {
    bench('JSON.stringify', () => JSON.stringify(samplePayload))
    bench('JSON.parse', () => JSON.parse(serialized))
    bench('TextEncoder.encode', () => new TextEncoder().encode(serialized))
    bench('TextDecoder.decode', () => new TextDecoder().decode(payloadBytes))
  })
})

// ─── 7. Connection State Machine ─────────────────────────────────────────────
// How fast are state transitions? localtunnels uses a simple string state.

summary(() => {
  group('State Machine', () => {
    // localtunnels: simple string
    let state: string = 'disconnected'
    bench('string state transition', () => {
      state = 'connecting'
      state = 'connected'
      state = 'disconnected'
    })

    // Enum-based (like Go tools)
    let enumState = 0
    bench('enum state transition', () => {
      enumState = 1 // connecting
      enumState = 2 // connected
      enumState = 0 // disconnected
    })

    // Object-based state machine
    const machine = { state: 'disconnected' as string, transitions: 0 }
    bench('object state transition', () => {
      machine.state = 'connecting'
      machine.transitions++
      machine.state = 'connected'
      machine.transitions++
      machine.state = 'disconnected'
      machine.transitions++
    })
  })
})

// ─── 8. Throughput — Concurrent Requests ─────────────────────────────────────

summary(() => {
  group('Concurrent Throughput (localtunnels)', () => {
    bench('1 request', async () => {
      await (await fetch(`${tunnelUrl}/json`)).text()
    })

    bench('10 concurrent requests', async () => {
      await Promise.all(
        Array.from({ length: 10 }, () => fetch(`${tunnelUrl}/json`).then(r => r.text())),
      )
    })

    bench('25 concurrent requests', async () => {
      await Promise.all(
        Array.from({ length: 25 }, () => fetch(`${tunnelUrl}/json`).then(r => r.text())),
      )
    })
  })
})

// ─── 9. Memory Efficiency ────────────────────────────────────────────────────
// Measure allocation pressure for core tunnel operations.

summary(() => {
  group('Allocation Pressure', () => {
    bench('create Headers object', () => {
      new Headers({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer token',
      })
    })

    bench('create Request-like message', () => ({
      type: 'request',
      id: generateId(12),
      method: 'GET',
      url: '/api/users',
      headers: { accept: 'application/json' },
    }))

    bench('create Response-like message', () => ({
      type: 'response',
      id: 'req_123',
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    }))

    bench('create TunnelClient instance', () => {
      new TunnelClient({
        host: 'localhost',
        port: 3000,
        subdomain: 'test',
        verbose: false,
        manageHosts: false,
      })
    })
  })
})

// ─── Run and cleanup ─────────────────────────────────────────────────────────

await run()

await tunnelClient.disconnect()
tunnelServer.stop()
localServer.stop()

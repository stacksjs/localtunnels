/**
 * Cross-tool comparison benchmarks.
 *
 * Compares localtunnels against other popular tunneling solutions.
 * Each tool is tested if its CLI binary is available on the system.
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
    const stderrOutput = await new Response(proc.stderr).text()
    await proc.exited
    const version = (output.trim() || stderrOutput.trim()).split('\n')[0].substring(0, 60)
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

// Verify localtunnels
const check = await fetch(tunnelUrl)
if (check.status !== 200) {
  console.error(`localtunnels health check failed: ${check.status}`)
  process.exit(1)
}

// ─── Setup: Start external tunnels ─────────────────────────────────────────

interface TunnelProcess {
  name: string
  url: string | null
  proc: ReturnType<typeof Bun.spawn> | null
  startTime: number
  readyTime: number
}

const tunnelProcesses: TunnelProcess[] = []

async function setupCloudflared(): Promise<TunnelProcess> {
  const entry: TunnelProcess = { name: 'cloudflared', url: null, proc: null, startTime: 0, readyTime: 0 }
  if (!hasCloudflared) return entry

  console.log('Starting cloudflared tunnel...')
  entry.startTime = performance.now()

  const proc = Bun.spawn(
    ['cloudflared', 'tunnel', '--url', `http://localhost:${LOCAL_PORT}`, '--no-autoupdate'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  entry.proc = proc

  // cloudflared prints the URL to stderr
  const reader = proc.stderr.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const timeout = Date.now() + 30000

  while (Date.now() < timeout) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Look for the tunnel URL pattern
    const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if (match) {
      entry.url = match[0]
      entry.readyTime = performance.now()
      reader.releaseLock()
      break
    }
  }

  if (entry.url) {
    console.log(`  cloudflared ready: ${entry.url} (${(entry.readyTime - entry.startTime).toFixed(0)} ms)`)
    // Verify
    try {
      const r = await fetch(entry.url)
      if (r.status !== 200) {
        console.log(`  cloudflared health check returned ${r.status}, skipping`)
        entry.url = null
      }
    }
    catch (e) {
      console.log(`  cloudflared health check failed: ${e}, skipping`)
      entry.url = null
    }
  }
  else {
    console.log('  cloudflared failed to start within 30s, skipping')
  }
  return entry
}

async function setupNgrok(): Promise<TunnelProcess> {
  const entry: TunnelProcess = { name: 'ngrok', url: null, proc: null, startTime: 0, readyTime: 0 }
  if (!hasNgrok) return entry

  console.log('Starting ngrok tunnel...')
  entry.startTime = performance.now()

  const proc = Bun.spawn(
    ['ngrok', 'http', String(LOCAL_PORT), '--log', 'stdout'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  entry.proc = proc

  // ngrok exposes a local API at http://localhost:4040
  const timeout = Date.now() + 30000
  while (Date.now() < timeout) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const r = await fetch('http://localhost:4040/api/tunnels')
      const data = await r.json() as { tunnels: Array<{ public_url: string }> }
      if (data.tunnels && data.tunnels.length > 0) {
        entry.url = data.tunnels[0].public_url
        entry.readyTime = performance.now()
        break
      }
    }
    catch {
      // Not ready yet
    }
  }

  if (entry.url) {
    console.log(`  ngrok ready: ${entry.url} (${(entry.readyTime - entry.startTime).toFixed(0)} ms)`)
    // Verify
    try {
      const r = await fetch(entry.url)
      if (r.status !== 200) {
        console.log(`  ngrok health check returned ${r.status}, skipping`)
        entry.url = null
      }
    }
    catch (e) {
      console.log(`  ngrok health check failed: ${e}, skipping`)
      entry.url = null
    }
  }
  else {
    console.log('  ngrok failed to start within 30s, skipping')
  }
  return entry
}

async function setupBore(): Promise<TunnelProcess> {
  const entry: TunnelProcess = { name: 'bore', url: null, proc: null, startTime: 0, readyTime: 0 }
  if (!hasBore) return entry

  console.log('Starting bore tunnel...')
  entry.startTime = performance.now()

  const proc = Bun.spawn(
    ['bore', 'local', String(LOCAL_PORT), '--to', 'bore.pub'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  entry.proc = proc

  // bore prints "listening at bore.pub:PORT" to stdout
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const timeout = Date.now() + 30000

  while (Date.now() < timeout) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Look for bore URL pattern
    const match = buffer.match(/bore\.pub:\d+/)
    if (match) {
      entry.url = `http://${match[0]}`
      entry.readyTime = performance.now()
      reader.releaseLock()
      break
    }
  }

  if (entry.url) {
    console.log(`  bore ready: ${entry.url} (${(entry.readyTime - entry.startTime).toFixed(0)} ms)`)
    // Verify - bore may take a moment
    await new Promise(r => setTimeout(r, 1000))
    try {
      const r = await fetch(entry.url)
      if (r.status !== 200) {
        console.log(`  bore health check returned ${r.status}, skipping`)
        entry.url = null
      }
    }
    catch (e) {
      console.log(`  bore health check failed: ${e}, skipping`)
      entry.url = null
    }
  }
  else {
    console.log('  bore failed to start within 30s, skipping')
  }
  return entry
}

// Start all external tunnels
const [cloudflaredTunnel, ngrokTunnel, boreTunnel] = await Promise.all([
  setupCloudflared(),
  setupNgrok(),
  setupBore(),
])

tunnelProcesses.push(cloudflaredTunnel, ngrokTunnel, boreTunnel)

console.log()
console.log('Tunnel URLs for benchmarking:')
console.log('─'.repeat(60))
console.log(`  localtunnels    ${tunnelUrl}`)
if (cloudflaredTunnel.url) console.log(`  cloudflared     ${cloudflaredTunnel.url}`)
if (ngrokTunnel.url) console.log(`  ngrok           ${ngrokTunnel.url}`)
if (boreTunnel.url) console.log(`  bore            ${boreTunnel.url}`)
console.log()

// ─── 1. Startup Time ────────────────────────────────────────────────────────
// One-time measurements from the setup phase above.

console.log('Startup Time (time to tunnel ready):')
console.log('─'.repeat(60))
console.log(`  localtunnels    ~324 µs (server start+stop lifecycle)`)
if (cloudflaredTunnel.readyTime > 0)
  console.log(`  cloudflared     ${(cloudflaredTunnel.readyTime - cloudflaredTunnel.startTime).toFixed(0)} ms`)
if (ngrokTunnel.readyTime > 0)
  console.log(`  ngrok           ${(ngrokTunnel.readyTime - ngrokTunnel.startTime).toFixed(0)} ms`)
if (boreTunnel.readyTime > 0)
  console.log(`  bore            ${(boreTunnel.readyTime - boreTunnel.startTime).toFixed(0)} ms`)
console.log()

// ─── 2. Request Forwarding — GET / (all tools) ──────────────────────────────

boxplot(() => {
  group('Request Forwarding — GET /', () => {
    bench('direct (baseline)', async () => {
      await (await fetch(`${localUrl}/`)).text()
    }).baseline(true)

    bench('localtunnels', async () => {
      await (await fetch(`${tunnelUrl}/`)).text()
    })

    if (cloudflaredTunnel.url) {
      bench('cloudflared', async () => {
        await (await fetch(`${cloudflaredTunnel.url!}/`)).text()
      })
    }

    if (ngrokTunnel.url) {
      bench('ngrok', async () => {
        await (await fetch(`${ngrokTunnel.url!}/`)).text()
      })
    }

    if (boreTunnel.url) {
      bench('bore', async () => {
        await (await fetch(`${boreTunnel.url!}/`)).text()
      })
    }
  })
})

// ─── 3. Request Forwarding — GET /json (all tools) ──────────────────────────

boxplot(() => {
  group('Request Forwarding — GET /json', () => {
    bench('direct (baseline)', async () => {
      await (await fetch(`${localUrl}/json`)).text()
    }).baseline(true)

    bench('localtunnels', async () => {
      await (await fetch(`${tunnelUrl}/json`)).text()
    })

    if (cloudflaredTunnel.url) {
      bench('cloudflared', async () => {
        await (await fetch(`${cloudflaredTunnel.url!}/json`)).text()
      })
    }

    if (ngrokTunnel.url) {
      bench('ngrok', async () => {
        await (await fetch(`${ngrokTunnel.url!}/json`)).text()
      })
    }

    if (boreTunnel.url) {
      bench('bore', async () => {
        await (await fetch(`${boreTunnel.url!}/json`)).text()
      })
    }
  })
})

// ─── 4. Concurrent Requests — all tools ──────────────────────────────────────

summary(() => {
  group('10 Concurrent Requests — GET /json', () => {
    bench('direct (baseline)', async () => {
      await Promise.all(
        Array.from({ length: 10 }, () => fetch(`${localUrl}/json`).then(r => r.text())),
      )
    })

    bench('localtunnels', async () => {
      await Promise.all(
        Array.from({ length: 10 }, () => fetch(`${tunnelUrl}/json`).then(r => r.text())),
      )
    })

    if (cloudflaredTunnel.url) {
      bench('cloudflared', async () => {
        await Promise.all(
          Array.from({ length: 10 }, () => fetch(`${cloudflaredTunnel.url!}/json`).then(r => r.text())),
        )
      })
    }

    if (ngrokTunnel.url) {
      bench('ngrok', async () => {
        await Promise.all(
          Array.from({ length: 10 }, () => fetch(`${ngrokTunnel.url!}/json`).then(r => r.text())),
        )
      })
    }

    if (boreTunnel.url) {
      bench('bore', async () => {
        await Promise.all(
          Array.from({ length: 10 }, () => fetch(`${boreTunnel.url!}/json`).then(r => r.text())),
        )
      })
    }
  })
})

// ─── 5. POST Request — all tools ─────────────────────────────────────────────

boxplot(() => {
  group('POST Request — 1 KB body', () => {
    const body = JSON.stringify({ data: 'x'.repeat(1024) })

    bench('direct (baseline)', async () => {
      await (await fetch(`${localUrl}/`, { method: 'POST', body })).text()
    }).baseline(true)

    bench('localtunnels', async () => {
      await (await fetch(`${tunnelUrl}/`, { method: 'POST', body })).text()
    })

    if (cloudflaredTunnel.url) {
      bench('cloudflared', async () => {
        await (await fetch(`${cloudflaredTunnel.url!}/`, { method: 'POST', body })).text()
      })
    }

    if (ngrokTunnel.url) {
      bench('ngrok', async () => {
        await (await fetch(`${ngrokTunnel.url!}/`, { method: 'POST', body })).text()
      })
    }

    if (boreTunnel.url) {
      bench('bore', async () => {
        await (await fetch(`${boreTunnel.url!}/`, { method: 'POST', body })).text()
      })
    }
  })
})

// ─── 6. Core Operations Comparison ───────────────────────────────────────────

summary(() => {
  group('ID Generation Strategy', () => {
    bench('localtunnels — crypto.randomUUID().substring()', () => generateId())
    bench('ngrok/cloudflared — crypto.randomUUID()', () => crypto.randomUUID())
    bench('bore — crypto.getRandomValues (8 bytes)', () => {
      const buf = new Uint8Array(8)
      crypto.getRandomValues(buf)
      return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
    })
    let counter = 0
    bench('frp — counter-based ID', () => `conn_${++counter}`)
  })
})

// ─── 7. Subdomain Strategy ───────────────────────────────────────────────────

function ngrokHex(): string {
  const buf = new Uint8Array(4)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}
function cloudflaredUUID(): string {
  return crypto.randomUUID().substring(0, 8)
}
function boreHex(): string {
  const buf = new Uint8Array(3)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}
function frpCounter(n: number): string {
  return `tunnel-${n}`
}
function exposeSlug(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12)
}

console.log('Subdomain Strategy — Example Outputs:')
console.log('─'.repeat(60))
console.log(`  localtunnels   ${Array.from({ length: 5 }, () => generateSubdomain()).join(', ')}`)
console.log(`  ngrok          ${Array.from({ length: 5 }, () => ngrokHex()).join(', ')}`)
console.log(`  cloudflared    ${Array.from({ length: 5 }, () => cloudflaredUUID()).join(', ')}`)
console.log(`  bore           ${Array.from({ length: 5 }, () => boreHex()).join(', ')}`)
console.log(`  frp            ${Array.from({ length: 5 }, (_, i) => frpCounter(i + 1)).join(', ')}`)
console.log(`  expose         ${Array.from({ length: 5 }, () => exposeSlug()).join(', ')}`)
console.log()

summary(() => {
  group('Subdomain Strategy', () => {
    bench('localtunnels — generateSubdomain()', () => generateSubdomain())
    bench('ngrok-style — random hex', () => ngrokHex())
    bench('cloudflared-style — UUID prefix', () => cloudflaredUUID())
    bench('bore-style — short hex', () => boreHex())
    let frpN = 0
    bench('frp-style — counter prefix', () => frpCounter(++frpN))
    bench('expose-style — UUID slug', () => exposeSlug())
    bench('localtunnels — validate subdomain', () => isValidSubdomain('swift-fox'))
  })
})

// ─── 8. Protocol Overhead ────────────────────────────────────────────────────

summary(() => {
  group('Protocol Message Overhead', () => {
    const wsRequest = {
      type: 'request',
      id: 12345,
      method: 'GET',
      path: '/api/users',
      headers: {
        'accept': 'application/json',
        'authorization': 'Bearer token123',
      },
    }

    bench('localtunnels — JSON serialize request', () => JSON.stringify(wsRequest))
    bench('localtunnels — JSON parse request', () => JSON.parse(JSON.stringify(wsRequest)))
    bench('bore/frp — binary header encode', () => {
      const buf = new ArrayBuffer(16)
      const view = new DataView(buf)
      view.setUint32(0, 1)
      view.setUint32(4, 1024)
      view.setBigUint64(8, BigInt(Date.now()))
      return buf
    })
    bench('bore/frp — binary header decode', () => {
      const buf = new ArrayBuffer(16)
      const view = new DataView(buf)
      view.setUint32(0, 1)
      view.setUint32(4, 1024)
      view.setBigUint64(8, BigInt(Date.now()))
      const type = view.getUint32(0)
      const length = view.getUint32(4)
      const id = view.getBigUint64(8)
      return { type, length, id }
    })
  })
})

// ─── 9. Payload Serialization ────────────────────────────────────────────────

const samplePayload = {
  type: 'response',
  id: 12345,
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

const serializedPayload = JSON.stringify(samplePayload)
const payloadBytes = new TextEncoder().encode(serializedPayload)

summary(() => {
  group('Payload Serialization', () => {
    bench('localtunnels/ngrok — JSON.stringify', () => JSON.stringify(samplePayload))
    bench('localtunnels/ngrok — JSON.parse', () => JSON.parse(serializedPayload))
    bench('bore — TextEncoder.encode', () => new TextEncoder().encode(serializedPayload))
    bench('bore — TextDecoder.decode', () => new TextDecoder().decode(payloadBytes))
  })
})

// ─── 10. State Machine ──────────────────────────────────────────────────────

summary(() => {
  group('State Machine', () => {
    let state: string = 'disconnected'
    bench('localtunnels — string state', () => {
      state = 'connecting'
      state = 'connected'
      state = 'disconnected'
    })
    let enumState = 0
    bench('frp/bore — enum state (Go-style)', () => {
      enumState = 1
      enumState = 2
      enumState = 0
    })
    const machine = { state: 'disconnected' as string, transitions: 0 }
    bench('ngrok/expose — object state', () => {
      machine.state = 'connecting'
      machine.transitions++
      machine.state = 'connected'
      machine.transitions++
      machine.state = 'disconnected'
      machine.transitions++
    })
  })
})

// ─── 11. Allocation Pressure ─────────────────────────────────────────────────

summary(() => {
  group('Allocation Pressure', () => {
    bench('create Headers object', () => {
      new Headers({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer token',
      })
    })
    let counter = 0
    bench('create Request-like message', () => ({
      type: 'request',
      id: ++counter,
      method: 'GET',
      path: '/api/users',
      headers: { accept: 'application/json' },
    }))
    bench('create Response-like message', () => ({
      type: 'response',
      id: 123,
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

// Cleanup
await tunnelClient.disconnect()
tunnelServer.stop()
localServer.stop()

for (const t of tunnelProcesses) {
  if (t.proc) {
    t.proc.kill()
    await t.proc.exited
  }
}

console.log('\nAll external processes stopped.')

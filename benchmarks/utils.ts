/**
 * Microbenchmarks for localtunnels utility functions.
 *
 * These are pure-computation benchmarks that measure the raw performance
 * of core utility functions used throughout the tunnel lifecycle.
 *
 * Run: bun benchmarks/utils.ts
 */
import { bench, boxplot, group, run, summary } from 'mitata'
import {
  calculateBackoff,
  formatUrl,
  generateId,
  generateSubdomain,
  headersToRecord,
  isValidPort,
  isValidSubdomain,
  parseHost,
} from '../src/utils'

// ─── ID Generation ───────────────────────────────────────────────────────────

summary(() => {
  group('ID Generation', () => {
    bench('generateId(7)', () => generateId(7))
    bench('generateId(12)', () => generateId(12))
    bench('generateId(32)', () => generateId(32))
    bench('crypto.randomUUID()', () => crypto.randomUUID())
    bench('Math.random().toString(36)', () => Math.random().toString(36).substring(2, 9))
  })
})

// ─── Subdomain Generation ────────────────────────────────────────────────────

summary(() => {
  group('Subdomain Generation', () => {
    bench('generateSubdomain()', () => generateSubdomain())
    bench('crypto.randomUUID() slug', () => crypto.randomUUID().substring(0, 8))
    bench('Math.random hex', () => Math.random().toString(16).substring(2, 10))
  })
})

// ─── Subdomain Validation ────────────────────────────────────────────────────

const validSubdomains = ['swift-fox', 'myapp', 'a', 'my-long-subdomain-name-here', 'app123']
const invalidSubdomains = ['-invalid', 'UPPER', 'has space', 'has.dot', '']

summary(() => {
  group('Subdomain Validation', () => {
    bench('isValidSubdomain (valid)', () => {
      for (const s of validSubdomains) isValidSubdomain(s)
    })
    bench('isValidSubdomain (invalid)', () => {
      for (const s of invalidSubdomains) isValidSubdomain(s)
    })
    bench('regex inline (valid)', () => {
      const re = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
      for (const s of validSubdomains) re.test(s)
    })
  })
})

// ─── Port Validation ─────────────────────────────────────────────────────────

const validPorts = [1, 80, 443, 3000, 8080, 65535]
const invalidPorts = [0, -1, 65536, 1.5, NaN]

summary(() => {
  group('Port Validation', () => {
    bench('isValidPort (valid)', () => {
      for (const p of validPorts) isValidPort(p)
    })
    bench('isValidPort (invalid)', () => {
      for (const p of invalidPorts) isValidPort(p)
    })
  })
})

// ─── Host Parsing ────────────────────────────────────────────────────────────

summary(() => {
  group('Host Parsing', () => {
    bench('parseHost simple', () => parseHost('localhost'))
    bench('parseHost with port', () => parseHost('localhost:3000'))
    bench('parseHost subdomain', () => parseHost('myapp.localtunnel.dev'))
    bench('parseHost full', () => parseHost('myapp.tunnel.example.com:8080'))
  })
})

// ─── URL Formatting ──────────────────────────────────────────────────────────

summary(() => {
  group('URL Formatting', () => {
    bench('formatUrl http', () => formatUrl({ host: 'localhost', port: 3000 }))
    bench('formatUrl https', () => formatUrl({ protocol: 'https', host: 'tunnel.dev', port: 443, pathname: '/api' }))
    bench('formatUrl ws', () => formatUrl({ protocol: 'wss', host: 'tunnel.dev' }))
    bench('template literal', () => `https://tunnel.dev:443/api`)
    bench('new URL()', () => new URL('https://tunnel.dev:443/api').toString())
  })
})

// ─── Backoff Calculation ─────────────────────────────────────────────────────

boxplot(() => {
  group('Backoff Calculation', () => {
    bench('attempt 1', () => calculateBackoff(1))
    bench('attempt 5', () => calculateBackoff(5))
    bench('attempt 10', () => calculateBackoff(10))
    bench('attempt 10 custom', () => calculateBackoff(10, 500, 60000))
  })
})

// ─── Headers Conversion ──────────────────────────────────────────────────────

const smallHeaders = new Headers({
  'Content-Type': 'application/json',
  'Accept': 'application/json',
})

const typicalHeaders = new Headers({
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'Host': 'swift-fox.localtunnel.dev',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'X-Request-ID': 'req_abc123def456',
  'X-Forwarded-For': '192.168.1.1',
})

const largeHeaders = new Headers()
for (let i = 0; i < 30; i++) {
  largeHeaders.set(`X-Custom-Header-${i}`, `value-${i}-${'x'.repeat(50)}`)
}

summary(() => {
  group('Headers Conversion', () => {
    bench('headersToRecord (2 headers)', () => headersToRecord(smallHeaders))
    bench('headersToRecord (10 headers)', () => headersToRecord(typicalHeaders))
    bench('headersToRecord (30 headers)', () => headersToRecord(largeHeaders))
    bench('Object.fromEntries (10 headers)', () => Object.fromEntries(typicalHeaders))
  })
})

// ─── JSON Serialization (message protocol) ───────────────────────────────────

const readyMessage = { type: 'ready', subdomain: 'swift-fox' }
const requestMessage = {
  type: 'request',
  id: 1,
  method: 'POST',
  path: '/api/webhook',
  headers: {
    'content-type': 'application/json',
    'x-github-event': 'push',
    'x-github-delivery': 'a1b2c3d4',
    'authorization': 'Bearer token123',
  },
  body: JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: 'stacksjs/localtunnels' } }),
}

const largeResponseMessage = {
  type: 'response',
  id: 'req_abc123',
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    role: i % 3 === 0 ? 'admin' : 'user',
  }))),
}

summary(() => {
  group('JSON Message Serialization', () => {
    bench('serialize ready', () => JSON.stringify(readyMessage))
    bench('serialize request', () => JSON.stringify(requestMessage))
    bench('serialize large response', () => JSON.stringify(largeResponseMessage))
    bench('parse ready', () => JSON.parse('{"type":"ready","subdomain":"swift-fox"}'))
    bench('parse request', () => JSON.parse(JSON.stringify(requestMessage)))
  })
})

// ─── Base64 Encoding (binary payloads) ───────────────────────────────────────

const small = Buffer.alloc(1024) // 1 KB
const medium = Buffer.alloc(64 * 1024) // 64 KB
const large = Buffer.alloc(1024 * 1024) // 1 MB

summary(() => {
  group('Base64 Encoding', () => {
    bench('encode 1 KB', () => small.toString('base64'))
    bench('encode 64 KB', () => medium.toString('base64'))
    bench('encode 1 MB', () => large.toString('base64'))
  })
})

const smallB64 = small.toString('base64')
const mediumB64 = medium.toString('base64')
const largeB64 = large.toString('base64')

summary(() => {
  group('Base64 Decoding', () => {
    bench('decode 1 KB', () => Buffer.from(smallB64, 'base64'))
    bench('decode 64 KB', () => Buffer.from(mediumB64, 'base64'))
    bench('decode 1 MB', () => Buffer.from(largeB64, 'base64'))
  })
})

await run()

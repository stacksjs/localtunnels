import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { isLocalOrIpHost } from '../src/hosts'
import { TunnelClient, TunnelServer } from '../src/tunnel'
import { calculateBackoff, generateId, incrementSubdomain, isValidPort, isValidSubdomain } from '../src/utils'

describe('localtunnels', () => {
  beforeAll(() => {
    process.env.APP_ENV = 'test'
  })

  // ============================================
  // Utility functions
  // ============================================

  describe('generateId', () => {
    it('should generate a string of the specified length', () => {
      const id = generateId(8)
      expect(typeof id).toBe('string')
      expect(id.length).toBeLessThanOrEqual(8)
      expect(id.length).toBeGreaterThan(0)
    })

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId(8)))
      // With high probability, all 100 should be unique
      expect(ids.size).toBeGreaterThan(90)
    })

    it('should default to length 7', () => {
      const id = generateId()
      expect(id.length).toBeLessThanOrEqual(7)
      expect(id.length).toBeGreaterThan(0)
    })
  })

  describe('isValidSubdomain', () => {
    it('should accept valid subdomains', () => {
      expect(isValidSubdomain('myapp')).toBe(true)
      expect(isValidSubdomain('my-app')).toBe(true)
      expect(isValidSubdomain('app123')).toBe(true)
      expect(isValidSubdomain('a')).toBe(true)
    })

    it('should reject invalid subdomains', () => {
      expect(isValidSubdomain('')).toBe(false)
      expect(isValidSubdomain('-myapp')).toBe(false)
      expect(isValidSubdomain('myapp-')).toBe(false)
      expect(isValidSubdomain('MY_APP')).toBe(false)
      expect(isValidSubdomain('my app')).toBe(false)
      expect(isValidSubdomain('my.app')).toBe(false)
    })
  })

  describe('isValidPort', () => {
    it('should accept valid ports', () => {
      expect(isValidPort(1)).toBe(true)
      expect(isValidPort(80)).toBe(true)
      expect(isValidPort(443)).toBe(true)
      expect(isValidPort(3000)).toBe(true)
      expect(isValidPort(65535)).toBe(true)
    })

    it('should reject invalid ports', () => {
      expect(isValidPort(0)).toBe(false)
      expect(isValidPort(-1)).toBe(false)
      expect(isValidPort(65536)).toBe(false)
      expect(isValidPort(1.5)).toBe(false)
      expect(isValidPort(Number.NaN)).toBe(false)
    })
  })

  describe('calculateBackoff', () => {
    it('should return increasing delays', () => {
      const delay1 = calculateBackoff(1, 1000, 30000)
      const delay2 = calculateBackoff(2, 1000, 30000)
      const delay3 = calculateBackoff(3, 1000, 30000)
      // Base delays are 2000, 4000, 8000 (plus random jitter up to 1000)
      expect(delay1).toBeGreaterThan(1000)
      expect(delay1).toBeLessThan(4000)
      expect(delay2).toBeGreaterThan(3000)
      expect(delay2).toBeLessThan(6000)
      expect(delay3).toBeGreaterThan(7000)
      expect(delay3).toBeLessThan(10000)
    })

    it('should cap at maxDelay', () => {
      const delay = calculateBackoff(20, 1000, 5000)
      // Should be capped at 5000 + up to 1000 jitter
      expect(delay).toBeLessThanOrEqual(6000)
    })
  })

  describe('incrementSubdomain', () => {
    it('should append -2 to a plain subdomain', () => {
      expect(incrementSubdomain('myapp')).toBe('myapp-2')
    })

    it('should increment an existing numeric suffix', () => {
      expect(incrementSubdomain('myapp-2')).toBe('myapp-3')
      expect(incrementSubdomain('myapp-9')).toBe('myapp-10')
    })

    it('should keep hyphenated names intact', () => {
      expect(incrementSubdomain('swift-fox')).toBe('swift-fox-2')
    })

    it('should never exceed the 63-character DNS label limit', () => {
      const long = 'a'.repeat(63)
      const next = incrementSubdomain(long)
      expect(next.length).toBeLessThanOrEqual(63)
      expect(next.endsWith('-2')).toBe(true)
      expect(isValidSubdomain(next)).toBe(true)
    })
  })

  describe('isLocalOrIpHost', () => {
    it('should recognize local and IP-literal hosts', () => {
      expect(isLocalOrIpHost('localhost')).toBe(true)
      expect(isLocalOrIpHost('myapp.localhost')).toBe(true)
      expect(isLocalOrIpHost('127.0.0.1')).toBe(true)
      expect(isLocalOrIpHost('192.168.1.10')).toBe(true)
      expect(isLocalOrIpHost('::1')).toBe(true)
    })

    it('should not match real domains', () => {
      expect(isLocalOrIpHost('localtunnel.dev')).toBe(false)
      expect(isLocalOrIpHost('api.localtunnel.dev')).toBe(false)
      expect(isLocalOrIpHost('example.com')).toBe(false)
    })
  })

  // ============================================
  // TunnelServer
  // ============================================

  describe('TunnelServer', () => {
    it('should create a server instance', () => {
      const server = new TunnelServer({ port: 0, verbose: false })
      expect(server).toBeDefined()
      expect(typeof server.start).toBe('function')
      expect(typeof server.stop).toBe('function')
      expect(typeof server.getStats).toBe('function')
    })

    it('should start and stop', async () => {
      const server = new TunnelServer({ port: 0, verbose: false })
      await server.start()

      const stats = server.getStats()
      expect(stats.connections).toBe(0)
      expect(stats.requests).toBe(0)
      expect(stats.activeSubdomains).toEqual([])

      server.stop()
    })

    it('should emit start event', async () => {
      const server = new TunnelServer({ port: 0, verbose: false })

      let startCalled = false
      server.on('start', () => {
        startCalled = true
      })

      await server.start()
      expect(startCalled).toBe(true)

      server.stop()
    })

    it('should track stats over time', async () => {
      const server = new TunnelServer({ port: 0, verbose: false })
      await server.start()

      const stats = server.getStats()
      expect(stats.startTime).toBeInstanceOf(Date)
      expect(stats.uptime).toBeGreaterThanOrEqual(0)

      server.stop()
    })
  })

  // ============================================
  // TunnelClient
  // ============================================

  describe('TunnelClient', () => {
    it('should create a client instance', () => {
      const client = new TunnelClient({
        host: 'localhost',
        port: 3000,
        localPort: 8080,
      })
      expect(client).toBeDefined()
      expect(typeof client.connect).toBe('function')
      expect(typeof client.disconnect).toBe('function')
      expect(typeof client.isConnected).toBe('function')
      expect(typeof client.getSubdomain).toBe('function')
      expect(typeof client.getTunnelUrl).toBe('function')
    })

    it('should generate a subdomain when none provided', () => {
      const client = new TunnelClient({
        host: 'localhost',
        port: 3000,
      })
      const subdomain = client.getSubdomain()
      expect(typeof subdomain).toBe('string')
      expect(subdomain.length).toBeGreaterThan(0)
    })

    it('should use provided subdomain', () => {
      const client = new TunnelClient({
        host: 'localhost',
        port: 3000,
        subdomain: 'myapp',
      })
      expect(client.getSubdomain()).toBe('myapp')
    })

    it('should construct correct tunnel URL', () => {
      const client = new TunnelClient({
        host: 'localtunnel.dev',
        port: 443,
        secure: true,
        subdomain: 'test123',
      })
      expect(client.getTunnelUrl()).toBe('https://test123.localtunnel.dev')
    })

    it('should start as disconnected', () => {
      const client = new TunnelClient({
        host: 'localhost',
        port: 3000,
      })
      expect(client.getState()).toBe('disconnected')
      expect(client.isConnected()).toBe(false)
    })

    it('should handle disconnect gracefully when not connected', () => {
      const client = new TunnelClient({
        host: 'localhost',
        port: 3000,
      })
      // Should not throw
      client.disconnect()
      expect(client.getState()).toBe('disconnected')
    })
  })

  // ============================================
  // Integration: Server + Client
  // ============================================

  describe('Integration: full roundtrip', () => {
    let server: TunnelServer
    let serverPort: number

    beforeAll(async () => {
      // Start tunnel server on a random port
      server = new TunnelServer({ port: 0, verbose: false })
      await server.start()
      // Get the actual port from the server (Bun assigns one when port: 0)
      serverPort = (server as any).server?.port || 3456
    })

    afterAll(() => {
      server.stop()
    })

    it('should allow client to connect and register', async () => {
      const client = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        secure: false,
        subdomain: 'testclient',
        timeout: 5000,
      })

      let connected = false
      client.on('connected', () => {
        connected = true
      })

      await client.connect()

      expect(connected).toBe(true)
      expect(client.isConnected()).toBe(true)
      expect(client.getSubdomain()).toBe('testclient')

      // Wait briefly for the server to process the "ready" message
      await new Promise(resolve => setTimeout(resolve, 100))

      // Server should show the connection
      const stats = server.getStats(true)
      expect(stats.activeSubdomains).toContain('testclient')

      client.disconnect()
    })

    it('should forward HTTP requests through the tunnel', async () => {
      // Start a local HTTP server to tunnel to
      const localServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(JSON.stringify({ hello: 'world' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const localPort = localServer.port

      const client = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        secure: false,
        subdomain: 'roundtrip',
        localPort,
        localHost: 'localhost',
        timeout: 5000,
      })

      await client.connect()

      // Make a request through the tunnel server
      const response = await fetch(`http://localhost:${serverPort}/test`, {
        headers: { host: `roundtrip.localhost` },
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual({ hello: 'world' })

      client.disconnect()
      localServer.stop()
    })

    it('should return 404 for unknown subdomains', async () => {
      const response = await fetch(`http://localhost:${serverPort}/test`, {
        headers: { host: 'nonexistent.localhost' },
      })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Tunnel not found')
    })

    it('should serve status endpoint', async () => {
      const response = await fetch(`http://localhost:${serverPort}/status`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
      expect(typeof body.connections).toBe('number')
    })

    it('should serve health endpoint', async () => {
      const response = await fetch(`http://localhost:${serverPort}/health`)
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toBe('OK')
    })
  })

  // ============================================
  // Integration: hardening (binary safety, forwarding, fail-fast)
  // ============================================

  describe('Integration: hardening', () => {
    let server: TunnelServer
    let serverPort: number

    beforeAll(async () => {
      server = new TunnelServer({ port: 0, verbose: false })
      await server.start()
      serverPort = (server as any).server?.port
    })

    afterAll(() => {
      server.stop()
    })

    it('should forward binary responses byte-for-byte (application/zip)', async () => {
      // Bytes that UTF-8 decoding would corrupt (0xFF, 0xFE, lone continuation bytes)
      const payload = new Uint8Array(512)
      for (let i = 0; i < payload.length; i++) payload[i] = (i * 7 + 0x80) % 256
      payload.set([0xFF, 0xFE, 0x00, 0x80], 0)

      const localServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(payload, { headers: { 'Content-Type': 'application/zip' } })
        },
      })

      const client = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        subdomain: 'binresp',
        localPort: localServer.port,
        timeout: 5000,
      })
      await client.connect()

      const response = await fetch(`http://localhost:${serverPort}/file.zip`, {
        headers: { host: 'binresp.localhost' },
      })
      expect(response.status).toBe(200)
      const received = new Uint8Array(await response.arrayBuffer())
      expect(received).toEqual(payload)

      await client.disconnect()
      localServer.stop()
    })

    it('should forward binary request bodies byte-for-byte', async () => {
      const payload = new Uint8Array(256)
      for (let i = 0; i < payload.length; i++) payload[i] = 255 - (i % 256)

      let receivedByLocal: Uint8Array | null = null
      const localServer = Bun.serve({
        port: 0,
        async fetch(req) {
          receivedByLocal = new Uint8Array(await req.arrayBuffer())
          return new Response('ok')
        },
      })

      const client = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        subdomain: 'binreq',
        localPort: localServer.port,
        timeout: 5000,
      })
      await client.connect()

      const response = await fetch(`http://localhost:${serverPort}/upload`, {
        method: 'POST',
        headers: { 'host': 'binreq.localhost', 'content-type': 'application/octet-stream' },
        body: payload,
      })
      expect(response.status).toBe(200)
      expect(receivedByLocal).toEqual(payload)

      await client.disconnect()
      localServer.stop()
    })

    it('should add x-forwarded-* headers for the local app', async () => {
      let seenHeaders: Record<string, string> = {}
      const localServer = Bun.serve({
        port: 0,
        fetch(req) {
          seenHeaders = Object.fromEntries(req.headers.entries())
          return new Response('ok')
        },
      })

      const client = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        subdomain: 'fwd',
        localPort: localServer.port,
        timeout: 5000,
      })
      await client.connect()

      const response = await fetch(`http://localhost:${serverPort}/headers`, {
        headers: { host: 'fwd.localhost' },
      })
      expect(response.status).toBe(200)
      expect(seenHeaders['x-forwarded-host']).toBe('fwd.localhost')
      expect(seenHeaders['x-forwarded-proto']).toBe('http')
      expect(seenHeaders['x-forwarded-for']).toBeTruthy()

      await client.disconnect()
      localServer.stop()
    })

    it('should fail in-flight requests fast when the client disconnects', async () => {
      // Local server that never responds within the test window
      const localServer = Bun.serve({
        port: 0,
        async fetch() {
          await new Promise(resolve => setTimeout(resolve, 10_000))
          return new Response('too late')
        },
      })

      const client = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        subdomain: 'slowpoke',
        localPort: localServer.port,
        timeout: 5000,
      })
      await client.connect()

      const started = Date.now()
      const pending = fetch(`http://localhost:${serverPort}/slow`, {
        headers: { host: 'slowpoke.localhost' },
      })

      // Give the request time to reach the client, then drop the tunnel
      await new Promise(resolve => setTimeout(resolve, 150))
      await client.disconnect()

      const response = await pending
      expect(response.status).toBe(502)
      // Must resolve via fail-fast, not the 30s gateway timeout
      expect(Date.now() - started).toBeLessThan(3000)

      localServer.stop()
    })

    it('should redact credential headers in the devtools request log', async () => {
      const localServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response('ok')
        },
      })

      const client = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        subdomain: 'redact',
        localPort: localServer.port,
        timeout: 5000,
      })
      await client.connect()

      await fetch(`http://localhost:${serverPort}/private`, {
        headers: {
          'host': 'redact.localhost',
          'authorization': 'Bearer super-secret-token',
          'cookie': 'session=abc123',
          'x-request-id': 'keep-me',
        },
      })

      const logs = await (await fetch(`http://localhost:${serverPort}/devtools/api/requests`, {
        headers: { host: 'redact.localhost' },
      })).json() as Array<{ headers: Record<string, string> }>

      expect(logs.length).toBeGreaterThan(0)
      const entry = logs[logs.length - 1]
      expect(entry.headers.authorization).toBe('<redacted>')
      expect(entry.headers.cookie).toBe('<redacted>')
      expect(entry.headers['x-request-id']).toBe('keep-me')

      await client.disconnect()
      localServer.stop()
    })

    it('should reject connect() fast when the server refuses the subdomain', async () => {
      const client = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        subdomain: 'Not_Valid!',
        localPort: 9999,
        timeout: 30_000, // deliberately long — rejection must not wait for it
      })

      client.on('error', () => {}) // avoid unhandled 'error' event

      const started = Date.now()
      await expect(client.connect()).rejects.toThrow('Invalid subdomain')
      expect(Date.now() - started).toBeLessThan(3000)
    })

    it('should resolve the taken-subdomain collision with a suffixed name', async () => {
      const localServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response('ok')
        },
      })

      const first = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        subdomain: 'popular',
        localPort: localServer.port,
        timeout: 5000,
      })
      const second = new TunnelClient({
        host: 'localhost',
        port: serverPort,
        subdomain: 'popular',
        localPort: localServer.port,
        timeout: 5000,
      })

      await first.connect()
      await second.connect()

      expect(first.getSubdomain()).toBe('popular')
      expect(second.getSubdomain()).toBe('popular-2')

      await second.disconnect()
      await first.disconnect()
      localServer.stop()
    })
  })

  // ============================================
  // On-demand TLS `ask` endpoint
  // ============================================

  describe('on-demand TLS check', () => {
    it('isKnownHost recognizes apex, api host, and active subdomains', async () => {
      const server = new TunnelServer({ port: 0, domain: 'localtunnel.dev', verbose: false })
      await server.start()

      try {
        // Apex + api host always allowed.
        expect(server.isKnownHost('localtunnel.dev')).toBe(true)
        expect(server.isKnownHost('api.localtunnel.dev')).toBe(true)
        // Strips port suffixes and is case-insensitive.
        expect(server.isKnownHost('LocalTunnel.dev:443')).toBe(true)

        // No tunnel registered yet → unknown subdomain refused.
        expect(server.isKnownHost('myapp.localtunnel.dev')).toBe(false)

        // Register a fake active subdomain in the in-memory registry.
        ;(server as any).subdomainSockets.set('myapp', new Set([{}]))
        expect(server.isKnownHost('myapp.localtunnel.dev')).toBe(true)

        // Nested subdomains and unrelated hosts are refused.
        expect(server.isKnownHost('a.myapp.localtunnel.dev')).toBe(false)
        expect(server.isKnownHost('evil.com')).toBe(false)
        expect(server.isKnownHost('')).toBe(false)
      }
      finally {
        server.stop()
      }
    })

    it('responds 200/404 over HTTP for the Caddy ask endpoint', async () => {
      const server = new TunnelServer({ port: 0, domain: 'localtunnel.dev', verbose: false })
      await server.start()
      const port = (server as any).server?.port

      try {
        ;(server as any).subdomainSockets.set('live', new Set([{}]))

        const ok = await fetch(`http://localhost:${port}/tls-check?domain=live.localtunnel.dev`)
        expect(ok.status).toBe(200)

        const apex = await fetch(`http://localhost:${port}/tls-check?domain=localtunnel.dev`)
        expect(apex.status).toBe(200)

        const missing = await fetch(`http://localhost:${port}/tls-check?domain=ghost.localtunnel.dev`)
        expect(missing.status).toBe(404)

        const noParam = await fetch(`http://localhost:${port}/tls-check`)
        expect(noParam.status).toBe(404)
      }
      finally {
        server.stop()
      }
    })
  })
})

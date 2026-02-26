import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { TunnelClient, TunnelServer } from '../src/tunnel'
import { calculateBackoff, generateId, isValidPort, isValidSubdomain } from '../src/utils'

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
})

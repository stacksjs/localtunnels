import type { ServerWebSocket } from 'bun'
import { EventEmitter } from 'node:events'
import { debugLog, generateId, calculateBackoff, delay } from './utils'

interface TunnelOptions {
  port?: number
  host?: string
  secure?: boolean
  verbose?: boolean
  localPort?: number
  localHost?: string
  subdomain?: string
}

interface WebSocketData {
  subdomain: string
}

interface TunnelStats {
  connections: number
  requests: number
  startTime: Date
}

export class TunnelServer extends EventEmitter {
  private server: ReturnType<typeof Bun.serve> | null = null
  private options: Required<TunnelOptions>
  private responseHandlers: Map<string, (response: any) => void> = new Map()
  private subdomainSockets: Map<string, Set<ServerWebSocket<WebSocketData>>> = new Map()
  private stats: TunnelStats = {
    connections: 0,
    requests: 0,
    startTime: new Date(),
  }

  constructor(options: TunnelOptions = {}) {
    super()
    this.options = {
      port: options.port || 3000,
      host: options.host || '0.0.0.0',
      secure: options.secure || false,
      verbose: options.verbose || false,
      localPort: options.localPort || 8000,
      localHost: options.localHost || 'localhost',
      subdomain: options.subdomain || '',
    }
  }

  private addSocket(subdomain: string, socket: ServerWebSocket<WebSocketData>) {
    if (!this.subdomainSockets.has(subdomain)) {
      this.subdomainSockets.set(subdomain, new Set())
    }
    this.subdomainSockets.get(subdomain)?.add(socket)
    this.stats.connections++
    this.emit('connection', { subdomain, totalConnections: this.stats.connections })
  }

  private removeSocket(subdomain: string, socket: ServerWebSocket<WebSocketData>) {
    this.subdomainSockets.get(subdomain)?.delete(socket)
    if (this.subdomainSockets.get(subdomain)?.size === 0) {
      this.subdomainSockets.delete(subdomain)
    }
    this.emit('disconnection', { subdomain })
  }

  private getSocketForSubdomain(subdomain: string): ServerWebSocket<WebSocketData> | undefined {
    const sockets = this.subdomainSockets.get(subdomain)
    if (sockets && sockets.size > 0) {
      // Return the first available socket (round-robin could be added later)
      return sockets.values().next().value
    }
    return undefined
  }

  public getStats() {
    return {
      ...this.stats,
      activeSubdomains: Array.from(this.subdomainSockets.keys()),
      uptime: Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000),
    }
  }

  public async start(): Promise<void> {
    this.stats.startTime = new Date()

    this.server = Bun.serve<WebSocketData>({
      port: this.options.port,
      hostname: this.options.host,
      development: true,

      fetch: async (req, server) => {
        const url = new URL(req.url)
        const host = req.headers.get('host') || ''
        const subdomain = host.split('.')[0]

        // Handle status endpoint
        if (url.pathname === '/status' || url.pathname === '/_status') {
          const stats = this.getStats()
          return new Response(JSON.stringify({
            status: 'ok',
            version: '0.1.1',
            connections: this.subdomainSockets.size,
            requests: stats.requests,
            uptime: `${stats.uptime}s`,
            activeSubdomains: stats.activeSubdomains,
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Handle health check
        if (url.pathname === '/health' || url.pathname === '/_health') {
          return new Response('OK', { status: 200 })
        }

        debugLog('server', `Received request for subdomain: ${subdomain}, path: ${url.pathname}`, this.options.verbose)

        // Handle WebSocket upgrade
        if (req.headers.get('upgrade') === 'websocket') {
          debugLog('server', `Upgrading connection for client`, this.options.verbose)
          const upgraded = server.upgrade(req, {
            data: { subdomain },
          })
          return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
        }

        // Forward HTTP request to connected client
        if (subdomain && this.subdomainSockets.has(subdomain)) {
          this.stats.requests++
          debugLog('server', `Publishing HTTP request to subdomain: ${subdomain}`, this.options.verbose)

          return new Promise<Response>(async (resolve, reject) => {
            const requestId = generateId(12)

            this.responseHandlers.set(requestId, (responseData) => {
              const headers = new Headers(responseData.headers || {})
              // Remove content-encoding if present to avoid double-encoding issues
              headers.delete('content-encoding')
              headers.delete('transfer-encoding')

              resolve(new Response(responseData.body, {
                status: responseData.status,
                headers,
              }))
            })

            // Read request body if present
            let body: string | undefined
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              try {
                body = await req.text()
              }
              catch {
                // Body might be empty or not readable
              }
            }

            const message = {
              type: 'request',
              id: requestId,
              method: req.method,
              url: url.toString(),
              path: url.pathname + url.search,
              headers: Object.fromEntries(req.headers),
              body,
            }

            const socket = this.getSocketForSubdomain(subdomain)
            if (socket) {
              socket.send(JSON.stringify(message))
            }
            else {
              this.responseHandlers.delete(requestId)
              resolve(new Response('No tunnel client connected', { status: 502 }))
            }

            // Set timeout for response
            setTimeout(() => {
              if (this.responseHandlers.has(requestId)) {
                this.responseHandlers.delete(requestId)
                resolve(new Response('Gateway timeout - tunnel client did not respond', { status: 504 }))
              }
            }, 30000)
          }).catch(err => new Response(`Tunnel error: ${err.message}`, { status: 502 }))
        }

        // No tunnel client for this subdomain
        return new Response(`No tunnel found for subdomain: ${subdomain}`, { status: 404 })
      },

      websocket: {
        message: (ws, message) => {
          try {
            const data = JSON.parse(String(message))
            debugLog('server', `Received WebSocket message: ${data.type}`, this.options.verbose)

            if (data.type === 'ready') {
              const subdomain = data.subdomain
              ws.data.subdomain = subdomain
              this.addSocket(subdomain, ws)
              debugLog('server', `Client ${subdomain} is ready`, this.options.verbose)

              // Confirm registration
              ws.send(JSON.stringify({
                type: 'registered',
                subdomain,
              }))
            }
            else if (data.type === 'response') {
              const handler = this.responseHandlers.get(data.id)
              if (handler) {
                handler(data)
                this.responseHandlers.delete(data.id)
              }
            }
            else if (data.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }))
            }
          }
          catch (err) {
            debugLog('server', `Error handling message: ${err}`, this.options.verbose, 'error')
          }
        },

        open: (ws) => {
          debugLog('server', `WebSocket opened`, this.options.verbose)
          ws.send(JSON.stringify({ type: 'connected' }))
        },

        close: (ws) => {
          if (ws.data.subdomain) {
            debugLog('server', `WebSocket closed for subdomain: ${ws.data.subdomain}`, this.options.verbose)
            this.removeSocket(ws.data.subdomain, ws)
          }
        },

        drain: (ws) => {
          debugLog('server', `WebSocket drain for subdomain: ${ws.data?.subdomain}`, this.options.verbose)
        },
      },
    })

    debugLog('server', `Server started on ${this.options.host}:${this.options.port}`, this.options.verbose)
    this.emit('start', { host: this.options.host, port: this.options.port })
  }

  public stop(): void {
    if (this.server) {
      this.server.stop()
      debugLog('server', 'Server stopped', this.options.verbose)
      this.emit('stop')
    }
  }
}

export class TunnelClient extends EventEmitter {
  private ws: WebSocket | null = null
  private options: Required<TunnelOptions>
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private shouldReconnect = true
  private connected = false

  constructor(options: TunnelOptions = {}) {
    super()
    this.options = {
      port: options.port || 3000,
      host: options.host || 'localhost',
      secure: options.secure || false,
      verbose: options.verbose || false,
      localPort: options.localPort || 8000,
      localHost: options.localHost || 'localhost',
      subdomain: options.subdomain || generateId(8),
    }
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = this.options.secure ? 'wss' : 'ws'
      const url = `${protocol}://${this.options.host}:${this.options.port}`

      debugLog('client', `Connecting to WebSocket server at ${url}`, this.options.verbose)

      this.ws = new WebSocket(url)

      const timeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          debugLog('client', 'Connection timeout', this.options.verbose)
          this.ws?.close()
          reject(new Error('Connection timeout'))
        }
      }, 10000)

      this.ws.addEventListener('open', () => {
        clearTimeout(timeout)
        this.connected = true
        this.reconnectAttempts = 0
        debugLog('client', 'Connected to tunnel server', this.options.verbose)

        // Send ready message with subdomain
        this.ws?.send(JSON.stringify({
          type: 'ready',
          subdomain: this.options.subdomain,
        }))

        this.emit('connected', {
          url: `${this.options.secure ? 'https' : 'http'}://${this.options.subdomain}.${this.options.host}`,
          subdomain: this.options.subdomain,
        })

        resolve()
      })

      this.ws.addEventListener('message', async (event) => {
        try {
          const data = JSON.parse(event.data as string)
          debugLog('client', `Received message: ${data.type}`, this.options.verbose)

          if (data.type === 'request') {
            await this.handleRequest(data)
          }
          else if (data.type === 'registered') {
            debugLog('client', `Registered with subdomain: ${data.subdomain}`, this.options.verbose)
          }
          else if (data.type === 'pong') {
            debugLog('client', 'Received pong', this.options.verbose)
          }
        }
        catch (err) {
          debugLog('client', `Error handling message: ${err}`, this.options.verbose, 'error')
        }
      })

      this.ws.addEventListener('close', async () => {
        clearTimeout(timeout)
        this.connected = false
        debugLog('client', 'Disconnected from tunnel server', this.options.verbose)
        this.emit('close')

        // Attempt reconnection
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          const backoff = calculateBackoff(this.reconnectAttempts)
          debugLog('client', `Reconnecting in ${Math.round(backoff / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, this.options.verbose)
          this.emit('reconnecting', { attempt: this.reconnectAttempts, delay: backoff })

          await delay(backoff)
          if (this.shouldReconnect) {
            try {
              await this.connect()
            }
            catch (err) {
              debugLog('client', `Reconnection failed: ${err}`, this.options.verbose, 'error')
            }
          }
        }

        this.ws = null
      })

      this.ws.addEventListener('error', (error) => {
        clearTimeout(timeout)
        debugLog('client', `WebSocket error: ${error}`, this.options.verbose, 'error')
        this.emit('error', error)
        if (!this.connected) {
          reject(error)
        }
      })

      // Start ping interval to keep connection alive
      this.startPing()
    })
  }

  private startPing() {
    const pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
      else {
        clearInterval(pingInterval)
      }
    }, 25000)
  }

  private async handleRequest(data: any) {
    const requestUrl = new URL(data.url)
    const localUrl = `http://${this.options.localHost}:${this.options.localPort}${data.path || requestUrl.pathname + requestUrl.search}`

    debugLog('client', `Forwarding ${data.method} ${data.path || requestUrl.pathname} to: ${localUrl}`, this.options.verbose)

    this.emit('request', {
      method: data.method,
      url: data.path || requestUrl.pathname,
    })

    try {
      // Prepare headers, removing problematic ones
      const headers = new Headers()
      for (const [key, value] of Object.entries(data.headers || {})) {
        // Skip headers that shouldn't be forwarded
        if (['host', 'connection', 'upgrade', 'content-length'].includes(key.toLowerCase())) {
          continue
        }
        headers.set(key, value as string)
      }

      const fetchOptions: RequestInit = {
        method: data.method,
        headers,
      }

      // Add body for non-GET/HEAD requests
      if (data.method !== 'GET' && data.method !== 'HEAD' && data.body) {
        fetchOptions.body = data.body
      }

      const response = await fetch(localUrl, fetchOptions)

      const responseBody = await response.text()
      debugLog('client', `Response: ${response.status} (${responseBody.length} bytes)`, this.options.verbose)

      // Convert headers to plain object
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        // Skip problematic headers
        if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          responseHeaders[key] = value
        }
      })

      this.ws?.send(JSON.stringify({
        type: 'response',
        id: data.id,
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      }))

      this.emit('response', {
        status: response.status,
        size: responseBody.length,
      })
    }
    catch (err: any) {
      debugLog('client', `Error forwarding request: ${err.message}`, this.options.verbose, 'error')

      this.ws?.send(JSON.stringify({
        type: 'response',
        id: data.id,
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
        body: `Bad Gateway: Could not connect to local server at ${this.options.localHost}:${this.options.localPort}`,
      }))

      this.emit('error', err)
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  public isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  public getSubdomain(): string {
    return this.options.subdomain
  }
}

/**
 * Start a local tunnel with the given options
 * This is a convenience function for quick usage
 */
export async function startLocalTunnel(options: {
  port: number
  subdomain?: string
  host?: string
  server?: string
  verbose?: boolean
  onConnect?: (info: { url: string; subdomain: string }) => void
  onRequest?: (req: { method: string; url: string }) => void
  onError?: (error: Error) => void
}): Promise<TunnelClient> {
  const serverHost = options.server?.replace(/^(wss?|https?):\/\//, '') || 'localtunnel.dev'
  const secure = options.server?.startsWith('wss://') || options.server?.startsWith('https://') || serverHost === 'localtunnel.dev'

  const client = new TunnelClient({
    host: serverHost,
    port: secure ? 443 : 80,
    secure,
    verbose: options.verbose,
    localPort: options.port,
    localHost: options.host || 'localhost',
    subdomain: options.subdomain,
  })

  if (options.onConnect) {
    client.on('connected', options.onConnect)
  }

  if (options.onRequest) {
    client.on('request', options.onRequest)
  }

  if (options.onError) {
    client.on('error', options.onError)
  }

  await client.connect()

  return client
}

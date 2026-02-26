import type { ServerWebSocket } from 'bun'
import type { ClientState, ServerStats, TunnelOptions, TunnelRequest } from './types'
import { EventEmitter } from 'node:events'
import { calculateBackoff, debugLog, delay, generateId, isValidSubdomain } from './utils'

// Internal options type with ssl being optional
type ResolvedTunnelOptions = Omit<Required<TunnelOptions>, 'ssl'> & { ssl?: TunnelOptions['ssl'] }

interface WebSocketData {
  subdomain: string
  connectedAt: number
  lastSeen: number
}

interface InternalStats extends ServerStats {
  bytesIn: number
  bytesOut: number
}

// ============================================
// TunnelServer - Self-hosted server mode
// ============================================

export class TunnelServer extends EventEmitter {
  private server: ReturnType<typeof Bun.serve> | null = null
  private options: ResolvedTunnelOptions
  private responseHandlers: Map<string, (response: any) => void> = new Map()
  private subdomainSockets: Map<string, Set<ServerWebSocket<WebSocketData>>> = new Map()
  private stats: InternalStats = {
    connections: 0,
    requests: 0,
    startTime: new Date(),
    uptime: 0,
    activeSubdomains: [],
    bytesIn: 0,
    bytesOut: 0,
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
      timeout: options.timeout || 30000,
      maxReconnectAttempts: options.maxReconnectAttempts || 10,
      apiKey: options.apiKey || '',
      ...(options.ssl ? { ssl: options.ssl } : {}),
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
      // Simple round-robin: get first and move to end
      const socketArray = Array.from(sockets)
      const socket = socketArray[0]

      // Update last seen
      if (socket.data) {
        socket.data.lastSeen = Date.now()
      }

      return socket
    }
    return undefined
  }

  private async forwardRequest(req: Request, url: URL, subdomain: string): Promise<Response> {
    const requestId = generateId(12)
    const startTime = Date.now()

    // Read request body if present
    let body: string | undefined
    let isBase64Encoded = false
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const contentType = req.headers.get('content-type') || ''
        // Check if binary content
        if (contentType.includes('application/octet-stream')
          || contentType.includes('image/')
          || contentType.includes('audio/')
          || contentType.includes('video/')) {
          const buffer = await req.arrayBuffer()
          body = btoa(String.fromCharCode(...new Uint8Array(buffer)))
          isBase64Encoded = true
          this.stats.bytesIn += buffer.byteLength
        }
        else {
          body = await req.text()
          this.stats.bytesIn += body.length
        }
      }
      catch {
        // Body might be empty or not readable
      }
    }

    const message: TunnelRequest = {
      type: 'request',
      id: requestId,
      method: req.method,
      url: url.toString(),
      path: url.pathname + url.search,
      headers: Object.fromEntries(req.headers),
      body,
      isBase64Encoded,
    }

    const socket = this.getSocketForSubdomain(subdomain)
    if (!socket) {
      return new Response('No tunnel client connected', { status: 502 })
    }

    return new Promise<Response>((resolve) => {
      // Set up response handler
      this.responseHandlers.set(requestId, (responseData) => {
        const headers = new Headers(responseData.headers || {})
        // Remove content-encoding if present to avoid double-encoding issues
        headers.delete('content-encoding')
        headers.delete('transfer-encoding')

        // Track response size
        const bodySize = responseData.body?.length || 0
        this.stats.bytesOut += bodySize

        debugLog('server', `Response for ${requestId}: ${responseData.status} (${bodySize} bytes, ${Date.now() - startTime}ms)`, this.options.verbose)

        // Handle binary responses
        let responseBody: string | Uint8Array = responseData.body || ''
        if (responseData.isBase64Encoded && typeof responseBody === 'string') {
          responseBody = Uint8Array.from(atob(responseBody), c => c.charCodeAt(0))
        }

        resolve(new Response(responseBody, {
          status: responseData.status,
          headers,
        }))
      })

      socket.send(JSON.stringify(message))

      // Set timeout for response
      setTimeout(() => {
        if (this.responseHandlers.has(requestId)) {
          this.responseHandlers.delete(requestId)
          resolve(new Response('Gateway timeout - tunnel client did not respond', { status: 504 }))
        }
      }, this.options.timeout)
    })
  }

  public getStats(): ServerStats {
    return {
      connections: this.stats.connections,
      requests: this.stats.requests,
      startTime: this.stats.startTime,
      uptime: Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000),
      activeSubdomains: Array.from(this.subdomainSockets.keys()),
    }
  }

  public async start(): Promise<void> {
    this.stats.startTime = new Date()

    // Build TLS config if ssl options are provided
    const tlsConfig = this.options.ssl
      ? {
          key: Bun.file(this.options.ssl.key),
          cert: Bun.file(this.options.ssl.cert),
          ...(this.options.ssl.ca ? { ca: Bun.file(this.options.ssl.ca) } : {}),
        }
      : undefined

    this.server = Bun.serve<WebSocketData>({
      port: this.options.port,
      hostname: this.options.host,
      development: false,
      ...(tlsConfig ? { tls: tlsConfig } : {}),

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

        // Handle metrics endpoint (Prometheus format)
        if (url.pathname === '/metrics' || url.pathname === '/_metrics') {
          const stats = this.getStats()
          const metrics = [
            `# HELP tunnel_connections_total Total number of connections`,
            `# TYPE tunnel_connections_total counter`,
            `tunnel_connections_total ${stats.connections}`,
            `# HELP tunnel_requests_total Total number of requests`,
            `# TYPE tunnel_requests_total counter`,
            `tunnel_requests_total ${stats.requests}`,
            `# HELP tunnel_active_subdomains Current number of active subdomains`,
            `# TYPE tunnel_active_subdomains gauge`,
            `tunnel_active_subdomains ${stats.activeSubdomains.length}`,
            `# HELP tunnel_uptime_seconds Server uptime in seconds`,
            `# TYPE tunnel_uptime_seconds gauge`,
            `tunnel_uptime_seconds ${stats.uptime}`,
          ].join('\n')
          return new Response(metrics, {
            headers: { 'Content-Type': 'text/plain' },
          })
        }

        debugLog('server', `Received request for subdomain: ${subdomain}, path: ${url.pathname}`, this.options.verbose)

        // Handle WebSocket upgrade
        if (req.headers.get('upgrade') === 'websocket') {
          debugLog('server', `Upgrading connection for client`, this.options.verbose)
          const upgraded = server.upgrade(req, {
            data: {
              subdomain: '',
              connectedAt: Date.now(),
              lastSeen: Date.now(),
            },
          })
          return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
        }

        // Forward HTTP request to connected client
        if (subdomain && this.subdomainSockets.has(subdomain)) {
          this.stats.requests++
          debugLog('server', `Publishing HTTP request to subdomain: ${subdomain}`, this.options.verbose)

          return this.forwardRequest(req, url, subdomain)
        }

        // No tunnel client for this subdomain
        return new Response(JSON.stringify({
          error: 'Tunnel not found',
          subdomain,
          message: `No tunnel client is connected for subdomain: ${subdomain}`,
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      },

      websocket: {
        message: (ws, message) => {
          try {
            const data = JSON.parse(String(message))
            debugLog('server', `Received WebSocket message: ${data.type}`, this.options.verbose)

            if (data.type === 'ready') {
              const subdomain = data.subdomain

              // Validate subdomain
              if (!subdomain || !isValidSubdomain(subdomain)) {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Invalid subdomain format',
                }))
                return
              }

              ws.data.subdomain = subdomain
              this.addSocket(subdomain, ws)
              debugLog('server', `Client ${subdomain} is ready`, this.options.verbose)

              // Confirm registration
              ws.send(JSON.stringify({
                type: 'registered',
                subdomain,
                url: `${this.options.secure ? 'https' : 'http'}://${subdomain}.${this.options.host}`,
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
              ws.data.lastSeen = Date.now()
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

// ============================================
// TunnelClient - Connects to tunnel server
// ============================================

export class TunnelClient extends EventEmitter {
  private ws: WebSocket | null = null
  private options: ResolvedTunnelOptions
  private reconnectAttempts = 0
  private shouldReconnect = true
  private state: ClientState = 'disconnected'
  private pingInterval: ReturnType<typeof setInterval> | null = null

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
      timeout: options.timeout || 10000,
      maxReconnectAttempts: options.maxReconnectAttempts || 10,
      apiKey: options.apiKey || '',
    }
  }

  public getState(): ClientState {
    return this.state
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.state = 'connecting'

      const protocol = this.options.secure ? 'wss' : 'ws'
      let url = `${protocol}://${this.options.host}`

      // Add port if not default
      if ((this.options.secure && this.options.port !== 443)
        || (!this.options.secure && this.options.port !== 80)) {
        url += `:${this.options.port}`
      }

      // Add subdomain as query parameter for initial connection
      url += `?subdomain=${encodeURIComponent(this.options.subdomain)}`

      debugLog('client', `Connecting to WebSocket server at ${url}`, this.options.verbose)

      this.ws = new WebSocket(url)

      const timeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          debugLog('client', 'Connection timeout', this.options.verbose)
          this.ws?.close()
          this.state = 'error'
          reject(new Error('Connection timeout'))
        }
      }, this.options.timeout)

      this.ws.addEventListener('open', () => {
        clearTimeout(timeout)
        this.state = 'connected'
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
          tunnelServer: this.options.host,
        })

        // Start ping interval
        this.startPing()

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
          else if (data.type === 'error') {
            debugLog('client', `Server error: ${data.message}`, this.options.verbose, 'error')
            this.emit('error', new Error(data.message))
          }
        }
        catch (err) {
          debugLog('client', `Error handling message: ${err}`, this.options.verbose, 'error')
        }
      })

      this.ws.addEventListener('close', async () => {
        clearTimeout(timeout)
        this.stopPing()
        this.state = 'disconnected'
        debugLog('client', 'Disconnected from tunnel server', this.options.verbose)
        this.emit('close')

        // Attempt reconnection
        if (this.shouldReconnect && this.reconnectAttempts < this.options.maxReconnectAttempts) {
          this.state = 'reconnecting'
          this.reconnectAttempts++
          const backoff = calculateBackoff(this.reconnectAttempts)
          debugLog('client', `Reconnecting in ${Math.round(backoff / 1000)}s (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`, this.options.verbose)
          this.emit('reconnecting', {
            attempt: this.reconnectAttempts,
            delay: backoff,
            maxAttempts: this.options.maxReconnectAttempts,
          })

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
        if (this.state === 'connecting') {
          this.state = 'error'
          reject(error)
        }
      })
    })
  }

  private startPing() {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 25000)
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private async handleRequest(data: TunnelRequest) {
    const requestUrl = new URL(data.url)
    const localUrl = `http://${this.options.localHost}:${this.options.localPort}${data.path || requestUrl.pathname + requestUrl.search}`
    const startTime = Date.now()

    debugLog('client', `Forwarding ${data.method} ${data.path || requestUrl.pathname} to: ${localUrl}`, this.options.verbose)

    this.emit('request', {
      method: data.method,
      url: data.path || requestUrl.pathname,
      path: data.path,
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
        // Handle base64 encoded binary data
        if (data.isBase64Encoded) {
          fetchOptions.body = Uint8Array.from(atob(data.body), c => c.charCodeAt(0))
        }
        else {
          fetchOptions.body = data.body
        }
      }

      const response = await fetch(localUrl, fetchOptions)

      // Check content type for binary responses
      const contentType = response.headers.get('content-type') || ''
      let responseBody: string
      let isBase64Encoded = false

      if (contentType.includes('application/octet-stream')
        || contentType.includes('image/')
        || contentType.includes('audio/')
        || contentType.includes('video/')
        || contentType.includes('application/pdf')) {
        const buffer = await response.arrayBuffer()
        responseBody = btoa(String.fromCharCode(...new Uint8Array(buffer)))
        isBase64Encoded = true
      }
      else {
        responseBody = await response.text()
      }

      const duration = Date.now() - startTime
      debugLog('client', `Response: ${response.status} (${responseBody.length} bytes, ${duration}ms)`, this.options.verbose)

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
        isBase64Encoded,
      }))

      this.emit('response', {
        status: response.status,
        size: responseBody.length,
        duration,
      })
    }
    catch (err: any) {
      const duration = Date.now() - startTime
      debugLog('client', `Error forwarding request: ${err.message}`, this.options.verbose, 'error')

      this.ws?.send(JSON.stringify({
        type: 'response',
        id: data.id,
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Bad Gateway',
          message: `Could not connect to local server at ${this.options.localHost}:${this.options.localPort}`,
          details: err.message,
        }),
      }))

      this.emit('error', err)
      this.emit('response', {
        status: 502,
        size: 0,
        duration,
      })
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false
    this.stopPing()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.state = 'disconnected'
    this.emit('disconnected')
  }

  public isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  public getSubdomain(): string {
    return this.options.subdomain
  }

  public getTunnelUrl(): string {
    return `${this.options.secure ? 'https' : 'http'}://${this.options.subdomain}.${this.options.host}`
  }
}

// ============================================
// Convenience function for quick usage
// ============================================

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
  timeout?: number
  maxReconnectAttempts?: number
  onConnect?: (info: { url: string, subdomain: string }) => void
  onRequest?: (req: { method: string, url: string }) => void
  onResponse?: (res: { status: number, size: number, duration?: number }) => void
  onError?: (error: Error) => void
  onReconnecting?: (info: { attempt: number, delay: number }) => void
}): Promise<TunnelClient> {
  const serverHost = options.server?.replace(/^(wss?|https?):\/\//, '') || 'localtunnel.dev'
  const secure = options.server?.startsWith('wss://')
    || options.server?.startsWith('https://')
    || serverHost === 'localtunnel.dev'

  const client = new TunnelClient({
    host: serverHost,
    port: secure ? 443 : 80,
    secure,
    verbose: options.verbose,
    localPort: options.port,
    localHost: options.host || 'localhost',
    subdomain: options.subdomain,
    ...(options.timeout ? { timeout: options.timeout } : {}),
    ...(options.maxReconnectAttempts ? { maxReconnectAttempts: options.maxReconnectAttempts } : {}),
  })

  if (options.onConnect) {
    client.on('connected', options.onConnect)
  }

  if (options.onRequest) {
    client.on('request', options.onRequest)
  }

  if (options.onResponse) {
    client.on('response', options.onResponse)
  }

  if (options.onError) {
    client.on('error', options.onError)
  }

  if (options.onReconnecting) {
    client.on('reconnecting', options.onReconnecting)
  }

  await client.connect()

  return client
}

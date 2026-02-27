import type { ServerWebSocket } from 'bun'
import type { ClientState, ServerStats, TunnelOptions, TunnelRequest } from './types'
import { EventEmitter } from 'node:events'
import { canSystemConnect, cleanupMacOSResolver, ensureMacOSResolver, resolveHostname } from './hosts'
import { calculateBackoff, debugLog, delay, generateSubdomain, isValidSubdomain } from './utils'

// Internal options type with ssl being optional
type ResolvedTunnelOptions = Omit<Required<TunnelOptions>, 'ssl' | 'manageHosts'> & { ssl?: TunnelOptions['ssl'], manageHosts: boolean }

// Scalability limits
const MAX_CONNECTIONS_PER_SUBDOMAIN = 5
const MAX_TOTAL_CONNECTIONS = 10_000
const IDLE_TIMEOUT_MS = 60 * 1000 // 1 minute
const IDLE_CLEANUP_INTERVAL_MS = 15 * 1000 // check every 15 seconds
const MAX_PAYLOAD_SIZE = 64 * 1024 * 1024 // 64MB

// Pre-cached JSON strings for static control messages (avoid JSON.stringify on every call)
const MSG_PONG = '{"type":"pong"}'
const MSG_CONNECTED = '{"type":"connected"}'
const MSG_PING = '{"type":"ping"}'
const MSG_ERR_INVALID_SUBDOMAIN = '{"type":"error","message":"Invalid subdomain format"}'
const MSG_ERR_CONN_LIMIT = '{"type":"error","message":"Connection limit reached"}'

// Header names to skip when forwarding requests (Set for O(1) lookup)
const SKIP_REQUEST_HEADERS = new Set(['host', 'connection', 'upgrade', 'content-length'])

// Header names to skip when forwarding responses
const SKIP_RESPONSE_HEADERS = new Set(['content-encoding', 'transfer-encoding', 'connection', 'content-length'])

// Binary content-type detection — shared between server and client
function isBinaryContentType(contentType: string): boolean {
  return contentType.includes('application/octet-stream')
    || contentType.includes('image/')
    || contentType.includes('audio/')
    || contentType.includes('video/')
    || contentType.includes('application/pdf')
}

// Fast path extraction from a full URL string (avoids new URL() ~230ns overhead)
// Input: "http://host:port/path?query" → "/path?query"
function extractPath(url: string): string {
  // Skip past the protocol + "://" and the host portion to find the path
  const pathStart = url.indexOf('/', url.indexOf('//') + 2)
  return pathStart === -1 ? '/' : url.substring(pathStart)
}

// Fast subdomain extraction (avoids split('.') array allocation)
function extractSubdomain(host: string): string {
  const dotIdx = host.indexOf('.')
  return dotIdx === -1 ? host : host.substring(0, dotIdx)
}

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
  private requestCounter = 0
  private responseHandlers: Map<number, (response: any) => void> = new Map()
  private responseTimeouts: Map<number, ReturnType<typeof setTimeout>> = new Map()
  private subdomainSockets: Map<string, Set<ServerWebSocket<WebSocketData>>> = new Map()
  private idleCleanupInterval: ReturnType<typeof setInterval> | null = null
  private activeConnections = 0
  private totalConnections = 0
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
      manageHosts: false,
      ...(options.ssl ? { ssl: options.ssl } : {}),
    }
  }

  private addSocket(subdomain: string, socket: ServerWebSocket<WebSocketData>): boolean {
    // Global connection limit
    if (this.activeConnections >= MAX_TOTAL_CONNECTIONS) {
      debugLog('server', `Rejected connection for ${subdomain}: global limit reached (${this.activeConnections})`, this.options.verbose, 'error')
      return false
    }

    if (!this.subdomainSockets.has(subdomain)) {
      this.subdomainSockets.set(subdomain, new Set())
    }

    const sockets = this.subdomainSockets.get(subdomain)!
    // Per-subdomain connection limit
    if (sockets.size >= MAX_CONNECTIONS_PER_SUBDOMAIN) {
      debugLog('server', `Rejected connection for ${subdomain}: per-subdomain limit reached (${sockets.size})`, this.options.verbose, 'error')
      return false
    }

    sockets.add(socket)
    this.activeConnections++
    this.totalConnections++
    this.stats.connections = this.activeConnections
    this.emit('connection', { subdomain, totalConnections: this.activeConnections })
    return true
  }

  private removeSocket(subdomain: string, socket: ServerWebSocket<WebSocketData>) {
    const sockets = this.subdomainSockets.get(subdomain)
    if (sockets) {
      sockets.delete(socket)
      if (sockets.size === 0) {
        this.subdomainSockets.delete(subdomain)
      }
    }
    this.activeConnections = Math.max(0, this.activeConnections - 1)
    this.stats.connections = this.activeConnections
    this.emit('disconnection', { subdomain })
  }

  private getSocketForSubdomain(subdomain: string): ServerWebSocket<WebSocketData> | undefined {
    const sockets = this.subdomainSockets.get(subdomain)
    if (!sockets || sockets.size === 0) return undefined

    // Find the first socket that is still open (readyState check)
    // Bun ServerWebSocket doesn't expose readyState, so we rely on
    // the close handler + removeSocket to keep the set clean.
    // But as a safety measure, try sending and let the caller handle errors.
    const iter = sockets.values()
    const first = iter.next().value
    if (first?.data) first.data.lastSeen = Date.now()
    return first
  }

  private async forwardRequest(req: Request, path: string, subdomain: string): Promise<Response> {
    const requestId = ++this.requestCounter
    const startTime = Date.now()

    // Read request body if present
    let body: string | undefined
    let isBase64Encoded = false
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const contentType = req.headers.get('content-type') || ''
        if (isBinaryContentType(contentType)) {
          const buffer = await req.arrayBuffer()
          body = Buffer.from(buffer).toString('base64')
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

    // Build headers inline, skipping hop-by-hop headers during conversion
    const headers: Record<string, string> = {}
    req.headers.forEach((value, key) => {
      if (!SKIP_REQUEST_HEADERS.has(key)) {
        headers[key] = value
      }
    })

    const message: TunnelRequest = {
      type: 'request',
      id: requestId,
      method: req.method,
      path,
      headers,
      body,
    }
    if (isBase64Encoded) message.isBase64Encoded = true

    const socket = this.getSocketForSubdomain(subdomain)
    if (!socket) {
      return new Response('No tunnel client connected', { status: 502 })
    }

    return new Promise<Response>((resolve) => {
      // Set up response handler
      this.responseHandlers.set(requestId, (responseData) => {
        // Cancel the timeout — response arrived
        const tid = this.responseTimeouts.get(requestId)
        if (tid) {
          clearTimeout(tid)
          this.responseTimeouts.delete(requestId)
        }

        // Track response size
        const bodySize = responseData.body?.length || 0
        this.stats.bytesOut += bodySize

        if (this.options.verbose) debugLog('server', `Response for ${requestId}: ${responseData.status} (${bodySize} bytes, ${Date.now() - startTime}ms)`, true)

        // Handle binary responses
        let responseBody: string | Uint8Array = responseData.body || ''
        if (responseData.isBase64Encoded && typeof responseBody === 'string') {
          responseBody = Buffer.from(responseBody, 'base64')
        }

        // Pass response headers directly — already filtered by client
        resolve(new Response(responseBody, {
          status: responseData.status,
          headers: responseData.headers,
        }))
      })

      // Send request to client — handle socket being closed mid-flight
      try {
        socket.send(JSON.stringify(message))
      }
      catch (err) {
        this.responseHandlers.delete(requestId)
        if (this.options.verbose) debugLog('server', `Failed to send request ${requestId}: ${err}`, true, 'error')
        resolve(new Response('Tunnel client disconnected', { status: 502 }))
        return
      }

      // Set timeout for response
      const tid = setTimeout(() => {
        if (this.responseHandlers.has(requestId)) {
          this.responseHandlers.delete(requestId)
          this.responseTimeouts.delete(requestId)
          resolve(new Response('Gateway timeout - tunnel client did not respond', { status: 504 }))
        }
      }, this.options.timeout)
      this.responseTimeouts.set(requestId, tid)
    })
  }

  public getStats(includeSubdomains = false): ServerStats {
    return {
      connections: this.activeConnections,
      requests: this.stats.requests,
      startTime: this.stats.startTime,
      uptime: Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000),
      activeSubdomains: includeSubdomains ? Array.from(this.subdomainSockets.keys()) : [],
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
        const path = extractPath(req.url)
        const host = req.headers.get('host') || ''
        const subdomain = extractSubdomain(host)

        // Handle status endpoint
        if (path === '/status' || path === '/_status') {
          const stats = this.getStats()
          return new Response(JSON.stringify({
            status: 'ok',
            version: '0.2.7',
            connections: this.activeConnections,
            totalConnections: this.totalConnections,
            activeSubdomains: this.subdomainSockets.size,
            pendingResponses: this.responseHandlers.size,
            requests: stats.requests,
            uptime: `${stats.uptime}s`,
            bytesIn: this.stats.bytesIn,
            bytesOut: this.stats.bytesOut,
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Handle health check
        if (path === '/health' || path === '/_health') {
          return new Response('OK', { status: 200 })
        }

        // Handle metrics endpoint (Prometheus format)
        if (path === '/metrics' || path === '/_metrics') {
          const uptime = Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000)
          const metrics = [
            `# HELP tunnel_connections_active Current active connections`,
            `# TYPE tunnel_connections_active gauge`,
            `tunnel_connections_active ${this.activeConnections}`,
            `# HELP tunnel_connections_total Total connections since start`,
            `# TYPE tunnel_connections_total counter`,
            `tunnel_connections_total ${this.totalConnections}`,
            `# HELP tunnel_requests_total Total number of requests`,
            `# TYPE tunnel_requests_total counter`,
            `tunnel_requests_total ${this.stats.requests}`,
            `# HELP tunnel_active_subdomains Current number of active subdomains`,
            `# TYPE tunnel_active_subdomains gauge`,
            `tunnel_active_subdomains ${this.subdomainSockets.size}`,
            `# HELP tunnel_uptime_seconds Server uptime in seconds`,
            `# TYPE tunnel_uptime_seconds gauge`,
            `tunnel_uptime_seconds ${uptime}`,
            `# HELP tunnel_bytes_in Total bytes received`,
            `# TYPE tunnel_bytes_in counter`,
            `tunnel_bytes_in ${this.stats.bytesIn}`,
            `# HELP tunnel_bytes_out Total bytes sent`,
            `# TYPE tunnel_bytes_out counter`,
            `tunnel_bytes_out ${this.stats.bytesOut}`,
            `# HELP tunnel_pending_responses Pending response handlers`,
            `# TYPE tunnel_pending_responses gauge`,
            `tunnel_pending_responses ${this.responseHandlers.size}`,
          ].join('\n')
          return new Response(metrics, {
            headers: { 'Content-Type': 'text/plain' },
          })
        }

        if (this.options.verbose) debugLog('server', `Received request for subdomain: ${subdomain}, path: ${path}`, true)

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
          if (this.options.verbose) debugLog('server', `Publishing HTTP request to subdomain: ${subdomain}`, true)

          return this.forwardRequest(req, path, subdomain)
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
        maxPayloadLength: MAX_PAYLOAD_SIZE,
        idleTimeout: 30, // seconds - Bun auto-pings, closes if no pong in 30s
        perMessageDeflate: false,

        message: (ws, message) => {
          try {
            const data = JSON.parse(String(message))
            if (this.options.verbose) debugLog('server', `Received WebSocket message: ${data.type}`, true)

            if (data.type === 'ready') {
              const subdomain = data.subdomain

              // Validate subdomain
              if (!subdomain || !isValidSubdomain(subdomain)) {
                ws.send(MSG_ERR_INVALID_SUBDOMAIN)
                return
              }

              // Check if subdomain is already in use by another client
              if (this.subdomainSockets.has(subdomain) && this.subdomainSockets.get(subdomain)!.size > 0) {
                ws.send(`{"type":"subdomain_taken","subdomain":"${subdomain}"}`)
                debugLog('server', `Subdomain ${subdomain} already in use, notifying client`, this.options.verbose)
                return
              }

              ws.data.subdomain = subdomain
              const accepted = this.addSocket(subdomain, ws)
              if (!accepted) {
                ws.send(MSG_ERR_CONN_LIMIT)
                ws.close(1013, 'Connection limit reached')
                return
              }
              debugLog('server', `Client ${subdomain} is ready (${this.activeConnections} total connections)`, this.options.verbose)

              // Confirm registration
              const proto = this.options.secure ? 'https' : 'http'
              ws.send(`{"type":"registered","subdomain":"${subdomain}","url":"${proto}://${subdomain}.${this.options.host}"}`)
            }
            else if (data.type === 'response') {
              const handler = this.responseHandlers.get(data.id)
              if (handler) {
                handler(data)
                this.responseHandlers.delete(data.id)
              }
            }
            else if (data.type === 'disconnect') {
              // Client is explicitly disconnecting — remove subdomain immediately
              const sub = data.subdomain || ws.data.subdomain
              if (sub) {
                debugLog('server', `Client explicitly disconnecting: ${sub}`, this.options.verbose)
                this.removeSocket(sub, ws)
                ws.data.subdomain = '' // prevent double-remove in close handler
              }
              ws.close(1000, 'Client disconnected')
            }
            else if (data.type === 'ping') {
              ws.data.lastSeen = Date.now()
              ws.send(MSG_PONG)
            }
          }
          catch (err) {
            debugLog('server', `Error handling message: ${err}`, this.options.verbose, 'error')
          }
        },

        open: (ws) => {
          debugLog('server', `WebSocket opened`, this.options.verbose)
          ws.send(MSG_CONNECTED)
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

    // Start idle connection cleanup interval
    this.idleCleanupInterval = setInterval(() => {
      this.cleanupIdleConnections()
      this.cleanupStaleHandlers()
    }, IDLE_CLEANUP_INTERVAL_MS)

    debugLog('server', `Server started on ${this.options.host}:${this.options.port}`, this.options.verbose)
    this.emit('start', { host: this.options.host, port: this.options.port })
  }

  private cleanupIdleConnections(): void {
    const now = Date.now()
    let cleaned = 0
    // Collect sockets to remove first, then mutate — avoids modifying Set during iteration
    const toRemove: Array<[string, ServerWebSocket<WebSocketData>]> = []
    for (const [subdomain, sockets] of this.subdomainSockets) {
      for (const socket of sockets) {
        if (now - socket.data.lastSeen > IDLE_TIMEOUT_MS) {
          toRemove.push([subdomain, socket])
        }
      }
    }
    for (const [subdomain, socket] of toRemove) {
      debugLog('server', `Closing idle connection for ${subdomain} (idle ${Math.round((now - socket.data.lastSeen) / 1000)}s)`, this.options.verbose)
      socket.close(1000, 'Idle timeout')
      this.removeSocket(subdomain, socket)
      cleaned++
    }
    if (cleaned > 0) {
      debugLog('server', `Cleaned up ${cleaned} idle connections (${this.activeConnections} remaining)`, this.options.verbose)
    }
  }

  private cleanupStaleHandlers(): void {
    // Safety net: clean up response handlers whose timeouts may have been GC'd.
    // The responseTimeouts map tracks active timeouts — any handler without a
    // matching timeout entry is orphaned and should be removed.
    let cleaned = 0
    for (const [id] of this.responseHandlers) {
      if (!this.responseTimeouts.has(id)) {
        this.responseHandlers.delete(id)
        cleaned++
      }
    }
    // Also clean up orphaned timeouts (shouldn't happen, but defensive)
    for (const [id, tid] of this.responseTimeouts) {
      if (!this.responseHandlers.has(id)) {
        clearTimeout(tid)
        this.responseTimeouts.delete(id)
      }
    }
    if (cleaned > 0) {
      debugLog('server', `Cleaned up ${cleaned} stale response handlers`, this.options.verbose)
    }
  }

  public stop(): void {
    if (this.idleCleanupInterval) {
      clearInterval(this.idleCleanupInterval)
      this.idleCleanupInterval = null
    }
    if (this.server) {
      this.server.stop()
      this.subdomainSockets.clear()
      this.responseHandlers.clear()
      // Cancel all pending response timeouts
      for (const tid of this.responseTimeouts.values()) {
        clearTimeout(tid)
      }
      this.responseTimeouts.clear()
      this.activeConnections = 0
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
  private localUrlPrefix: string
  private reconnectAttempts = 0
  private shouldReconnect = true
  private state: ClientState = 'disconnected'
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private resolvedIp: string | null = null
  private resolverCreated = false

  constructor(options: TunnelOptions = {}) {
    super()
    this.options = {
      port: options.port || 3000,
      host: options.host || 'localhost',
      secure: options.secure || false,
      verbose: options.verbose || false,
      localPort: options.localPort || 8000,
      localHost: options.localHost || 'localhost',
      subdomain: options.subdomain || generateSubdomain(),
      timeout: options.timeout || 10000,
      maxReconnectAttempts: options.maxReconnectAttempts || 10,
      apiKey: options.apiKey || '',
      manageHosts: options.manageHosts !== false,
    }
    // Cache the local URL prefix to avoid building it on every request
    this.localUrlPrefix = `http://${this.options.localHost}:${this.options.localPort}`
  }

  public getState(): ClientState {
    return this.state
  }

  public async connect(): Promise<void> {
    if (this.options.manageHosts) {
      // On macOS, fix the system DNS so browsers can also reach the tunnel URL.
      // This must run regardless of canSystemConnect — the tunnel client can bypass DNS
      // with direct IP, but browsers need system DNS to work.
      if (!this.resolverCreated) {
        try {
          this.resolverCreated = await ensureMacOSResolver(this.options.host, this.options.verbose)
        }
        catch (err) {
          debugLog('client', `macOS resolver setup failed (non-fatal): ${err}`, this.options.verbose, 'warn')
        }
      }

      // If DNS/connectivity to the server doesn't work, resolve the IP directly
      // so we can connect to the IP and bypass broken system DNS (common on macOS with .dev TLD)
      if (!this.resolvedIp) {
        try {
          const reachable = await canSystemConnect(this.options.host, this.options.secure)
          if (!reachable) {
            debugLog('client', `Cannot reach ${this.options.host} via system DNS, resolving IP...`, this.options.verbose)
            this.resolvedIp = await resolveHostname(this.options.host, this.options.verbose)
            if (this.resolvedIp) {
              debugLog('client', `Will connect directly to ${this.resolvedIp} for ${this.options.host}`, this.options.verbose)
            }
          }
        }
        catch (err) {
          debugLog('client', `DNS resolution fallback failed (non-fatal): ${err}`, this.options.verbose, 'warn')
        }
      }
    }

    return new Promise((resolve, reject) => {
      this.state = 'connecting'

      const protocol = this.options.secure ? 'wss' : 'ws'
      const connectHost = this.resolvedIp || this.options.host
      let url = `${protocol}://${connectHost}`

      // Add port if not default
      if ((this.options.secure && this.options.port !== 443)
        || (!this.options.secure && this.options.port !== 80)) {
        url += `:${this.options.port}`
      }

      // Add subdomain as query parameter for initial connection
      url += `?subdomain=${encodeURIComponent(this.options.subdomain)}`

      debugLog('client', `Connecting to WebSocket server at ${url}`, this.options.verbose)

      // When connecting to an IP directly, set the Host header and disable strict TLS
      // so the TLS handshake uses the right SNI but doesn't reject the IP-based cert
      const wsOptions = this.resolvedIp
        ? { headers: { Host: this.options.host }, tls: { rejectUnauthorized: false } }
        : undefined

      this.ws = new WebSocket(url, wsOptions as any)

      const timeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          debugLog('client', 'Connection timeout', this.options.verbose)
          this.ws?.close()
          this.state = 'error'
          reject(new Error('Connection timeout'))
        }
      }, this.options.timeout)

      let settled = false

      this.ws.addEventListener('open', () => {
        clearTimeout(timeout)
        this.state = 'connected'
        this.reconnectAttempts = 0
        debugLog('client', 'Connected to tunnel server', this.options.verbose)

        // Send ready message with subdomain — wait for 'registered' before resolving
        this.ws?.send(JSON.stringify({
          type: 'ready',
          subdomain: this.options.subdomain,
        }))
      })

      this.ws.addEventListener('message', async (event) => {
        try {
          const data = JSON.parse(event.data as string)
          if (this.options.verbose) debugLog('client', `Received message: ${data.type}`, true)

          if (data.type === 'registered') {
            // Server confirmed our subdomain — now we're truly ready
            this.options.subdomain = data.subdomain
            debugLog('client', `Registered with subdomain: ${data.subdomain}`, this.options.verbose)

            this.emit('connected', {
              url: `${this.options.secure ? 'https' : 'http'}://${this.options.subdomain}.${this.options.host}`,
              subdomain: this.options.subdomain,
              tunnelServer: this.options.host,
            })

            this.startPing()

            if (!settled) {
              settled = true
              resolve()
            }
          }
          else if (data.type === 'subdomain_taken') {
            // Subdomain in use — append or increment suffix and retry
            const current = this.options.subdomain
            const match = current.match(/^(.+)-(\d+)$/)
            const base = match ? match[1] : current
            const next = match ? Number.parseInt(match[2]) + 1 : 2
            this.options.subdomain = `${base}-${next}`
            debugLog('client', `Subdomain ${data.subdomain} taken, trying ${this.options.subdomain}`, this.options.verbose)

            this.ws?.send(JSON.stringify({
              type: 'ready',
              subdomain: this.options.subdomain,
            }))
          }
          else if (data.type === 'request') {
            await this.handleRequest(data)
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
        this.ws.send(MSG_PING)
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
    const localUrl = this.localUrlPrefix + data.path
    const startTime = Date.now()

    if (this.options.verbose) debugLog('client', `Forwarding ${data.method} ${data.path} to: ${localUrl}`, true)

    this.emit('request', {
      method: data.method,
      url: data.path,
      path: data.path,
    })

    try {
      // Server already filters hop-by-hop headers, so pass directly
      const fetchOptions: RequestInit = {
        method: data.method,
        headers: data.headers,
      }

      // Add body for non-GET/HEAD requests
      if (data.method !== 'GET' && data.method !== 'HEAD' && data.body) {
        if (data.isBase64Encoded) {
          fetchOptions.body = Buffer.from(data.body, 'base64')
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

      if (isBinaryContentType(contentType)) {
        const buffer = await response.arrayBuffer()
        responseBody = Buffer.from(buffer).toString('base64')
        isBase64Encoded = true
      }
      else {
        responseBody = await response.text()
      }

      const duration = Date.now() - startTime
      if (this.options.verbose) debugLog('client', `Response: ${response.status} (${responseBody.length} bytes, ${duration}ms)`, true)

      // Convert headers to plain object, filtering with Set (O(1) lookup)
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        if (!SKIP_RESPONSE_HEADERS.has(key)) {
          responseHeaders[key] = value
        }
      })

      const responseMsg: any = {
        type: 'response',
        id: data.id,
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      }
      if (isBase64Encoded) responseMsg.isBase64Encoded = true
      this.ws?.send(JSON.stringify(responseMsg))

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

  public async disconnect(): Promise<void> {
    this.shouldReconnect = false
    this.stopPing()

    if (this.ws) {
      // Tell the server to remove our subdomain immediately.
      // This is more reliable than relying on WebSocket close frames,
      // because process.exit/SIGKILL can kill the process before the
      // close handshake completes, leaving stale subdomain mappings.
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({
            type: 'disconnect',
            subdomain: this.options.subdomain,
          }))
        }
        catch { /* socket may already be closing */ }
      }

      // Wait for the WebSocket close frame to reach the server (max 500ms)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 500)
        this.ws!.addEventListener('close', () => {
          clearTimeout(timeout)
          resolve()
        }, { once: true })
        this.ws!.close()
      })
      this.ws = null
    }

    this.state = 'disconnected'
    this.emit('disconnected')

    // Clean up macOS resolver file
    if (this.resolverCreated) {
      await cleanupMacOSResolver(this.options.host, this.options.verbose).catch(() => {})
    }
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
  manageHosts?: boolean
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
    ...(options.manageHosts !== undefined ? { manageHosts: options.manageHosts } : {}),
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

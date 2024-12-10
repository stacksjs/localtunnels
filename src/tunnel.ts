import { debugLog } from './utils'

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

export class TunnelServer {
  private server: ReturnType<typeof Bun.serve> | null = null
  private options: Required<TunnelOptions>
  private responseHandlers: Map<string, (response: any) => void> = new Map()
  private subdomainSockets: Map<string, Set<WebSocket>> = new Map()

  constructor(options: TunnelOptions = {}) {
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

  private addSocket(subdomain: string, socket: WebSocket) {
    if (!this.subdomainSockets.has(subdomain)) {
      this.subdomainSockets.set(subdomain, new Set())
    }
    this.subdomainSockets.get(subdomain)?.add(socket)
  }

  private removeSocket(subdomain: string, socket: WebSocket) {
    this.subdomainSockets.get(subdomain)?.delete(socket)
    if (this.subdomainSockets.get(subdomain)?.size === 0) {
      this.subdomainSockets.delete(subdomain)
    }
  }

  private broadcastToSubdomain(subdomain: string, message: any) {
    const sockets = this.subdomainSockets.get(subdomain)
    if (sockets) {
      for (const socket of sockets) {
        socket.send(JSON.stringify(message))
      }
    }
  }

  public async start(): Promise<void> {
    this.server = Bun.serve<WebSocketData>({
      port: this.options.port,
      hostname: this.options.host,
      development: true, // This will increase the default timeout

      fetch: async (req, server) => {
        const url = new URL(req.url)
        const host = req.headers.get('host') || ''
        const subdomain = host.split('.')[0]

        debugLog('server', `Received request for subdomain: ${subdomain}`, this.options.verbose)

        if (req.headers.get('upgrade') === 'websocket') {
          debugLog('server', `Upgrading connection for client`, this.options.verbose)
          const upgraded = server.upgrade(req, {
            data: { subdomain },
          })
          return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
        }

        if (subdomain && this.subdomainSockets.has(subdomain)) {
          debugLog('server', `Publishing HTTP request to subdomain: ${subdomain}`, this.options.verbose)

          return new Promise<Response>((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(7)

            this.responseHandlers.set(requestId, (responseData) => {
              const headers = new Headers(responseData.headers || {})
              resolve(new Response(responseData.body, {
                status: responseData.status,
                headers,
              }))
            })

            const message = {
              type: 'request',
              id: requestId,
              method: req.method,
              url: url.toString(),
              headers: Object.fromEntries(req.headers),
            }

            this.broadcastToSubdomain(subdomain, message)

            // Set timeout for response
            setTimeout(() => {
              if (this.responseHandlers.has(requestId)) {
                this.responseHandlers.delete(requestId)
                reject(new Error('Request timeout'))
              }
            }, 29000)
          }).catch(err => new Response(`Tunnel error: ${err.message}`, { status: 502 }))
        }

        return new Response('Not found', { status: 404 })
      },

      websocket: {
        message: (ws, message) => {
          try {
            const data = JSON.parse(String(message))
            debugLog('server', `Received WebSocket message: ${JSON.stringify(data)}`, this.options.verbose)

            if (data.type === 'ready') {
              const subdomain = data.subdomain
              ws.data.subdomain = subdomain // Update the socket's subdomain
              this.addSocket(subdomain, ws)
              debugLog('server', `Client ${subdomain} is ready`, this.options.verbose)
            }
            else if (data.type === 'response') {
              const handler = this.responseHandlers.get(data.id)
              if (handler) {
                handler(data)
                this.responseHandlers.delete(data.id)
              }
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

        error: (ws, error) => {
          debugLog('server', `WebSocket error: ${error}`, this.options.verbose, 'error')
        },
      },
    })

    debugLog('server', `Server started on ${this.options.host}:${this.options.port}`, this.options.verbose)
  }

  public stop(): void {
    if (this.server) {
      this.server.stop()
      debugLog('server', 'Server stopped', this.options.verbose)
    }
  }
}

export class TunnelClient {
  private ws: WebSocket | null = null
  private options: Required<TunnelOptions>

  constructor(options: TunnelOptions = {}) {
    this.options = {
      port: options.port || 3000,
      host: options.host || 'localhost',
      secure: options.secure || false,
      verbose: options.verbose || false,
      localPort: options.localPort || 8000,
      localHost: options.localHost || 'localhost',
      subdomain: options.subdomain || Math.random().toString(36).substring(7),
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
      }, 5000)

      this.ws.addEventListener('open', () => {
        clearTimeout(timeout)
        debugLog('client', 'Connected to tunnel server', this.options.verbose)

        // Send ready message with subdomain
        this.ws?.send(JSON.stringify({
          type: 'ready',
          subdomain: this.options.subdomain,
        }))

        resolve()
      })

      this.ws.addEventListener('message', async (event) => {
        try {
          const data = JSON.parse(event.data as string)
          debugLog('client', `Received message: ${JSON.stringify(data)}`, this.options.verbose)

          if (data.type === 'request') {
            // Handle incoming HTTP request
            const requestUrl = new URL(data.url)
            const localUrl = `http://${this.options.localHost}:${this.options.localPort}${requestUrl.pathname}${requestUrl.search}`
            debugLog('client', `Forwarding request to: ${localUrl}`, this.options.verbose)

            try {
              const response = await fetch(localUrl, {
                method: data.method,
                headers: data.headers,
              })

              const responseBody = await response.text()
              debugLog('client', `Sending response for request ${data.id}`, this.options.verbose)

              this.ws?.send(JSON.stringify({
                type: 'response',
                id: data.id,
                status: response.status,
                headers: Object.fromEntries(response.headers),
                body: responseBody,
              }))
            }
            catch (err) {
              debugLog('client', `Error forwarding request: ${err}`, this.options.verbose, 'error')
              this.ws?.send(JSON.stringify({
                type: 'response',
                id: data.id,
                status: 502,
                headers: {},
                body: 'Bad Gateway',
              }))
            }
          }
        }
        catch (err) {
          debugLog('client', `Error handling message: ${err}`, this.options.verbose, 'error')
        }
      })

      this.ws.addEventListener('close', () => {
        clearTimeout(timeout)
        debugLog('client', 'Disconnected from tunnel server', this.options.verbose)
        this.ws = null
      })

      this.ws.addEventListener('error', (error) => {
        clearTimeout(timeout)
        debugLog('client', `WebSocket error: ${error}`, this.options.verbose, 'error')
        reject(error)
      })
    })
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

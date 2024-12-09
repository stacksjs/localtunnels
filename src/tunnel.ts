import type { Socket } from 'node:net'
import type { TunnelConnection, TunnelOptions, TunnelRequest } from './types'
import { debugLog } from './utils'

export class TunnelServer {
  private connections: Map<string, TunnelConnection>
  private options: Required<TunnelOptions>
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(options: TunnelOptions = {}) {
    this.connections = new Map()
    this.options = {
      port: options.port || 3000,
      host: options.host || '0.0.0.0',
      secure: options.secure || false,
      verbose: options.verbose || false,
      localPort: options.localPort || 8000,
      localHost: options.localHost || 'localhost',
      subdomain: options.subdomain || '',
      ssl: options.ssl || {
        key: '',
        cert: '',
      },
    }
  }

  public async start(): Promise<void> {
    // Create WebSocket server for tunnel connections
    this.server = Bun.serve({
      port: this.options.port,
      hostname: this.options.host,

      fetch: (req) => {
        // Extract subdomain from host header
        const host = req.headers.get('host') || ''
        const subdomain = host.split('.')[0]

        // Find connection for this subdomain
        const connection = Array.from(this.connections.values())
          .find(conn => conn.id === subdomain)

        if (!connection) {
          return new Response('Tunnel not found', { status: 404 })
        }

        // Forward the request through the tunnel
        return this.handleTunnelRequest(connection, req)
      },

      websocket: {
        open: (ws) => {
          const id = Math.random().toString(36).substring(7)
          debugLog('connection', `New WebSocket connection: ${id}`, this.options.verbose)

          const connection: TunnelConnection = {
            id,
            clientSocket: ws as unknown as Socket, // Type assertion for compatibility
            tunnels: new Map(),
          }

          this.connections.set(id, connection)
        },

        message: (ws, message) => {
          const connection = Array.from(this.connections.values())
            .find(conn => conn.clientSocket === ws)

          if (connection) {
            this.handleWebSocketMessage(connection, message)
          }
        },

        close: (ws) => {
          const connection = Array.from(this.connections.values())
            .find(conn => conn.clientSocket === ws)

          if (connection) {
            this.handleClose(connection)
          }
        },
      },
    })

    debugLog('server', `Tunnel server listening on ${this.options.host}:${this.options.port}`, this.options.verbose)
  }

  private async handleTunnelRequest(connection: TunnelConnection, req: Request): Promise<Response> {
    const requestId = Math.random().toString(36).substring(7)

    // Create tunnel request object
    const tunnelRequest: TunnelRequest = {
      id: requestId,
      method: req.method,
      url: req.url,
      headers: Object.fromEntries(req.headers),
      body: req.body ? new Uint8Array(await req.arrayBuffer()) : undefined,
    }

    // Send request to client
    const ws = connection.clientSocket as unknown as WebSocket
    ws.send(JSON.stringify({
      type: 'request',
      request: tunnelRequest,
    }))

    // Wait for response
    return new Promise((resolve) => {
      const responseHandler = (message: any) => {
        if (message.type === 'response' && message.requestId === requestId) {
          const { status, headers, body } = message.response
          resolve(new Response(body, { status, headers }))
        }
      }

      // Add temporary message handler
      const originalOnMessage = ws.onmessage
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string)
          responseHandler(message)
        }
        catch (err) {
          debugLog('request', `Failed to parse response: ${err}`, this.options.verbose)
          resolve(new Response('Internal Server Error', { status: 500 }))
        }
        ws.onmessage = originalOnMessage
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        ws.onmessage = originalOnMessage
        resolve(new Response('Gateway Timeout', { status: 504 }))
      }, 30000)
    })
  }

  private handleWebSocketMessage(connection: TunnelConnection, data: string | Uint8Array): void {
    try {
      const message = JSON.parse(data as string)
      debugLog('data', `Received message: ${JSON.stringify(message)}`, this.options.verbose)

      switch (message.type) {
        case 'register':
          this.handleRegister(connection, message)
          break
        default:
          debugLog('data', `Unknown message type: ${message.type}`, this.options.verbose)
      }
    }
    catch (err) {
      debugLog('data', `Failed to parse message: ${err}`, this.options.verbose)
    }
  }

  private handleRegister(connection: TunnelConnection, message: any): void {
    const { subdomain } = message
    debugLog('register', `Registering subdomain: ${subdomain}`, this.options.verbose)

    // Send confirmation
    const ws = connection.clientSocket as unknown as WebSocket
    ws.send(JSON.stringify({
      type: 'registered',
      subdomain,
      url: `http${this.options.secure ? 's' : ''}://${subdomain}.${this.options.host}`,
    }))
  }

  private handleClose(connection: TunnelConnection): void {
    debugLog('connection', `Connection closed: ${connection.id}`, this.options.verbose)
    this.connections.delete(connection.id)
  }

  public stop(): void {
    if (this.server) {
      this.server.stop()
      this.connections.clear()
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
      ssl: options.ssl || {
        key: '',
        cert: '',
      },
    }
  }

  public async connect(): Promise<void> {
    const protocol = this.options.secure ? 'wss' : 'ws'
    const url = `${protocol}://${this.options.host}:${this.options.port}`

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        debugLog('client', 'Connected to tunnel server', this.options.verbose)
        this.register()
        resolve()
      }

      this.ws.onmessage = async (event) => {
        await this.handleMessage(event.data as string)
      }

      this.ws.onclose = () => {
        debugLog('client', 'Disconnected from tunnel server', this.options.verbose)
        this.ws = null
      }

      this.ws.onerror = (err) => {
        debugLog('client', `WebSocket error: ${err}`, this.options.verbose)
        reject(err)
      }
    })
  }

  private register(): void {
    if (!this.ws)
      return

    this.ws.send(JSON.stringify({
      type: 'register',
      subdomain: this.options.subdomain,
    }))
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data)
      debugLog('data', `Received message: ${JSON.stringify(message)}`, this.options.verbose)

      switch (message.type) {
        case 'registered':
          debugLog('client', `Registered with URL: ${message.url}`, this.options.verbose)
          break
        case 'request':
          await this.handleRequest(message.request)
          break
        default:
          debugLog('data', `Unknown message type: ${message.type}`, this.options.verbose)
      }
    }
    catch (err) {
      debugLog('data', `Failed to parse message: ${err}`, this.options.verbose)
    }
  }

  private async handleRequest(request: TunnelRequest): Promise<void> {
    if (!this.ws)
      return

    try {
      // Forward request to local server
      const response = await fetch(`http://${this.options.localHost}:${this.options.localPort}${request.url}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })

      // Send response back through tunnel
      this.ws.send(JSON.stringify({
        type: 'response',
        requestId: request.id,
        response: {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        },
      }))
    }
    catch (err) {
      debugLog('request', `Failed to handle request: ${err}`, this.options.verbose)

      // Send error response
      this.ws.send(JSON.stringify({
        type: 'response',
        requestId: request.id,
        response: {
          status: 502,
          headers: {},
          body: 'Bad Gateway',
        },
      }))
    }
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

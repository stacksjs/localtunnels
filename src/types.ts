import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'

/**
 * Options for configuring the tunnel
 */
export interface TunnelOptions {
  /**
   * Port to connect to (for server mode) or listen on (for client mode)
   * @default 3000
   */
  port?: number

  /**
   * Host to connect to (tunnel server) or bind to (self-hosted server)
   * @default 'localhost' for client, '0.0.0.0' for server
   */
  host?: string

  /**
   * Use secure WebSocket (wss://) and HTTPS
   * @default false
   */
  secure?: boolean

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean

  /**
   * Local port to forward requests to
   * @default 8000
   */
  localPort?: number

  /**
   * Local host to forward requests to
   * @default 'localhost'
   */
  localHost?: string

  /**
   * Subdomain to use for the tunnel
   * If not specified, a random subdomain will be generated
   */
  subdomain?: string

  /**
   * SSL/TLS options for secure connections
   */
  ssl?: {
    key: string
    cert: string
    ca?: string
  }

  /**
   * Connection timeout in milliseconds
   * @default 10000
   */
  timeout?: number

  /**
   * Maximum reconnection attempts
   * @default 10
   */
  maxReconnectAttempts?: number

  /**
   * API key for authentication (if required by server)
   */
  apiKey?: string
}

/**
 * Alias for backwards compatibility
 */
export type LocalTunnelOptions = TunnelOptions

/**
 * Tunnel connection information
 */
export interface TunnelConnection {
  id: string
  clientSocket: Socket | TLSSocket
  tunnels: Map<string, Socket>
}

/**
 * Request forwarded through the tunnel
 */
export interface TunnelRequest {
  id: string
  type: 'request'
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body?: string
  isBase64Encoded?: boolean
}

/**
 * Response from the local server
 */
export interface TunnelResponse {
  id: string
  type: 'response'
  status: number
  headers: Record<string, string>
  body: string
  isBase64Encoded?: boolean
}

/**
 * WebSocket message types
 */
export type TunnelMessageType =
  | 'connected'
  | 'ready'
  | 'registered'
  | 'request'
  | 'response'
  | 'ping'
  | 'pong'
  | 'error'

/**
 * Base WebSocket message
 */
export interface TunnelMessage {
  type: TunnelMessageType
  [key: string]: unknown
}

/**
 * Connection event data
 */
export interface ConnectionInfo {
  url: string
  subdomain: string
  tunnelServer?: string
}

/**
 * Request event data
 */
export interface RequestInfo {
  method: string
  url: string
  path?: string
}

/**
 * Response event data
 */
export interface ResponseInfo {
  status: number
  size: number
  duration?: number
}

/**
 * Reconnection event data
 */
export interface ReconnectionInfo {
  attempt: number
  delay: number
  maxAttempts: number
}

/**
 * Server statistics
 */
export interface ServerStats {
  connections: number
  requests: number
  startTime: Date
  uptime: number
  activeSubdomains: string[]
}

/**
 * Client state
 */
export type ClientState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

/**
 * Tunnel events for EventEmitter
 */
export interface TunnelClientEvents {
  connected: (info: ConnectionInfo) => void
  disconnected: () => void
  reconnecting: (info: ReconnectionInfo) => void
  request: (info: RequestInfo) => void
  response: (info: ResponseInfo) => void
  error: (error: Error) => void
  close: () => void
}

export interface TunnelServerEvents {
  start: (info: { host: string, port: number }) => void
  stop: () => void
  connection: (info: { subdomain: string, totalConnections: number }) => void
  disconnection: (info: { subdomain: string }) => void
  request: (info: RequestInfo) => void
  error: (error: Error) => void
}

/**
 * Configuration for rate limiting
 */
export interface RateLimitConfig {
  /**
   * Time window in milliseconds
   * @default 60000
   */
  windowMs: number

  /**
   * Maximum requests per window
   * @default 100
   */
  maxRequests: number

  /**
   * Skip rate limiting for certain paths
   */
  skipPaths?: string[]
}

/**
 * Server configuration for self-hosted mode
 */
export interface ServerConfig {
  /**
   * Port to listen on
   * @default 3000
   */
  port: number

  /**
   * Host to bind to
   * @default '0.0.0.0'
   */
  host: string

  /**
   * Domain for generating tunnel URLs
   * @default 'localhost'
   */
  domain: string

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean

  /**
   * SSL/TLS configuration
   */
  ssl?: {
    key: string
    cert: string
    ca?: string
  }

  /**
   * Rate limiting configuration
   */
  rateLimit?: RateLimitConfig

  /**
   * Maximum payload size in bytes
   * @default 10485760 (10MB)
   */
  maxPayloadSize?: number

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  requestTimeout?: number
}

/**
 * AWS deployment configuration
 */
export interface AWSConfig {
  /**
   * AWS region
   * @default 'us-east-1'
   */
  region?: string

  /**
   * Domain name for the tunnel service
   * @default 'localtunnel.dev'
   */
  domainName?: string

  /**
   * Route53 hosted zone ID
   */
  hostedZoneId?: string

  /**
   * ACM certificate ARN
   */
  certificateArn?: string

  /**
   * Enable CloudWatch monitoring
   * @default true
   */
  enableMonitoring?: boolean

  /**
   * Log retention in days
   * @default 14
   */
  logRetentionDays?: number
}

import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'

export type LocalTunnelOptions = TunnelOptions
export interface TunnelOptions {
  port?: number
  host?: string
  secure?: boolean
  verbose?: boolean
  localPort?: number
  localHost?: string
  subdomain?: string
  ssl?: {
    key: string
    cert: string
    ca?: string
  }
}

export interface TunnelConnection {
  id: string
  clientSocket: Socket | TLSSocket
  tunnels: Map<string, Socket>
}

export interface TunnelRequest {
  id: string
  method: string
  url: string
  headers: Record<string, string>
  body?: Uint8Array
}

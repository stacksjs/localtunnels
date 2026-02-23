// Simple console logger - using warn/error which are allowed by lint
const logger = {
  debug: (msg: string) => console.warn(`[DEBUG] ${msg}`),
  info: (msg: string) => console.warn(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
}

/**
 * Debug logging levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Debug logging categories
 */
export type LogCategory =
  | 'server'
  | 'client'
  | 'connection'
  | 'data'
  | 'request'
  | 'response'
  | 'websocket'
  | 'error'
  | 'cleanup'
  | string

/**
 * Debug log function that outputs formatted logs when verbose mode is enabled
 * @param category - The category of the log message
 * @param message - The message to log
 * @param verbose - Whether verbose logging is enabled
 * @param level - The log level (default: 'debug')
 */
export function debugLog(
  category: LogCategory,
  message: string,
  verbose?: boolean,
  level: LogLevel = 'debug',
): void {
  if (!verbose)
    return

  const timestamp = new Date().toISOString()
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${category}]`

  switch (level) {
    case 'error':
      logger.error(`${prefix} ${message}`)
      break
    case 'warn':
      logger.warn(`${prefix} ${message}`)
      break
    case 'info':
      logger.info(`${prefix} ${message}`)
      break
    default:
      logger.debug(`${prefix} ${message}`)
  }
}

/**
 * Generate a random identifier string
 * @param length - The length of the identifier (default: 7)
 * @returns A random string identifier
 */
export function generateId(length = 7): string {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length)
}

/**
 * Parse a host string into its components
 * @param host - The host string (e.g., "subdomain.example.com:3000")
 * @returns The parsed host components
 */
export function parseHost(host: string): {
  subdomain: string
  domain: string
  port?: number
} {
  const [hostPart, portPart] = host.split(':')
  const parts = hostPart.split('.')

  if (parts.length < 2) {
    return {
      subdomain: '',
      domain: hostPart,
      port: portPart ? Number.parseInt(portPart, 10) : undefined,
    }
  }

  return {
    subdomain: parts[0],
    domain: parts.slice(1).join('.'),
    port: portPart ? Number.parseInt(portPart, 10) : undefined,
  }
}

/**
 * Convert headers from Request to Record<string, string>
 * @param headers - The headers to convert
 * @returns A plain object of headers
 */
export function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value
  })
  return result
}

/**
 * Check if WebSocket is supported in the current environment
 * @returns Whether WebSocket is available
 */
export function isWebSocketSupported(): boolean {
  return typeof WebSocket !== 'undefined'
}

/**
 * Format a URL with the correct protocol and port
 * @param options - The URL components
 * @param options.host - The host name
 * @param options.port - The port number
 * @param options.pathname - The path
 * @param options.protocol - The protocol (default: 'http')
 * @returns The formatted URL
 */
// eslint-disable-next-line pickier/no-unused-vars
export function formatUrl({
  protocol = 'http',
  host,
  port,
  pathname = '',
}: {
  protocol?: 'http' | 'https' | 'ws' | 'wss'
  host: string
  port?: number
  pathname?: string
}): string {
  const portSuffix = port ? `:${port}` : ''
  return `${protocol}://${host}${portSuffix}${pathname}`
}

/**
 * Delay execution for a specified time
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Implements an exponential backoff strategy for reconnection attempts
 * @param attempt - The current attempt number
 * @param baseDelay - The base delay in milliseconds
 * @param maxDelay - The maximum delay in milliseconds
 * @returns The delay to wait before the next attempt
 */
export function calculateBackoff(
  attempt: number,
  baseDelay = 1000,
  maxDelay = 30000,
): number {
  const delay = Math.min(baseDelay * 2 ** attempt, maxDelay)
  // Add some randomization to prevent thundering herd
  return delay + Math.random() * 1000
}

/**
 * Check if a port number is valid
 * @param port - The port number to validate
 * @returns Whether the port is valid
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * Create a timeout promise that rejects after a specified time
 * @param ms - The timeout in milliseconds
 * @param message - The timeout error message
 * @returns A promise that rejects after the timeout
 */
export function createTimeout(ms: number, message = 'Operation timed out'): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms)
  })
}

/**
 * Race a promise against a timeout
 * @param promise - The promise to race
 * @param ms - The timeout in milliseconds
 * @param message - The timeout error message
 * @returns The promise result or throws a timeout error
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Operation timed out',
): Promise<T> {
  return Promise.race([
    promise,
    createTimeout(ms, message),
  ])
}

/**
 * Check if a string is a valid subdomain
 * @param subdomain - The subdomain to validate
 * @returns Whether the subdomain is valid
 */
export function isValidSubdomain(subdomain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
}

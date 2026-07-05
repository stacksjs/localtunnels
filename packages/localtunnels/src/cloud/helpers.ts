import { randomBytes } from 'node:crypto'

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `req_${randomBytes(16).toString('hex')}`
}

/**
 * Generate a unique connection ID
 */
export function generateConnectionId(): string {
  return `conn_${randomBytes(12).toString('hex')}`
}

/**
 * Validate a subdomain string
 */
export function isValidSubdomain(subdomain: string): boolean {
  // Must be lowercase alphanumeric with optional hyphens
  // Cannot start or end with hyphen, 3-63 characters
  return /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(subdomain)
}

/**
 * Sanitize headers for forwarding
 * Removes hop-by-hop headers and other problematic headers
 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const hopByHopHeaders = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'content-encoding', // We handle encoding ourselves
  ]

  const sanitized: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase()
    if (!hopByHopHeaders.includes(lowerKey)) {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Parse connection metadata from the event
 */
export interface ConnectionMetadata {
  connectionId: string
  subdomain?: string
  ip?: string
  userAgent?: string
  connectedAt: number
}

/**
 * Create a DynamoDB attribute value from a JavaScript value
 */
export function toDynamoDBValue(value: any): any {
  if (value === null || value === undefined) {
    return { NULL: true }
  }
  if (typeof value === 'string') {
    return { S: value }
  }
  if (typeof value === 'number') {
    return { N: String(value) }
  }
  if (typeof value === 'boolean') {
    return { BOOL: value }
  }
  if (Array.isArray(value)) {
    return { L: value.map(v => toDynamoDBValue(v)) }
  }
  if (typeof value === 'object') {
    const map: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      map[k] = toDynamoDBValue(v)
    }
    return { M: map }
  }
  return { S: String(value) }
}

/**
 * Parse a DynamoDB attribute value to a JavaScript value
 */
export function fromDynamoDBValue(value: any): any {
  if (value.S !== undefined)
    return value.S
  if (value.N !== undefined)
    return Number(value.N)
  if (value.BOOL !== undefined)
    return value.BOOL
  if (value.NULL !== undefined)
    return null
  if (value.L !== undefined)
    return value.L.map((v: any) => fromDynamoDBValue(v))
  if (value.M !== undefined) {
    const result: Record<string, any> = {}
    for (const [k, v] of Object.entries(value.M)) {
      result[k] = fromDynamoDBValue(v)
    }
    return result
  }
  if (value.SS !== undefined)
    return value.SS
  if (value.NS !== undefined)
    return value.NS.map(Number)
  return null
}

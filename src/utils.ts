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
 * Generate a random identifier string using crypto.randomUUID()
 * @param length - The length of the identifier (default: 7)
 * @returns A random hex string identifier
 */
export function generateId(length = 7): string {
  return crypto.randomUUID().substring(0, length)
}

// Word lists for generating memorable subdomain names (adjective-noun combos)
// ~200 adjectives x ~200 nouns = ~40,000 unique combinations
const ADJECTIVES = [
  'swift', 'bold', 'calm', 'cool', 'crisp', 'dark', 'deft', 'eager', 'fair', 'fast',
  'fierce', 'fond', 'free', 'fresh', 'glad', 'grand', 'great', 'keen', 'kind', 'lush',
  'neat', 'nice', 'noble', 'odd', 'pale', 'plain', 'proud', 'pure', 'rare', 'raw',
  'real', 'rich', 'ripe', 'safe', 'shy', 'slim', 'sly', 'soft', 'sour', 'tall',
  'tame', 'tidy', 'tiny', 'trim', 'true', 'vast', 'warm', 'wide', 'wild', 'wise',
  'able', 'apt', 'avid', 'blue', 'busy', 'cozy', 'cute', 'damp', 'deep', 'dry',
  'dull', 'epic', 'even', 'fine', 'firm', 'flat', 'full', 'gold', 'good', 'gray',
  'grim', 'hale', 'hard', 'high', 'holy', 'huge', 'icy', 'idle', 'jade', 'just',
  'late', 'lazy', 'lean', 'live', 'lone', 'long', 'lost', 'loud', 'low', 'mad',
  'main', 'mega', 'mild', 'mint', 'mock', 'mute', 'new', 'next', 'numb', 'opal',
  'open', 'oval', 'peak', 'pink', 'plum', 'posh', 'quad', 'rosy', 'ruby', 'rust',
  'sage', 'salt', 'sane', 'silk', 'snug', 'solo', 'spry', 'star', 'sure', 'tart',
  'thin', 'void', 'wary', 'wavy', 'weak', 'wee', 'wet', 'zany', 'zero', 'zinc',
  'aged', 'arid', 'ashy', 'bare', 'base', 'bent', 'blunt', 'bone', 'brisk', 'buff',
  'burnt', 'chief', 'civil', 'clean', 'clear', 'close', 'cold', 'coral', 'dapper', 'dense',
  'dizzy', 'dual', 'dusty', 'early', 'extra', 'fancy', 'fiery', 'foggy', 'funky', 'fuzzy',
  'giant', 'giddy', 'glossy', 'green', 'handy', 'happy', 'hasty', 'hefty', 'humble', 'husky',
  'inner', 'ionic', 'iron', 'ivory', 'jolly', 'jumpy', 'lunar', 'magic', 'maple', 'merry',
  'mighty', 'misty', 'moody', 'mossy', 'nifty', 'novel', 'olive', 'outer', 'perky', 'petty',
  'pixel', 'polar', 'prime', 'quick', 'quiet', 'rapid', 'retro', 'rocky', 'royal', 'sandy',
]

const NOUNS = [
  'fox', 'owl', 'bee', 'elk', 'emu', 'yak', 'bat', 'cod', 'jay', 'ram',
  'ant', 'ape', 'cat', 'cow', 'dog', 'eel', 'fly', 'gnu', 'hen', 'hog',
  'koi', 'lab', 'lynx', 'mole', 'moth', 'newt', 'oryx', 'pug', 'ray', 'seal',
  'slug', 'swan', 'toad', 'wasp', 'wolf', 'wren', 'bear', 'boar', 'crab', 'crow',
  'dart', 'deer', 'dove', 'duck', 'fawn', 'fish', 'frog', 'goat', 'hawk', 'hare',
  'ibis', 'lark', 'lion', 'mink', 'mule', 'puma', 'rook', 'stag', 'tern', 'vole',
  'acre', 'arch', 'atom', 'axle', 'bard', 'bark', 'bass', 'beam', 'bell', 'bolt',
  'bone', 'brew', 'cape', 'cave', 'chip', 'clay', 'cliff', 'coil', 'cone', 'cork',
  'cube', 'dune', 'echo', 'edge', 'fern', 'flag', 'flint', 'flux', 'foam', 'fork',
  'fuse', 'gate', 'gear', 'gem', 'glow', 'grid', 'gust', 'haze', 'helm', 'hive',
  'hook', 'hull', 'jade', 'jazz', 'jest', 'kelp', 'kite', 'knot', 'lake', 'lamp',
  'leaf', 'lime', 'link', 'loft', 'loom', 'loop', 'mars', 'mast', 'maze', 'mesa',
  'mill', 'mint', 'moon', 'moss', 'nest', 'node', 'nova', 'oaks', 'opal', 'orb',
  'palm', 'pane', 'peak', 'pier', 'pine', 'plum', 'pond', 'port', 'quay', 'raft',
  'rain', 'reed', 'reef', 'ridge', 'ring', 'rock', 'root', 'rune', 'rush', 'sage',
  'sand', 'shard', 'shed', 'silk', 'silo', 'slab', 'snow', 'soil', 'spark', 'star',
  'stem', 'sun', 'surf', 'tank', 'thorn', 'tide', 'tile', 'tomb', 'tower', 'vale',
  'valve', 'vault', 'veil', 'vine', 'void', 'wave', 'well', 'whirl', 'wind', 'wire',
  'wood', 'yarn', 'yew', 'zinc', 'zone', 'pixel', 'prism', 'vapor', 'spire', 'blaze',
  'frost', 'storm', 'flame', 'flare', 'gleam', 'pulse', 'drift', 'siren', 'comet', 'nexus',
]

/**
 * Slugify a string into a valid subdomain (lowercase alphanumeric + hyphens)
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 63)
}

/**
 * Generate a subdomain, checking APP_NAME env var first, then falling back
 * to a memorable random adjective-noun combo like "swift-fox" or "bold-comet".
 * ~40,000 unique random combinations from 200 adjectives x 200 nouns.
 */
export function generateSubdomain(): string {
  const appName = process.env.APP_NAME
  if (appName) {
    const slug = slugify(appName)
    if (slug && isValidSubdomain(slug))
      return slug
  }

  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}-${noun}`
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

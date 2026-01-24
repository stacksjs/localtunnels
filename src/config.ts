import type { TunnelOptions } from './types'
import { loadConfig } from 'bunfig'

export const defaultConfig: TunnelOptions = {
  verbose: true,
}

// Lazy-loaded config to avoid top-level await (enables bun --compile)
let _config: TunnelOptions | null = null

export async function getConfig(): Promise<TunnelOptions> {
  if (!_config) {
    _config = await loadConfig({
  name: 'tunnel',
  defaultConfig,
})
  }
  return _config
}

// For backwards compatibility - synchronous access with default fallback
export const config: TunnelOptions = defaultConfig

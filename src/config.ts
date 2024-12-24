import type { TunnelOptions } from './types'
import { loadConfig } from 'bunfig'

export const defaultConfig: TunnelOptions = {
  verbose: true,
}

// eslint-disable-next-line antfu/no-top-level-await
export const config: TunnelOptions = await loadConfig({
  name: 'tunnel',
  defaultConfig,
})

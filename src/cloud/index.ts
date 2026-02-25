/**
 * LocalTunnels Cloud Infrastructure
 *
 * Uses ts-cloud to deploy a TunnelServer on EC2 with:
 * - EC2 instance running Bun + localtunnels
 * - Security group for HTTP/HTTPS/SSH
 * - Elastic IP for stable addressing
 * - Optional Route53 wildcard DNS
 */

// Export Lambda handlers for reference
export { handler as connectHandler } from './connect'
// Export deployment utilities
export { deployTunnelInfrastructure, destroyTunnelInfrastructure } from './deploy'
export type { TunnelDeployConfig, TunnelDeployResult } from './deploy'
export { handler as disconnectHandler } from './disconnect'

// Export helpers
export * from './helpers'
export { handler as httpHandler } from './https'

export { handler as messageHandler } from './message'

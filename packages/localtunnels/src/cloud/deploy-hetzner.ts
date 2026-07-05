/* eslint-disable no-console, node/prefer-global/process */
/**
 * Deploy the tunnel server to Hetzner Cloud.
 *
 * Mirrors the AWS EC2 deploy in `deploy.ts` — same on-box setup (Bun +
 * localtunnels + systemd, optional acme.sh wildcard TLS via Porkbun DNS-01,
 * served by Bun's native TLS) — but the box is provisioned through ts-cloud's
 * provider-agnostic box provisioner. DNS is not automated on this path:
 * the records to create are printed at the end.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { generateTunnelServerUserData } from './deploy'

export interface HetznerTunnelDeployConfig {
  /** Resource name prefix. @default 'localtunnel' */
  prefix?: string
  /** Domain for tunnel URLs (e.g. 'localtunnel.dev'). */
  domain?: string
  /** Hetzner server type. @default 'cx23' */
  serverType?: string
  /** Hetzner location. @default 'fsn1' */
  location?: string
  enableSsl?: boolean
  porkbunApiKey?: string
  porkbunSecretKey?: string
  /** SSH private key whose .pub gets authorized on the box. @default ~/.ssh/id_ed25519 */
  sshKeyPath?: string
  verbose?: boolean
}

export interface HetznerTunnelDeployResult {
  serverId: string
  serverName: string
  publicIp: string
  serverUrl: string
  wsUrl: string
  domain?: string
}

function log(msg: string): void {
  console.log(msg)
}

/** Hetzner API token: environment first, then the ts-cloud checkout's .env. */
function resolveToken(): string {
  const fromEnv = process.env.HCLOUD_TOKEN || process.env.HETZNER_API_TOKEN
  if (fromEnv)
    return fromEnv
  const envPath = join(homedir(), 'Code', 'Libraries', 'ts-cloud', '.env')
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, 'utf8').split('\n').find(l => l.startsWith('HETZNER_API_TOKEN='))
    const token = line?.slice('HETZNER_API_TOKEN='.length).trim().replace(/^["']|["']$/g, '')
    if (token)
      return token
  }
  throw new Error('Hetzner API token required. Set HCLOUD_TOKEN or HETZNER_API_TOKEN.')
}

function readSshPublicKey(sshKeyPath?: string): string {
  const keyPath = sshKeyPath || join(homedir(), '.ssh', 'id_ed25519')
  const pubPath = `${keyPath}.pub`
  if (!existsSync(pubPath)) {
    throw new Error(
      `SSH public key not found at ${pubPath}.\n`
      + 'Generate one with `ssh-keygen -t ed25519` or pass --ssh-key-path.',
    )
  }
  return readFileSync(pubPath, 'utf8')
}

async function loadTsCloudDrivers(): Promise<any> {
  try {
    return await import('@stacksjs/ts-cloud/drivers')
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud (>= 0.7.7) is required for Hetzner deployment.\n'
      + 'Install it with: bun add -d @stacksjs/ts-cloud',
    )
  }
}

export async function deployTunnelHetzner(config: HetznerTunnelDeployConfig = {}): Promise<HetznerTunnelDeployResult> {
  const prefix = config.prefix || 'localtunnel'
  const name = `${prefix}-server`
  const drivers = await loadTsCloudDrivers()

  const porkbunApiKey = config.porkbunApiKey || process.env.PORKBUN_API_KEY || ''
  const porkbunSecretKey = config.porkbunSecretKey || process.env.PORKBUN_SECRET_KEY || process.env.PORKBUN_SECRET_API_KEY || ''
  if (config.enableSsl && (!porkbunApiKey || !porkbunSecretKey)) {
    throw new Error(
      'Porkbun API credentials are required for SSL.\n'
      + 'Set PORKBUN_API_KEY and PORKBUN_SECRET_KEY environment variables,\n'
      + 'or pass them via --porkbun-api-key and --porkbun-secret-key.',
    )
  }

  // With SSL Bun serves TLS directly on 443; without, HTTP on 80 — same as AWS.
  const internalPort = config.enableSsl ? 443 : 80
  const bootstrapScript = generateTunnelServerUserData({
    internalPort,
    domain: config.domain,
    enableSsl: config.enableSsl,
    porkbunApiKey,
    porkbunSecretKey,
    distro: 'ubuntu',
  })

  const client = new drivers.HetznerClient({ apiToken: resolveToken() })
  const provisioner = drivers.createBoxProvisioner({ provider: 'hetzner', hetzner: client })

  log(`Provisioning "${name}" on Hetzner (${config.serverType || 'cx23'}, ${config.location || 'fsn1'})...`)
  const box = await provisioner.ensureBox({
    name,
    size: config.serverType || 'cx23',
    location: config.location || 'fsn1',
    ports: [
      { protocol: 'tcp', port: 80 },
      { protocol: 'tcp', port: 443 },
    ],
    sshPublicKey: readSshPublicKey(config.sshKeyPath),
    bootstrapScript,
    labels: { 'app': 'localtunnel-server', 'managed-by': 'localtunnels-deploy' },
  })
  log(`Server ${box.created ? 'created' : 'reused'}: #${box.id} @ ${box.publicIp}`)

  // First boot installs Bun + localtunnels and (with SSL) waits ~2-3 minutes
  // for the DNS-01 certificate, so give the health check a generous window.
  log('Waiting for the tunnel server to come up (first boot installs take a few minutes)...')
  const proto = config.enableSsl ? 'https' : 'http'
  const healthUrl = `${proto}://${box.publicIp}${internalPort === 80 || internalPort === 443 ? '' : `:${internalPort}`}/health`
  const deadline = Date.now() + 10 * 60 * 1000
  let healthy = false
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(5000),
        // The cert is issued for the domain, not the raw IP.
        ...(config.enableSsl ? { tls: { rejectUnauthorized: false } } as any : {}),
      })
      if (res.ok) {
        healthy = true
        break
      }
    }
    catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
  log(healthy
    ? 'Tunnel server is responding.'
    : 'Warning: health check did not pass yet — first boot may still be finishing. Check with: ssh root@'
      + `${box.publicIp} 'journalctl -u localtunnel -n 50'`)

  if (config.domain) {
    log('')
    log('DNS records to create (Hetzner DNS is not automated — point these at the server):')
    log(`  A   ${config.domain}        -> ${box.publicIp}`)
    log(`  A   api.${config.domain}    -> ${box.publicIp}`)
    log(`  A   *.${config.domain}      -> ${box.publicIp}`)
  }

  return {
    serverId: box.id,
    serverName: name,
    publicIp: box.publicIp,
    serverUrl: config.domain ? `${proto}://${config.domain}` : `${proto}://${box.publicIp}`,
    wsUrl: config.domain ? `${config.enableSsl ? 'wss' : 'ws'}://api.${config.domain}` : `${config.enableSsl ? 'wss' : 'ws'}://${box.publicIp}`,
    domain: config.domain,
  }
}

export async function destroyTunnelHetzner(config: { prefix?: string } = {}): Promise<void> {
  const name = `${config.prefix || 'localtunnel'}-server`
  const drivers = await loadTsCloudDrivers()
  const client = new drivers.HetznerClient({ apiToken: resolveToken() })
  const provisioner = drivers.createBoxProvisioner({ provider: 'hetzner', hetzner: client })

  log(`Destroying "${name}" on Hetzner...`)
  const { destroyed } = await provisioner.destroyBox(name)
  if (destroyed.length === 0)
    log('Nothing to destroy (already gone).')
  for (const item of destroyed)
    log(`  Destroyed ${item}`)
}

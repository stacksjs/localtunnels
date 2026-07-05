/* eslint-disable node/prefer-global/process */
/**
 * Shared config for the localtunnels VPN deployment.
 *
 * Provisioning primitives (provider-agnostic box provisioning, ssh/scp, boot
 * waits) come from ts-cloud — this file only holds what is specific to the
 * localtunnels VPN: names, ports, artifact paths, provider selection, and the
 * state file. Pick the provider with `--provider hetzner|aws` (or the
 * DEPLOY_PROVIDER env var); Hetzner is the default.
 */
import type { BoxProviderName, BoxProvisioner, RemoteExecOptions } from '@stacksjs/ts-cloud/drivers'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createBoxProvisioner, HetznerClient } from '@stacksjs/ts-cloud/drivers'

export const SERVER_NAME: string = 'localtunnels-vpn'

export const WG_PORT: number = 51820
export const WG_SUBNET: string = '10.8.0.0/24'
export const SERVER_WG_IP: string = '10.8.0.1'
export const CLIENT_WG_IP: string = '10.8.0.2'

/** Provider-native sizes for the VPN box. */
export const BOX_SIZES: Record<BoxProviderName, string> = {
  hetzner: 'cx23', // 2 vCPU / 4 GB Intel (fsn1), ~€0.008/hr
  aws: 't3.micro',
}
export const HETZNER_LOCATION: string = 'fsn1' // Falkenstein, DE
export const AWS_REGION: string = process.env.AWS_REGION || 'us-east-1'

export const SSH_KEY_PATH: string = join(homedir(), '.ssh', 'id_ed25519')
export const SSH_PUB_KEY_PATH: string = `${SSH_KEY_PATH}.pub`

/** Options passed to every ts-cloud remote-exec call. */
export const EXEC_OPTS: RemoteExecOptions = { identityFile: SSH_KEY_PATH }

/** Repo root (deploy/ → ../). */
export const REPO_ROOT: string = join(import.meta.dir, '..')
/** The CLI entrypoint and native core inside the monorepo. */
export const CLI_ENTRY: string = join(REPO_ROOT, 'packages', 'localtunnels', 'bin', 'cli.ts')
export const VPN_CORE_DIR: string = join(REPO_ROOT, 'packages', 'vpn-core')

/** Local build outputs shipped to the server. */
export const LOCAL_BIN: string = '/tmp/lt-linux-x64'
export const LOCAL_LIB: string = '/tmp/libltvpn-linux-x64.so'
/** Remote paths on the server. */
export const REMOTE_BIN: string = '/root/lt-linux-x64'
export const REMOTE_LIB: string = '/root/libltvpn-linux-x64.so'
export const REMOTE_SETUP: string = '/root/lt-server-setup.sh'
export const SETUP_SCRIPT: string = join(import.meta.dir, 'lt-server-setup.sh')

/** Local state file recording what was provisioned (for verify + destroy). */
export const STATE_PATH: string = join(import.meta.dir, '.state.json')
export const CLIENT_CONF_PATH: string = join(import.meta.dir, 'client-lt.conf')

export interface DeployState {
  provider: BoxProviderName
  serverId: string
  serverName: string
  publicIp: string
  serverPublicKey: string
  clientPublicKey: string
  createdAt: string
}

/** The provider chosen via --provider flag or DEPLOY_PROVIDER env (default hetzner). */
export function resolveProvider(): BoxProviderName {
  const flagIdx = process.argv.indexOf('--provider')
  const value = (flagIdx !== -1 ? process.argv[flagIdx + 1] : process.env.DEPLOY_PROVIDER) || 'hetzner'
  if (value !== 'hetzner' && value !== 'aws')
    throw new Error(`Unknown provider "${value}" — use hetzner or aws`)
  return value
}

/**
 * The Hetzner API token: environment first (HCLOUD_TOKEN / HETZNER_API_TOKEN),
 * then the ts-cloud checkout's .env (never committed here).
 */
export function loadHetznerToken(): string {
  const fromEnv = process.env.HCLOUD_TOKEN || process.env.HETZNER_API_TOKEN
  if (fromEnv)
    return fromEnv
  const envPath = join(homedir(), 'Code', 'Libraries', 'ts-cloud', '.env')
  if (!existsSync(envPath))
    throw new Error(`HETZNER_API_TOKEN not set and ts-cloud .env not found at ${envPath}`)
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find(l => l.startsWith('HETZNER_API_TOKEN='))
  const token = line?.slice('HETZNER_API_TOKEN='.length).trim().replace(/^["']|["']$/g, '')
  if (!token)
    throw new Error('HETZNER_API_TOKEN not found in ts-cloud .env')
  return token
}

/** Build the box provisioner for the chosen provider. */
export async function createProvisioner(provider: BoxProviderName): Promise<BoxProvisioner> {
  if (provider === 'hetzner')
    return createBoxProvisioner({ provider, hetzner: new HetznerClient({ apiToken: loadHetznerToken() }) })
  // AWS credentials resolve from the ambient environment/profile inside ts-cloud.
  const { EC2Client, SSMClient } = await import('@stacksjs/ts-cloud')
  return createBoxProvisioner({ provider, aws: { ec2: new EC2Client(AWS_REGION), ssm: new SSMClient(AWS_REGION) } })
}

/** Run a local command, throwing on non-zero exit. */
export async function run(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited
  if (code !== 0)
    throw new Error(`\`${cmd.join(' ')}\` failed (${code}): ${stderr.trim() || stdout.trim()}`)
  return stdout
}

export function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ${msg}`)
}

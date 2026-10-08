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

/**
 * A deployable region: a provider-agnostic alias (`us-west`) resolved to the
 * provider-native location and a box size that is actually orderable there.
 */
export interface RegionSpec {
  /** Provider-native location/region identifier passed to the provisioner. */
  location: string
  /** Provider-native box size. Travels with the region, not the provider — see below. */
  size: string
  /** Human-readable datacenter location. */
  label: string
}

/** Deployed when neither `--region` nor `DEPLOY_REGION` is given. */
export const DEFAULT_REGION: string = 'us-west'

/**
 * The regions this deploy knows how to provision.
 *
 * The size travels with the region rather than with the provider because
 * Hetzner's US and Singapore locations are cloud-only and do *not* carry the
 * `cx` (Intel) or `cax` (ARM) lines — only `cpx` (shared AMD) and `ccx`
 * (dedicated AMD). A `cx23` that provisions fine in `fsn1` is simply not
 * orderable in `hil`, so a single per-provider size cannot be correct.
 *
 * `cpx11` is deliberately small. Bandwidth, not CPU, is the binding constraint
 * on an exit node: Hetzner's US and Singapore boxes include ~1 TB of egress
 * against ~20 TB in the EU, so a tunnel exhausts its traffic allowance long
 * before it saturates two AMD cores.
 */
export const REGIONS: Record<BoxProviderName, Record<string, RegionSpec>> = {
  hetzner: {
    'us-west': { location: 'hil', size: 'cpx11', label: 'Hillsboro, OR' },
    'us-east': { location: 'ash', size: 'cpx11', label: 'Ashburn, VA' },
    'eu-central': { location: 'fsn1', size: 'cx23', label: 'Falkenstein, DE' },
    'eu-north': { location: 'hel1', size: 'cx23', label: 'Helsinki, FI' },
    'ap-southeast': { location: 'sin', size: 'cpx11', label: 'Singapore' },
  },
  aws: {
    'us-west': { location: 'us-west-2', size: 't3.micro', label: 'Oregon' },
    'us-east': { location: 'us-east-1', size: 't3.micro', label: 'N. Virginia' },
    'eu-central': { location: 'eu-central-1', size: 't3.micro', label: 'Frankfurt' },
    'ap-southeast': { location: 'ap-southeast-1', size: 't3.micro', label: 'Singapore' },
  },
}

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
  /** Region alias (`us-west`), so verify/destroy act on the right location. */
  region: string
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
 * The region chosen via `--region` flag or DEPLOY_REGION env.
 *
 * `AWS_REGION` is still honoured as a legacy fallback, but only when no region
 * was asked for explicitly — otherwise an ambient `AWS_REGION` in the shell
 * would silently override `--region us-west` and deploy somewhere else.
 */
export function resolveRegion(provider: BoxProviderName): { name: string, spec: RegionSpec } {
  const available = REGIONS[provider]
  const flagIdx = process.argv.indexOf('--region')
  const explicit = flagIdx !== -1 ? process.argv[flagIdx + 1] : process.env.DEPLOY_REGION

  let name = explicit
  if (!name && provider === 'aws' && process.env.AWS_REGION) {
    const legacy = Object.entries(available).find(([, spec]) => spec.location === process.env.AWS_REGION)
    name = legacy?.[0]
    if (!name)
      throw new Error(`AWS_REGION="${process.env.AWS_REGION}" is not a known region — pass --region <${Object.keys(available).join('|')}> instead`)
  }
  name ||= DEFAULT_REGION

  const spec = available[name]
  if (!spec)
    throw new Error(`Unknown region "${name}" for ${provider} — use one of: ${Object.keys(available).join(', ')}`)
  return { name, spec }
}

/**
 * Box name for a region. Suffixed so two regions can coexist on one account
 * rather than the second deploy adopting the first one's box.
 */
export function serverNameFor(region: string): string {
  return `${SERVER_NAME}-${region}`
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

/**
 * Build the box provisioner for the chosen provider.
 *
 * AWS pins its clients to a region at construction time, so the resolved
 * region has to be threaded in here rather than read from the environment.
 */
export async function createProvisioner(provider: BoxProviderName, region: RegionSpec): Promise<BoxProvisioner> {
  if (provider === 'hetzner')
    return createBoxProvisioner({ provider, hetzner: new HetznerClient({ apiToken: loadHetznerToken() }) })
  // AWS credentials resolve from the ambient environment/profile inside ts-cloud.
  const { EC2Client, SSMClient } = await import('@stacksjs/ts-cloud')
  const { location } = region
  return createBoxProvisioner({ provider, aws: { ec2: new EC2Client(location), ssm: new SSMClient(location) } })
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

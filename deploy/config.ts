/* eslint-disable node/prefer-global/process */
/**
 * Shared config for the localtunnels VPN deployment.
 *
 * Provisioning primitives (find-or-create server/firewall/ssh-key, ssh/scp,
 * boot waits) come from ts-cloud — this file only holds what is specific to
 * the localtunnels VPN: names, ports, artifact paths, and the state file.
 * Hetzner is the current provider; more arrive as ts-cloud grows.
 */
import type { RemoteExecOptions } from '@stacksjs/ts-cloud/drivers'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SERVER_NAME = 'localtunnels-vpn'
export const FIREWALL_NAME = 'localtunnels-vpn-fw'
export const SSH_KEY_NAME = 'stacks-dev' // reuse the registered key matching ~/.ssh/id_ed25519
export const SERVER_TYPE = 'cx23' // 2 vCPU / 4 GB Intel (fsn1), ~€0.008/hr
export const IMAGE = 'ubuntu-24.04'
export const LOCATION = 'fsn1' // Falkenstein, DE

export const WG_PORT = 51820
export const WG_SUBNET = '10.8.0.0/24'
export const SERVER_WG_IP = '10.8.0.1'
export const CLIENT_WG_IP = '10.8.0.2'

export const SSH_KEY_PATH = join(homedir(), '.ssh', 'id_ed25519')
export const SSH_PUB_KEY_PATH = `${SSH_KEY_PATH}.pub`

/** Options passed to every ts-cloud remote-exec call. */
export const EXEC_OPTS: RemoteExecOptions = { identityFile: SSH_KEY_PATH }

/** Repo root (deploy/ → ../). */
export const REPO_ROOT = join(import.meta.dir, '..')
/** The CLI entrypoint and native core inside the monorepo. */
export const CLI_ENTRY = join(REPO_ROOT, 'packages', 'localtunnels', 'bin', 'cli.ts')
export const VPN_CORE_DIR = join(REPO_ROOT, 'packages', 'vpn-core')

/** Local build outputs shipped to the server. */
export const LOCAL_BIN = '/tmp/lt-linux-x64'
export const LOCAL_LIB = '/tmp/libltvpn-linux-x64.so'
/** Remote paths on the server. */
export const REMOTE_BIN = '/root/lt-linux-x64'
export const REMOTE_LIB = '/root/libltvpn-linux-x64.so'
export const REMOTE_SETUP = '/root/lt-server-setup.sh'
export const SETUP_SCRIPT = join(import.meta.dir, 'lt-server-setup.sh')

/** Local state file recording what was provisioned (for verify + destroy). */
export const STATE_PATH = join(import.meta.dir, '.state.json')
export const CLIENT_CONF_PATH = join(import.meta.dir, 'client-lt.conf')

export interface DeployState {
  serverId: number
  serverName: string
  firewallId: number
  publicIp: string
  serverPublicKey: string
  clientPublicKey: string
  createdAt: string
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

/* eslint-disable node/prefer-global/process */
/**
 * Shared config + helpers for the Hetzner WireGuard VPN deployment.
 *
 * Uses ts-cloud's Hetzner API client (imported from its source) to provision a
 * real server, then configures stock kernel WireGuard on it as an exit-node VPN.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ts-cloud Hetzner client (self-contained — only depends on process.env/fetch).
export {
  HetznerClient,
  normalizeSshPublicKey,
} from '../../../../Libraries/ts-cloud/packages/ts-cloud/src/drivers/hetzner/client.ts'

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

/** Read the Hetzner API token from the ts-cloud .env (never committed here). */
export function loadHetznerToken(): string {
  const envPath = join(homedir(), 'Code', 'Libraries', 'ts-cloud', '.env')
  if (!existsSync(envPath))
    throw new Error(`ts-cloud .env not found at ${envPath}`)
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find(l => l.startsWith('HETZNER_API_TOKEN='))
  if (!line)
    throw new Error('HETZNER_API_TOKEN not found in ts-cloud .env')
  const token = line.slice('HETZNER_API_TOKEN='.length).trim().replace(/^["']|["']$/g, '')
  if (!token)
    throw new Error('HETZNER_API_TOKEN is empty')
  return token
}

const SSH_OPTS = [
  '-i', SSH_KEY_PATH,
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'LogLevel=ERROR',
  '-o', 'ConnectTimeout=10',
]

export interface SshResult {
  code: number
  stdout: string
  stderr: string
}

/** Run a command on the server over SSH. */
export async function ssh(ip: string, command: string): Promise<SshResult> {
  const proc = Bun.spawn(['ssh', ...SSH_OPTS, `root@${ip}`, command], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited
  return { code, stdout, stderr }
}

/** Run a command over SSH, throwing on non-zero exit. */
export async function sshOrThrow(ip: string, command: string): Promise<string> {
  const r = await ssh(ip, command)
  if (r.code !== 0)
    throw new Error(`ssh \`${command}\` failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`)
  return r.stdout
}

/** Poll until SSH accepts connections (server booted + key authorized). */
export async function waitForSsh(ip: string, timeoutMs = 180_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = await ssh(ip, 'echo ready')
    if (r.code === 0 && r.stdout.includes('ready'))
      return
    await Bun.sleep(5000)
  }
  throw new Error(`SSH not ready on ${ip} after ${timeoutMs}ms`)
}

/** Wait for cloud-init to finish (WireGuard install + config complete). */
export async function waitForCloudInit(ip: string, timeoutMs = 300_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = await ssh(ip, 'cloud-init status 2>/dev/null || echo unknown')
    if (r.stdout.includes('status: done'))
      return
    if (r.stdout.includes('status: error'))
      throw new Error('cloud-init reported an error; check /var/log/cloud-init-output.log')
    await Bun.sleep(5000)
  }
  throw new Error(`cloud-init did not finish on ${ip} after ${timeoutMs}ms`)
}

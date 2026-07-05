/* eslint-disable node/prefer-global/process */
/**
 * Deploy a localtunnels VPN (exit node) on Hetzner Cloud.
 *
 * Provisions the server + firewall via ts-cloud's Hetzner client, then runs the
 * localtunnels VPN stack (our own Zig/bun:ffi WireGuard implementation) on it —
 * NOT stock kernel WireGuard. Idempotent: re-running reuses server/firewall and
 * re-syncs the service.
 *
 *   bun run deploy/hetzner-vpn/deploy.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { buildClientConfig, buildCloudInit } from './cloud-init'
import {
  CLIENT_CONF_PATH,
  CLIENT_WG_IP,
  FIREWALL_NAME,
  HetznerClient,
  IMAGE,
  LOCAL_BIN,
  LOCAL_LIB,
  LOCATION,
  loadHetznerToken,
  normalizeSshPublicKey,
  REMOTE_BIN,
  REMOTE_LIB,
  REMOTE_SETUP,
  REPO_ROOT,
  run,
  scp,
  SERVER_NAME,
  SERVER_TYPE,
  SETUP_SCRIPT,
  SSH_PUB_KEY_PATH,
  SSH_KEY_NAME,
  ssh,
  sshOrThrow,
  STATE_PATH,
  waitForCloudInit,
  waitForSsh,
  WG_PORT,
} from './config'

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ${msg}`)
}

async function ensureSshKey(client: InstanceType<typeof HetznerClient>): Promise<number> {
  const localPub = normalizeSshPublicKey(readFileSync(SSH_PUB_KEY_PATH, 'utf8'))
  const keys = await client.listSshKeys()
  const match = keys.find(k => normalizeSshPublicKey(k.public_key) === localPub)
  if (match) {
    log(`SSH key: reusing "${match.name}" (#${match.id})`)
    return match.id
  }
  const created = await client.createSshKey({ name: SSH_KEY_NAME, publicKey: readFileSync(SSH_PUB_KEY_PATH, 'utf8').trim() })
  log(`SSH key: registered "${created.name}" (#${created.id})`)
  return created.id
}

async function ensureFirewall(client: InstanceType<typeof HetznerClient>): Promise<number> {
  const rules = [
    { direction: 'in' as const, protocol: 'tcp' as const, port: '22', source_ips: ['0.0.0.0/0', '::/0'], description: 'SSH' },
    { direction: 'in' as const, protocol: 'udp' as const, port: String(WG_PORT), source_ips: ['0.0.0.0/0', '::/0'], description: 'localtunnels VPN' },
    { direction: 'in' as const, protocol: 'icmp' as const, source_ips: ['0.0.0.0/0', '::/0'], description: 'ping' },
  ]
  const existing = (await client.listFirewalls()).find(f => f.name === FIREWALL_NAME)
  if (existing) {
    await client.setFirewallRules(existing.id, rules)
    log(`Firewall: reusing "${FIREWALL_NAME}" (#${existing.id}), rules synced`)
    return existing.id
  }
  const { firewall } = await client.createFirewall({ name: FIREWALL_NAME, rules })
  log(`Firewall: created "${FIREWALL_NAME}" (#${firewall.id})`)
  return firewall.id
}

/** Build the linux-x64 CLI binary + self-contained native lib locally. */
async function buildArtifacts(): Promise<void> {
  log('Building linux-x64 artifacts (CLI + libltvpn.so)...')
  await run([
    'bun',
    'build',
    './bin/cli.ts',
    '--compile',
    '--minify',
    '--external',
    '@stacksjs/ts-analytics',
    '--target=bun-linux-x64',
    `--outfile=${LOCAL_BIN}`,
  ], REPO_ROOT)
  // Self-contained musl build (no libc.so dependency → loads on any glibc host).
  await run(['zig', 'build', '-Dtarget=x86_64-linux-musl'], `${REPO_ROOT}/native`)
  await run(['cp', `${REPO_ROOT}/native/zig-out/lib/libltvpn.so`, LOCAL_LIB])
  // Restore the local (host) native lib so local tests keep working.
  await run(['zig', 'build'], `${REPO_ROOT}/native`)
  log('Artifacts built.')
}

async function main(): Promise<void> {
  const client = new HetznerClient({ apiToken: loadHetznerToken() })

  log('Provisioning Hetzner localtunnels VPN...')
  const sshKeyId = await ensureSshKey(client)
  const firewallId = await ensureFirewall(client)

  let server = (await client.listServers()).find(s => s.name === SERVER_NAME)
  if (server) {
    log(`Server: reusing "${SERVER_NAME}" (#${server.id})`)
  }
  else {
    const res = await client.createServer({
      name: SERVER_NAME,
      serverType: SERVER_TYPE,
      image: IMAGE,
      location: LOCATION,
      sshKeys: [sshKeyId],
      firewalls: [{ firewall: firewallId }],
      userData: buildCloudInit(),
      labels: { app: 'localtunnels-vpn', 'managed-by': 'localtunnels-deploy' },
    })
    server = res.server
    log(`Server: creating "${SERVER_NAME}" (#${server.id}, ${SERVER_TYPE}, ${IMAGE}, ${LOCATION})`)
  }

  // Build artifacts while the server boots.
  const artifactsBuilt = buildArtifacts()

  log('Waiting for server to reach running state...')
  server = await client.waitForServerRunning(server.id)
  const publicIp = server.public_net.ipv4?.ip
  if (!publicIp)
    throw new Error('server has no public IPv4')
  log(`Public IP: ${publicIp}`)

  log('Waiting for SSH...')
  await waitForSsh(publicIp)
  log('Waiting for cloud-init...')
  await waitForCloudInit(publicIp)
  await artifactsBuilt

  log('Shipping localtunnels binary + native lib + setup script...')
  // Stop the service first so the running binary/lib aren't busy (ETXTBSY).
  await ssh(publicIp, 'systemctl stop localtunnels-vpn.service 2>/dev/null || true')
  await scp(publicIp, [LOCAL_BIN, LOCAL_LIB, SETUP_SCRIPT], '/root/')
  await sshOrThrow(publicIp, `chmod +x ${REMOTE_BIN} ${REMOTE_SETUP}`)

  log('Configuring the localtunnels VPN service...')
  const setupOut = await sshOrThrow(publicIp, `bash ${REMOTE_SETUP}`)
  const kv: Record<string, string> = {}
  for (const line of setupOut.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0)
      kv[line.slice(0, eq)] = line.slice(eq + 1).trim()
  }
  if (kv.SERVICE !== 'active')
    throw new Error(`localtunnels VPN service not active (status: ${kv.SERVICE || 'unknown'})`)
  log(`Service: localtunnels-vpn ${kv.SERVICE}`)

  const serverPublicKey = kv.SERVER_PUB
  const clientPublicKey = kv.CLIENT_PUB
  const clientPrivateKey = kv.CLIENT_PRIV

  // A WireGuard-compatible client config (our protocol is WireGuard v1), so the
  // client works with `lt vpn up` OR a stock WireGuard client.
  const clientConf = buildClientConfig({ clientPrivateKey, serverPublicKey, endpoint: publicIp })
  writeFileSync(CLIENT_CONF_PATH, clientConf, { mode: 0o600 })

  writeFileSync(STATE_PATH, `${JSON.stringify({
    serverId: server.id,
    serverName: server.name,
    firewallId,
    publicIp,
    serverPublicKey,
    clientPublicKey,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`)

  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║        localtunnels VPN is UP on Hetzner                  ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')
  log(`  Server:      ${SERVER_NAME} (#${server.id}) @ ${publicIp}`)
  log(`  Datapath:    localtunnels lt vpn (systemd: localtunnels-vpn)`)
  log(`  Listening:   udp/${WG_PORT}, server key ${serverPublicKey}`)
  log(`  Client:      ${CLIENT_WG_IP}, config at ${CLIENT_CONF_PATH}`)
  log('')
  log(`  Verify e2e:  bun run deploy/hetzner-vpn/verify.ts`)
  log(`  Tear down:   bun run deploy/hetzner-vpn/destroy.ts`)
  log('')
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n  Deploy failed: ${err.message}\n`)
  process.exit(1)
})

/* eslint-disable node/prefer-global/process */
/**
 * Deploy the localtunnels VPN (exit node) to the cloud.
 *
 * Provisioning runs through ts-cloud (Hetzner today; providers grow with
 * ts-cloud), then the localtunnels VPN stack — our own Zig/bun:ffi WireGuard
 * implementation, NOT stock kernel WireGuard — is shipped and run as a
 * systemd service. Idempotent: re-running reuses server/firewall and
 * re-syncs the service.
 *
 *   bun run deploy:vpn
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  ensureFirewall,
  ensureServer,
  ensureSshKey,
  HetznerClient,
  scpUpload,
  serverPublicIpv4,
  sshExec,
  sshExecOrThrow,
  waitForCloudInit,
  waitForSsh,
} from '@stacksjs/ts-cloud/drivers'
import { buildClientConfig, buildCloudInit } from './cloud-init'
import {
  CLI_ENTRY,
  CLIENT_CONF_PATH,
  CLIENT_WG_IP,
  EXEC_OPTS,
  FIREWALL_NAME,
  IMAGE,
  LOCAL_BIN,
  LOCAL_LIB,
  LOCATION,
  loadHetznerToken,
  log,
  REMOTE_BIN,
  REMOTE_SETUP,
  run,
  SERVER_NAME,
  SERVER_TYPE,
  SETUP_SCRIPT,
  SSH_KEY_NAME,
  SSH_PUB_KEY_PATH,
  STATE_PATH,
  VPN_CORE_DIR,
  WG_PORT,
} from './config'

/** Build the linux-x64 CLI binary + self-contained native lib locally. */
async function buildArtifacts(): Promise<void> {
  log('Building linux-x64 artifacts (CLI + libltvpn.so)...')
  await run([
    'bun',
    'build',
    CLI_ENTRY,
    '--compile',
    '--minify',
    '--external',
    '@stacksjs/ts-analytics',
    '--target=bun-linux-x64',
    `--outfile=${LOCAL_BIN}`,
  ])
  // Self-contained musl build (no libc.so dependency → loads on any glibc host).
  await run(['zig', 'build', '-Dtarget=x86_64-linux-musl'], VPN_CORE_DIR)
  await run(['cp', `${VPN_CORE_DIR}/zig-out/lib/libltvpn.so`, LOCAL_LIB])
  // Restore the local (host) native lib so local tests keep working.
  await run(['zig', 'build'], VPN_CORE_DIR)
  log('Artifacts built.')
}

async function main(): Promise<void> {
  const client = new HetznerClient({ apiToken: loadHetznerToken() })

  log('Provisioning the localtunnels VPN (via ts-cloud)...')
  const sshKey = await ensureSshKey(client, {
    name: SSH_KEY_NAME,
    publicKey: readFileSync(SSH_PUB_KEY_PATH, 'utf8'),
  })
  log(`SSH key: ${sshKey.created ? 'registered' : 'reusing'} "${sshKey.name}" (#${sshKey.id})`)

  const firewall = await ensureFirewall(client, {
    name: FIREWALL_NAME,
    rules: [
      { direction: 'in', protocol: 'tcp', port: '22', source_ips: ['0.0.0.0/0', '::/0'], description: 'SSH' },
      { direction: 'in', protocol: 'udp', port: String(WG_PORT), source_ips: ['0.0.0.0/0', '::/0'], description: 'localtunnels VPN' },
      { direction: 'in', protocol: 'icmp', source_ips: ['0.0.0.0/0', '::/0'], description: 'ping' },
    ],
  })
  log(`Firewall: ${firewall.created ? 'created' : 'reusing (rules synced)'} "${FIREWALL_NAME}" (#${firewall.id})`)

  // Build artifacts while the server boots.
  const artifactsBuilt = buildArtifacts()

  const { server, created } = await ensureServer(client, {
    name: SERVER_NAME,
    serverType: SERVER_TYPE,
    image: IMAGE,
    location: LOCATION,
    sshKeys: [sshKey.id],
    firewalls: [{ firewall: firewall.id }],
    userData: buildCloudInit(),
    labels: { 'app': 'localtunnels-vpn', 'managed-by': 'localtunnels-deploy' },
  })
  log(`Server: ${created ? 'created' : 'reusing'} "${SERVER_NAME}" (#${server.id}, ${SERVER_TYPE}, ${IMAGE}, ${LOCATION})`)
  const publicIp = serverPublicIpv4(server)
  log(`Public IP: ${publicIp}`)

  log('Waiting for SSH...')
  await waitForSsh(publicIp, EXEC_OPTS)
  log('Waiting for cloud-init...')
  await waitForCloudInit(publicIp, EXEC_OPTS)
  await artifactsBuilt

  log('Shipping localtunnels binary + native lib + setup script...')
  // Stop the service first so the running binary/lib aren't busy (ETXTBSY).
  await sshExec(publicIp, 'systemctl stop localtunnels-vpn.service 2>/dev/null || true', EXEC_OPTS)
  await scpUpload(publicIp, [LOCAL_BIN, LOCAL_LIB, SETUP_SCRIPT], '/root/', EXEC_OPTS)
  await sshExecOrThrow(publicIp, `chmod +x ${REMOTE_BIN} ${REMOTE_SETUP}`, EXEC_OPTS)

  log('Configuring the localtunnels VPN service...')
  const setupOut = await sshExecOrThrow(publicIp, `bash ${REMOTE_SETUP}`, EXEC_OPTS)
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
    firewallId: firewall.id,
    publicIp,
    serverPublicKey,
    clientPublicKey,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`)

  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║        localtunnels VPN is UP                             ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')
  log(`  Server:      ${SERVER_NAME} (#${server.id}) @ ${publicIp}`)
  log(`  Datapath:    localtunnels lt vpn (systemd: localtunnels-vpn)`)
  log(`  Listening:   udp/${WG_PORT}, server key ${serverPublicKey}`)
  log(`  Client:      ${CLIENT_WG_IP}, config at ${CLIENT_CONF_PATH}`)
  log('')
  log(`  Verify e2e:  bun run verify:vpn`)
  log(`  Tear down:   bun run destroy:vpn`)
  log('')
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n  Deploy failed: ${err.message}\n`)
  process.exit(1)
})

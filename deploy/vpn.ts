/* eslint-disable node/prefer-global/process */
/**
 * Deploy the localtunnels VPN (exit node) to the cloud.
 *
 * Provisioning runs through ts-cloud's provider-agnostic box provisioner —
 * pick the provider with `--provider hetzner|aws` (default hetzner) — then
 * the localtunnels VPN stack (our own Zig/bun:ffi WireGuard implementation,
 * NOT stock kernel WireGuard) is shipped and run as a systemd service.
 * Idempotent: re-running reuses the box and re-syncs the service.
 *
 *   bun run deploy:vpn [-- --provider aws]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  scpUpload,
  sshExec,
  sshExecOrThrow,
  waitForCloudInit,
  waitForSsh,
} from '@stacksjs/ts-cloud/drivers'
import { buildClientConfig, VPN_BOOTSTRAP_SCRIPT } from './cloud-init'
import {
  AWS_REGION,
  BOX_SIZES,
  CLI_ENTRY,
  CLIENT_CONF_PATH,
  CLIENT_WG_IP,
  createProvisioner,
  EXEC_OPTS,
  HETZNER_LOCATION,
  LOCAL_BIN,
  LOCAL_LIB,
  log,
  REMOTE_BIN,
  REMOTE_SETUP,
  resolveProvider,
  run,
  SERVER_NAME,
  SETUP_SCRIPT,
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
  const provider = resolveProvider()
  const provisioner = await createProvisioner(provider)

  log(`Provisioning the localtunnels VPN on ${provider} (via ts-cloud)...`)

  // Build artifacts while the box boots.
  const artifactsBuilt = buildArtifacts()

  const box = await provisioner.ensureBox({
    name: SERVER_NAME,
    size: BOX_SIZES[provider],
    location: provider === 'hetzner' ? HETZNER_LOCATION : undefined,
    ports: [
      { protocol: 'udp', port: WG_PORT },
      { protocol: 'icmp' },
    ],
    sshPublicKey: readFileSync(SSH_PUB_KEY_PATH, 'utf8'),
    bootstrapScript: VPN_BOOTSTRAP_SCRIPT,
    labels: { 'app': 'localtunnels-vpn', 'managed-by': 'localtunnels-deploy' },
  })
  log(`Box: ${box.created ? 'created' : 'reusing'} "${box.name}" (#${box.id}, ${BOX_SIZES[provider]}${provider === 'aws' ? `, ${AWS_REGION}` : `, ${HETZNER_LOCATION}`})`)
  log(`Public IP: ${box.publicIp}`)

  log('Waiting for SSH...')
  await waitForSsh(box.publicIp, EXEC_OPTS)
  log('Waiting for cloud-init...')
  await waitForCloudInit(box.publicIp, EXEC_OPTS)
  await artifactsBuilt

  log('Shipping localtunnels binary + native lib + setup script...')
  // Stop the service first so the running binary/lib aren't busy (ETXTBSY).
  await sshExec(box.publicIp, 'systemctl stop localtunnels-vpn.service 2>/dev/null || true', EXEC_OPTS)
  await scpUpload(box.publicIp, [LOCAL_BIN, LOCAL_LIB, SETUP_SCRIPT], '/root/', EXEC_OPTS)
  await sshExecOrThrow(box.publicIp, `chmod +x ${REMOTE_BIN} ${REMOTE_SETUP}`, EXEC_OPTS)

  log('Configuring the localtunnels VPN service...')
  const setupOut = await sshExecOrThrow(box.publicIp, `bash ${REMOTE_SETUP}`, EXEC_OPTS)
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
  const clientConf = buildClientConfig({ clientPrivateKey, serverPublicKey, endpoint: box.publicIp })
  writeFileSync(CLIENT_CONF_PATH, clientConf, { mode: 0o600 })

  writeFileSync(STATE_PATH, `${JSON.stringify({
    provider,
    serverId: box.id,
    serverName: box.name,
    publicIp: box.publicIp,
    serverPublicKey,
    clientPublicKey,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`)

  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║        localtunnels VPN is UP                             ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')
  log(`  Provider:    ${provider}`)
  log(`  Server:      ${SERVER_NAME} (#${box.id}) @ ${box.publicIp}`)
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

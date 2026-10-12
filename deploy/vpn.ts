/* eslint-disable node/prefer-global/process */
/**
 * Deploy the localtunnels VPN (exit node) to the cloud.
 *
 * Provisioning runs through ts-cloud's provider-agnostic box provisioner —
 * pick the provider with `--provider hetzner|aws` (default hetzner) and the
 * location with `--region` (default us-west) — then the localtunnels VPN stack
 * (our own Zig/bun:ffi WireGuard implementation, NOT stock kernel WireGuard) is
 * shipped and run as a systemd service.
 * Idempotent: re-running reuses the box and re-syncs the service.
 *
 *   bun run deploy:vpn
 *   bun run deploy:vpn -- --region us-east
 *   bun run deploy:vpn -- --provider aws --region us-west
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
import { coordinatorUrlFor, writeServerEntry } from './servers-json'
import {
  CLI_ENTRY,
  CLIENT_CONF_PATH,
  COORD_PORT,
  CLIENT_WG_IP,
  createProvisioner,
  EXEC_OPTS,
  LOCAL_BIN,
  LOCAL_LIB,
  log,
  REMOTE_BIN,
  REMOTE_SETUP,
  resolveProvider,
  resolveRegion,
  run,
  serverNameFor,
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
  // glibc, built against an old version so it loads on anything newer. A musl
  // build of a *shared* library comes out static-PIE and segfaults the host
  // process on its first call — see the note in packages/vpn-core/build.zig.
  await run(['zig', 'build', '-Dtarget=x86_64-linux-gnu.2.31'], VPN_CORE_DIR)
  await run(['cp', `${VPN_CORE_DIR}/zig-out/lib/libltvpn.so`, LOCAL_LIB])
  // Restore the local (host) native lib so local tests keep working.
  await run(['zig', 'build'], VPN_CORE_DIR)
  log('Artifacts built.')
}

async function main(): Promise<void> {
  const provider = resolveProvider()
  const { name: region, spec } = resolveRegion(provider)
  const serverName = serverNameFor(region)
  const provisioner = await createProvisioner(provider, spec)

  log(`Provisioning the localtunnels VPN on ${provider} / ${region} (${spec.label}) (via ts-cloud)...`)

  // Build artifacts while the box boots.
  const artifactsBuilt = buildArtifacts()

  const box = await provisioner.ensureBox({
    name: serverName,
    size: spec.size,
    location: spec.location,
    ports: [
      { protocol: 'udp', port: WG_PORT },
      { protocol: 'tcp', port: COORD_PORT },
      { protocol: 'icmp' },
    ],
    sshPublicKey: readFileSync(SSH_PUB_KEY_PATH, 'utf8'),
    bootstrapScript: VPN_BOOTSTRAP_SCRIPT,
    labels: { 'app': 'localtunnels-vpn', 'managed-by': 'localtunnels-deploy' },
  })
  log(`Box: ${box.created ? 'created' : 'reusing'} "${box.name}" (#${box.id}, ${spec.size}, ${spec.location})`)
  log(`Public IP: ${box.publicIp}`)

  log('Waiting for SSH...')
  await waitForSsh(box.publicIp, EXEC_OPTS)
  log('Waiting for cloud-init...')
  await waitForCloudInit(box.publicIp, EXEC_OPTS)
  await artifactsBuilt

  log('Shipping localtunnels binary + native lib + setup script...')
  // Stop BOTH services first so the running binary and library are not busy.
  // They share one executable, so stopping only the datapath leaves the
  // coordinator holding it open and the upload fails with ETXTBSY — which scp
  // reports as the uninformative `dest open ... Failure`.
  await sshExec(
    box.publicIp,
    'systemctl stop localtunnels-vpn.service localtunnels-coordinator.service 2>/dev/null || true',
    EXEC_OPTS,
  )
  await scpUpload(box.publicIp, [LOCAL_BIN, LOCAL_LIB, SETUP_SCRIPT], '/root/', EXEC_OPTS)
  await sshExecOrThrow(box.publicIp, `chmod +x ${REMOTE_BIN} ${REMOTE_SETUP}`, EXEC_OPTS)

  log('Configuring the localtunnels VPN service...')
  const setupOut = await sshExecOrThrow(box.publicIp, `bash ${REMOTE_SETUP} ${box.publicIp}`, EXEC_OPTS)
  const kv: Record<string, string> = {}
  for (const line of setupOut.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0)
      kv[line.slice(0, eq)] = line.slice(eq + 1).trim()
  }
  if (kv.COORDINATOR !== 'active')
    throw new Error(`localtunnels coordinator not active (status: ${kv.COORDINATOR || 'unknown'})`)
  if (kv.SERVICE !== 'active')
    throw new Error(`localtunnels VPN service not active (status: ${kv.SERVICE || 'unknown'})`)
  log(`Service: localtunnels-coordinator ${kv.COORDINATOR}, localtunnels-vpn ${kv.SERVICE}`)

  const serverPublicKey = kv.SERVER_PUB
  const clientPublicKey = kv.CLIENT_PUB
  const clientPrivateKey = kv.CLIENT_PRIV
  const authKey = kv.AUTH_KEY
  if (!authKey)
    throw new Error('the setup script did not report an AUTH_KEY, so clients would have no way to enrol')

  // A WireGuard-compatible client config (our protocol is WireGuard v1), so the
  // client works with `lt vpn up` OR a stock WireGuard client.
  const clientConf = buildClientConfig({ clientPrivateKey, serverPublicKey, endpoint: box.publicIp })
  writeFileSync(CLIENT_CONF_PATH, clientConf, { mode: 0o600 })

  writeFileSync(STATE_PATH, `${JSON.stringify({
    provider,
    region,
    serverId: box.id,
    serverName: box.name,
    publicIp: box.publicIp,
    serverPublicKey,
    clientPublicKey,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`)

  /*
   * Hand the server to the desktop app.
   *
   * The exit is pinned to this box's own key rather than left as `auto`.
   * `auto` takes the lowest-sorted peer advertising itself as an exit, and the
   * coordinator relays that claim without being able to check it — so on a
   * network where anyone holds the auth key, `auto` is a vote. We know which
   * node is the exit here, because we just built it.
   */
  const coordinatorUrl = coordinatorUrlFor(box.publicIp, COORD_PORT)
  const serversPath = writeServerEntry(region, { coordinatorUrl, authKey, useExit: serverPublicKey })

  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║        localtunnels VPN is UP                             ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')
  log(`  Provider:    ${provider}`)
  log(`  Region:      ${region} — ${spec.label} (${spec.location}, ${spec.size})`)
  log(`  Server:      ${serverName} (#${box.id}) @ ${box.publicIp}`)
  log(`  Datapath:    localtunnels lt vpn (systemd: localtunnels-vpn)`)
  log(`  Listening:   udp/${WG_PORT}, server key ${serverPublicKey}`)
  log(`  Client:      ${CLIENT_WG_IP}, config at ${CLIENT_CONF_PATH}`)
  log('')
  log(`  Coordinator: ${coordinatorUrl} (auth key in ${serversPath})`)
  log(`  BuddyVPN:    ${region} is configured — open the app and press Connect`)
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

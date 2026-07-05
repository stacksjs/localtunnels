/* eslint-disable node/prefer-global/process */
/**
 * Deploy a WireGuard VPN (exit node) on Hetzner Cloud via ts-cloud's Hetzner
 * client. Idempotent: re-running reuses an existing server/firewall by name.
 *
 *   bun run deploy/hetzner-vpn/deploy.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { encodeKey, generateKeyPair } from '../../src/vpn'
import { buildClientConfig, buildCloudInit } from './cloud-init'
import {
  CLIENT_CONF_PATH,
  CLIENT_WG_IP,
  FIREWALL_NAME,
  HetznerClient,
  IMAGE,
  LOCATION,
  loadHetznerToken,
  normalizeSshPublicKey,
  SERVER_NAME,
  SERVER_TYPE,
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
    { direction: 'in' as const, protocol: 'udp' as const, port: String(WG_PORT), source_ips: ['0.0.0.0/0', '::/0'], description: 'WireGuard' },
    { direction: 'in' as const, protocol: 'icmp' as const, source_ips: ['0.0.0.0/0', '::/0'], description: 'ping' },
  ]
  const existing = (await client.listFirewalls()).find(f => f.name === FIREWALL_NAME)
  if (existing) {
    await client.setFirewallRules(existing.id, rules)
    log(`Firewall: reusing "${FIREWALL_NAME}" (#${existing.id}), rules synced`)
    return existing.id
  }
  const { firewall } = await client.createFirewall({ name: FIREWALL_NAME, rules })
  log(`Firewall: created "${FIREWALL_NAME}" (#${firewall.id}) — ssh/22, wg/${WG_PORT}, icmp`)
  return firewall.id
}

async function main(): Promise<void> {
  const client = new HetznerClient({ apiToken: loadHetznerToken() })

  log('Provisioning Hetzner WireGuard VPN...')
  const sshKeyId = await ensureSshKey(client)
  const firewallId = await ensureFirewall(client)

  // Idempotent: reuse an existing server with our name.
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

  log('Waiting for server to reach running state...')
  server = await client.waitForServerRunning(server.id)
  const publicIp = server.public_net.ipv4?.ip
  if (!publicIp)
    throw new Error('server has no public IPv4')
  log(`Public IP: ${publicIp}`)

  log('Waiting for SSH...')
  await waitForSsh(publicIp)
  log('Waiting for cloud-init (WireGuard install + config)...')
  await waitForCloudInit(publicIp)

  // Confirm the interface actually came up.
  const wgReady = await ssh(publicIp, 'test -f /etc/wireguard/.ready && wg show wg0 >/dev/null 2>&1 && echo ok || echo no')
  if (!wgReady.stdout.includes('ok'))
    throw new Error('WireGuard interface wg0 not up after cloud-init')
  log('WireGuard wg0 is up.')

  const serverPublicKey = (await sshOrThrow(publicIp, 'cat /etc/wireguard/server_public.key')).trim()

  // Generate a client keypair with our OWN WireGuard-compatible keygen and add
  // it as a peer — a real interop check that localtunnels keys work with stock
  // kernel WireGuard.
  const kp = generateKeyPair()
  const clientPrivateKey = encodeKey(kp.privateKey)
  const clientPublicKey = encodeKey(kp.publicKey)

  await sshOrThrow(publicIp, `wg set wg0 peer ${clientPublicKey} allowed-ips ${CLIENT_WG_IP}/32`)
  // Persist the peer so it survives a reboot / wg-quick restart.
  await sshOrThrow(publicIp, `grep -q '${clientPublicKey}' /etc/wireguard/wg0.conf || printf '\\n[Peer]\\nPublicKey = ${clientPublicKey}\\nAllowedIPs = ${CLIENT_WG_IP}/32\\n' >> /etc/wireguard/wg0.conf`)
  log(`Client peer added (${CLIENT_WG_IP}).`)

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
  log('║           Hetzner WireGuard VPN is UP                     ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')
  log(`  Server:      ${SERVER_NAME} (#${server.id}) @ ${publicIp}`)
  log(`  WireGuard:   udp/${WG_PORT}, server ${serverPublicKey}`)
  log(`  Client cfg:  ${CLIENT_CONF_PATH}`)
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

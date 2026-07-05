/* eslint-disable node/prefer-global/process */
/**
 * Tear down the Hetzner WireGuard VPN: delete the server, then its firewall.
 *
 *   bun run deploy/hetzner-vpn/destroy.ts
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import {
  CLIENT_CONF_PATH,
  FIREWALL_NAME,
  HetznerClient,
  loadHetznerToken,
  SERVER_NAME,
  STATE_PATH,
} from './config'

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ${msg}`)
}

async function main(): Promise<void> {
  const client = new HetznerClient({ apiToken: loadHetznerToken() })

  // Prefer state; fall back to discovery by name so teardown works regardless.
  let serverId: number | undefined
  let firewallId: number | undefined
  if (existsSync(STATE_PATH)) {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    serverId = s.serverId
    firewallId = s.firewallId
  }

  const server = (await client.listServers()).find(s => s.id === serverId || s.name === SERVER_NAME)
  if (server) {
    log(`Deleting server "${server.name}" (#${server.id})...`)
    const action = await client.deleteServer(server.id)
    await client.waitForAction(action.id).catch(() => {})
    log('Server deleted.')
  }
  else {
    log('No matching server found (already gone).')
  }

  // A firewall can only be deleted once no server references it.
  const firewall = (await client.listFirewalls()).find(f => f.id === firewallId || f.name === FIREWALL_NAME)
  if (firewall) {
    // Give Hetzner a moment to detach the firewall from the deleted server.
    for (let i = 0; i < 10; i++) {
      try {
        await client.deleteFirewall(firewall.id)
        log(`Firewall "${firewall.name}" (#${firewall.id}) deleted.`)
        break
      }
      catch (err: any) {
        if (i === 9) {
          log(`Could not delete firewall (${err.message}); delete it manually if needed.`)
          break
        }
        await Bun.sleep(3000)
      }
    }
  }

  for (const p of [STATE_PATH, CLIENT_CONF_PATH]) {
    if (existsSync(p))
      rmSync(p)
  }
  log('Teardown complete.')
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n  Destroy failed: ${err.message}\n`)
  process.exit(1)
})

/* eslint-disable node/prefer-global/process */
/**
 * Tear down the localtunnels VPN: delete the box and its firewall/security
 * group on whichever provider it was deployed to (recorded in the state file;
 * override with --provider).
 *
 *   bun run destroy:vpn
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import {
  CLIENT_CONF_PATH,
  createProvisioner,
  log,
  resolveProvider,
  SERVER_NAME,
  STATE_PATH,
} from './config'

async function main(): Promise<void> {
  // Prefer the provider recorded at deploy time; fall back to flag/env/default
  // so teardown still works without local state.
  let provider = resolveProvider()
  if (!process.argv.includes('--provider') && existsSync(STATE_PATH)) {
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    if (state.provider === 'hetzner' || state.provider === 'aws')
      provider = state.provider
  }

  const provisioner = await createProvisioner(provider)
  log(`Destroying "${SERVER_NAME}" on ${provider}...`)
  const { destroyed } = await provisioner.destroyBox(SERVER_NAME)
  if (destroyed.length === 0)
    log('No matching resources found (already gone).')
  for (const item of destroyed)
    log(`Destroyed ${item}.`)

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

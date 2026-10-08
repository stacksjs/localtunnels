/* eslint-disable node/prefer-global/process */
/**
 * Tear down the localtunnels VPN: delete the box and its firewall/security
 * group on whichever provider and region it was deployed to (both recorded in
 * the state file; override with --provider / --region).
 *
 *   bun run destroy:vpn
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import {
  CLIENT_CONF_PATH,
  createProvisioner,
  log,
  REGIONS,
  resolveProvider,
  resolveRegion,
  serverNameFor,
  STATE_PATH,
} from './config'

async function main(): Promise<void> {
  // Prefer what was recorded at deploy time; fall back to flag/env/default so
  // teardown still works without local state.
  const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : null

  let provider = resolveProvider()
  if (!process.argv.includes('--provider') && (state?.provider === 'hetzner' || state?.provider === 'aws'))
    provider = state.provider

  // The region decides which AWS endpoint the box lives behind, so an explicit
  // flag wins, then the state file, then the default.
  let region = resolveRegion(provider).name
  if (!process.argv.includes('--region') && typeof state?.region === 'string' && REGIONS[provider][state.region])
    region = state.region
  const spec = REGIONS[provider][region]

  // Boxes deployed before the name carried a region suffix are recorded in
  // state under their old name, so that name wins when it is there.
  const serverName: string = typeof state?.serverName === 'string' ? state.serverName : serverNameFor(region)

  const provisioner = await createProvisioner(provider, spec)
  log(`Destroying "${serverName}" on ${provider} / ${region} (${spec.label})...`)
  const { destroyed } = await provisioner.destroyBox(serverName)
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

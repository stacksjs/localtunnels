/**
 * Telling BuddyVPN about a server the deploy just created.
 *
 * Without this, provisioning a box left you with a working coordinator and an
 * app that had never heard of it — the window said "No server in United
 * States yet" beside a server you were already paying for, and the fix was to
 * hand-write JSON into Application Support. That is not a deploy, it is a
 * deploy and then a chore.
 *
 * The file is a map of region id to connection details, read by
 * `packages/buddyvpn/src/vpn/control.ts`. Everything in it is validated again
 * on the app side before it reaches a command, because a file on disk is not
 * a promise; this writer produces a shape that passes, rather than relying on
 * having produced it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ServerEntry {
  /** `ws://` or `wss://` host, with an optional port. No path. */
  coordinatorUrl: string
  /** The shared secret clients present to enrol. */
  authKey?: string
  /** A specific exit node's public key, or `auto`. */
  useExit?: string
}

export type ServerMap = Record<string, ServerEntry>

/** Where the macOS app looks. */
export function buddyVpnServersPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'BuddyVPN', 'servers.json')
}

/**
 * Merge one region into whatever is already there.
 *
 * Merged rather than overwritten because the file describes every region at
 * once: deploying `eu-central` must not forget the `us-west` server that is
 * still running and still being billed for.
 *
 * Unparseable existing content is replaced rather than merged into. The
 * alternative is refusing to record a server that now exists, which leaves
 * the app pointing at nothing over a file nobody can read anyway.
 */
export function mergeServerEntry(existing: unknown, region: string, entry: ServerEntry): ServerMap {
  const base: ServerMap = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...(existing as ServerMap) }
    : {}
  base[region] = entry
  return base
}

export function readServerMap(path: string): unknown {
  if (!existsSync(path))
    return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  catch {
    return {}
  }
}

/**
 * Record this region's server, returning where it was written.
 *
 * `0600`, because the auth key in here is the credential that admits a client
 * to the network — anyone who can read this file can join it.
 */
export function writeServerEntry(region: string, entry: ServerEntry, path: string = buddyVpnServersPath()): string {
  const merged = mergeServerEntry(readServerMap(path), region, entry)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 })
  return path
}

/**
 * The coordinator URL for a box.
 *
 * `ws://` rather than `wss://`: the coordinator terminates no TLS, and
 * claiming otherwise in a URL the app validates would produce a client that
 * fails its handshake with nothing to say about why. The directory it carries
 * is peer keys and assigned addresses, and joining it already requires the
 * auth key — but this is still a plaintext control channel on the public
 * internet, which is a thing to fix with a certificate rather than a prefix.
 */
export function coordinatorUrlFor(publicIp: string, port: number): string {
  return `ws://${publicIp}:${port}`
}

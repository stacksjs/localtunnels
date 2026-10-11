/**
 * Read-only view of the VPN on this Mac.
 *
 * Everything here observes: no interface is created, no key is generated,
 * nothing is asked for a password. Two consequences worth knowing when
 * reading the output:
 *
 *  - Identity is **read, never created**. `localtunnels vpn:keygen` mints a
 *    keypair on first use, which is right for a command someone typed and
 *    wrong for a window they happened to open. A Mac with no identity reports
 *    none.
 *  - A tunnel interface cannot be attributed to this app. The kernel does not
 *    record which process asked for a `utun`, and macOS hands them out to
 *    iCloud Private Relay and every other VPN as well. So an interface is
 *    reported as *falling in a range localtunnels assigns*, which is a strong
 *    hint and not proof.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { exec, shellEscape, TtlCache } from '../support/shell'

export interface VpnCore {
  available: boolean
  cliPath: string | null
  version: string | null
  /**
   * Whether `vpn:selftest` passed: `libltvpn` loaded and a handshake, an
   * encrypted roundtrip and replay rejection all worked. Null when there was
   * no CLI to ask.
   */
  healthy: boolean | null
  detail: string | null
}

export interface VpnIdentity {
  /** base64 X25519 public key — shareable, and what peers authorize. */
  publicKey: string
  publicKeyPath: string
}

export interface TunnelInterface {
  name: string
  address: string
  peer: string | null
  mtu: number | null
  /** The address falls in a range localtunnels assigns. A hint, not proof. */
  localtunnelsRange: boolean
}

/**
 * Ranges localtunnels hands out, used to guess which `utun` is ours.
 *
 * `100.64.0.0/10` is the carrier-grade NAT block from RFC 6598, which the
 * coordinator allocates from — the same choice Tailscale made, and for the
 * same reason: routable space nobody uses on a LAN. `10.8.0.0/24` is what the
 * VPN deploy configures.
 */
const TUNNEL_RANGES = ['100.64.0.0/10', '10.8.0.0/24'].map((cidr) => {
  const [addr, prefix] = cidr.split('/')
  const bits = Number.parseInt(prefix)
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
  return { cidr, base: (ipToInt(addr) & mask) >>> 0, mask }
})

function ipToInt(address: string): number {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255))
    return -1
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0)
}

export function inTunnelRange(address: string): boolean {
  const value = ipToInt(address)
  if (value < 0)
    return false
  return TUNNEL_RANGES.some(range => ((value & range.mask) >>> 0) === range.base)
}

const coreCache = new TtlCache<VpnCore>(60_000)

/** `~/.localtunnels/vpn`, honouring the same override the CLI reads. */
export function vpnDir(): string {
  const base = process.env.LOCALTUNNELS_HOME || path.join(os.homedir(), '.localtunnels')
  return path.join(base, 'vpn')
}

/**
 * This Mac's VPN identity, or null when it has none.
 *
 * Only the public half is read. The private key sits next to it at 0600 and
 * this app has no reason to open it.
 */
export function readIdentity(): VpnIdentity | null {
  const publicKeyPath = path.join(vpnDir(), 'publickey')
  try {
    const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim()
    return publicKey ? { publicKey, publicKeyPath } : null
  }
  catch {
    return null
  }
}

/**
 * Locate the localtunnels CLI.
 *
 * Unlike SystemCleaner — which had to go looking on PATH and report "not
 * installed" when it found nothing — this app *ships* the CLI beside its own
 * launcher, so the bundled copy is the answer and "not installed" is not a
 * state a packaged build can reach. PATH is still consulted for development
 * runs, where there is no bundle.
 */
export function findCli(): string | null {
  const explicit = process.env.LOCALTUNNELS_BIN
  if (explicit) {
    try {
      fs.accessSync(explicit, fs.constants.X_OK)
      return explicit
    }
    catch {
      return null
    }
  }

  const bundled = path.join(path.dirname(process.execPath), 'localtunnels')
  if (fs.existsSync(bundled))
    return bundled

  for (const name of ['localtunnels', 'lt']) {
    const found = exec(`command -v ${name}`, { timeout: 2000 })
    if (found.ok && found.stdout)
      return found.stdout.split('\n')[0].trim()
  }
  return null
}

/** Find the CLI and ask whether its native core is healthy. */
export function readCore(refresh = false): VpnCore {
  if (refresh)
    coreCache.clear()
  const cached = coreCache.get()
  if (cached)
    return cached

  const cliPath = findCli()
  if (!cliPath) {
    const core: VpnCore = {
      available: false,
      cliPath: null,
      version: null,
      healthy: null,
      detail: 'No localtunnels CLI. A packaged build ships one; set LOCALTUNNELS_BIN when running from source.',
    }
    coreCache.set(core)
    return core
  }

  // Probed from a neutral directory: the CLI is a compiled Bun binary and Bun
  // reads `bunfig.toml` from the working directory, so probing it from inside
  // a project makes it inherit that project's preload and fail for reasons
  // that have nothing to do with the CLI.
  const at = { cwd: os.tmpdir() }
  const version = exec(`${shellEscape(cliPath)} --version`, { ...at, timeout: 5000 })
  // `vpn:selftest` needs no root: it runs entirely in-process.
  const selftest = exec(`${shellEscape(cliPath)} vpn:selftest`, { ...at, timeout: 20_000 })
  const healthy = selftest.ok && /VPN core is healthy/i.test(selftest.stdout)

  const core: VpnCore = {
    available: true,
    cliPath,
    version: version.ok ? version.stdout.split('\n')[0].trim() || null : null,
    healthy,
    detail: healthy
      ? null
      : (selftest.stderr || selftest.stdout || '').split('\n').filter(Boolean).slice(-1)[0]
        || 'vpn:selftest did not report a healthy core.',
  }
  coreCache.set(core)
  return core
}

/**
 * Tunnel devices with an IPv4 address.
 *
 * Split from the `ifconfig` call so the parsing can be tested without one.
 * The `utun` devices macOS keeps for iCloud Private Relay carry only
 * link-local IPv6 and never appear here.
 */
export function parseIfconfig(output: string): TunnelInterface[] {
  const tunnels: TunnelInterface[] = []
  let current: { name: string, mtu: number | null } | null = null

  for (const line of output.split('\n')) {
    const header = line.match(/^(\w+):\s.*?mtu\s+(\d+)/)
    if (header) {
      current = { name: header[1], mtu: Number(header[2]) }
      continue
    }
    if (!current || !/^(?:utun|tun|ppp)/.test(current.name))
      continue

    const inet = line.match(/^\s*inet (\d+\.\d+\.\d+\.\d+)(?:\s+-->\s+(\d+\.\d+\.\d+\.\d+))?/)
    if (!inet)
      continue

    tunnels.push({
      name: current.name,
      address: inet[1],
      peer: inet[2] ?? null,
      mtu: current.mtu,
      localtunnelsRange: inTunnelRange(inet[1]),
    })
  }

  return tunnels
}

export function readTunnels(): TunnelInterface[] {
  const result = exec('ifconfig', { timeout: 5000 })
  return result.ok ? parseIfconfig(result.stdout) : []
}

import { debugLog } from './utils'

const DNS_TIMEOUT_MS = 3000

/**
 * Run a command with sudo.
 * 1. If SUDO_PASSWORD env var is set, pipe it to sudo -S
 * 2. Otherwise, try passwordless sudo -n
 * 3. If that fails, use interactive sudo (prompts user in terminal)
 */
async function sudoExec(args: string[], verbose?: boolean): Promise<boolean> {
  const sudoPassword = process.env.SUDO_PASSWORD
  if (sudoPassword) {
    const proc = Bun.spawn(['sudo', '-S', ...args], {
      stdin: new Blob([`${sudoPassword}\n`]),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await proc.exited
    return proc.exitCode === 0
  }

  // Try passwordless sudo first
  const proc = Bun.spawn(['sudo', '-n', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc.exited
  if (proc.exitCode === 0) return true

  // Fall back to interactive sudo (will prompt user in terminal)
  debugLog('hosts', 'Requesting sudo access for DNS fix (you may be prompted for your password)', verbose)
  const interactive = Bun.spawn(['sudo', ...args], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await interactive.exited
  return interactive.exitCode === 0
}

/**
 * Resolve a hostname to an IP address using multiple fallback strategies:
 * 1. System DNS (Bun.dns.resolve)
 * 2. DNS-over-HTTPS via Cloudflare
 * 3. dig @8.8.8.8 as last resort
 */
export async function resolveHostname(hostname: string, verbose?: boolean): Promise<string | null> {
  // Strategy 1: Bun.dns.lookup with timeout
  try {
    const records = await Promise.race([
      Bun.dns.lookup(hostname, { family: 4 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), DNS_TIMEOUT_MS)),
    ])
    if (records.length > 0) {
      debugLog('hosts', `Resolved ${hostname} via system DNS: ${records[0].address}`, verbose)
      return records[0].address
    }
  }
  catch {
    debugLog('hosts', `System DNS failed for ${hostname}, trying DoH...`, verbose)
  }

  // Strategy 2: DNS-over-HTTPS (Cloudflare)
  try {
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`
    const response = await fetch(dohUrl, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
    })
    if (response.ok) {
      const data = await response.json() as { Answer?: Array<{ type: number, data: string }> }
      const aRecord = data.Answer?.find(r => r.type === 1)
      if (aRecord) {
        debugLog('hosts', `Resolved ${hostname} via DoH: ${aRecord.data}`, verbose)
        return aRecord.data
      }
    }
  }
  catch {
    debugLog('hosts', `DoH failed for ${hostname}, trying dig...`, verbose)
  }

  // Strategy 3: dig @8.8.8.8
  try {
    const proc = Bun.spawn(['dig', '@8.8.8.8', hostname, 'A', '+short'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    const ip = output.trim().split('\n').find(line => /^\d+\.\d+\.\d+\.\d+$/.test(line))
    if (ip) {
      debugLog('hosts', `Resolved ${hostname} via dig: ${ip}`, verbose)
      return ip
    }
  }
  catch {
    debugLog('hosts', `dig failed for ${hostname}`, verbose)
  }

  return null
}

/**
 * Check if the system can actually reach a hostname via HTTPS/HTTP.
 * Bun.dns.resolve uses a different code path than fetch/WebSocket on macOS,
 * and /etc/resolver overrides (e.g. for .dev TLD) can make /etc/hosts useless.
 * The only reliable check is an actual connection attempt.
 */
export async function canSystemConnect(hostname: string, secure: boolean): Promise<boolean> {
  try {
    const protocol = secure ? 'https' : 'http'
    await fetch(`${protocol}://${hostname}/health`, {
      signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
    })
    return true
  }
  catch {
    return false
  }
}

/**
 * On macOS, /etc/resolver/dev can override DNS for all .dev domains,
 * routing queries to a broken local DNS server (e.g. Docker Desktop on 127.0.0.1:15353).
 * This makes browsers unable to resolve *.localtunnel.dev even though dig works.
 *
 * Fix: create /etc/resolver/<hostname> with `nameserver 8.8.8.8` to override
 * the broken .dev resolver for just our tunnel domain.
 */
export async function ensureMacOSResolver(hostname: string, verbose?: boolean): Promise<boolean> {
  if (process.platform !== 'darwin') return false

  // Check if /etc/resolver/dev exists (the root cause)
  try {
    await Bun.file('/etc/resolver/dev').text()
  }
  catch {
    debugLog('hosts', 'No /etc/resolver/dev found, macOS resolver fix not needed', verbose)
    return false
  }

  const resolverPath = `/etc/resolver/${hostname}`

  // Check if we already created the resolver file
  try {
    const existing = await Bun.file(resolverPath).text()
    if (existing.includes('nameserver')) {
      debugLog('hosts', `Resolver file ${resolverPath} already exists`, verbose)
      return true
    }
  }
  catch {
    // File doesn't exist, need to create it
  }

  const content = `# Created by localtunnels — fixes .dev TLD DNS on macOS\nnameserver 8.8.8.8\n`

  try {
    const tmpFile = `/tmp/localtunnels-resolver-${Date.now()}`
    await Bun.write(tmpFile, content)

    const success = await sudoExec(['cp', tmpFile, resolverPath], verbose)

    // Clean up temp file
    try { await Bun.spawn(['rm', tmpFile]).exited }
    catch { /* ignore */ }

    if (success) {
      debugLog('hosts', `Created resolver file ${resolverPath}`, verbose)
      await flushDnsCache(verbose)
      return true
    }

    debugLog('hosts', `Could not create ${resolverPath} (sudo required)`, verbose, 'warn')
    return false
  }
  catch (err) {
    debugLog('hosts', `Failed to create resolver file: ${err}`, verbose, 'warn')
    return false
  }
}

/**
 * Remove the macOS resolver file created by ensureMacOSResolver.
 */
export async function cleanupMacOSResolver(hostname: string, verbose?: boolean): Promise<void> {
  if (process.platform !== 'darwin') return

  const resolverPath = `/etc/resolver/${hostname}`

  try {
    // Check if file exists and was created by us
    const content = await Bun.file(resolverPath).text()
    if (!content.includes('localtunnels')) return

    await sudoExec(['rm', resolverPath], verbose)
    debugLog('hosts', `Removed resolver file ${resolverPath}`, verbose)
    await flushDnsCache(verbose)
  }
  catch {
    // File doesn't exist or can't be removed — that's fine
  }
}

async function flushDnsCache(verbose?: boolean): Promise<void> {
  if (process.platform !== 'darwin') return
  try {
    await sudoExec(['dscacheutil', '-flushcache'], verbose)
    await sudoExec(['killall', '-HUP', 'mDNSResponder'], verbose)
    debugLog('hosts', 'Flushed DNS cache', verbose)
  }
  catch {
    debugLog('hosts', 'Could not flush DNS cache', verbose, 'warn')
  }
}

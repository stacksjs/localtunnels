import { debugLog } from './utils'

const DNS_TIMEOUT_MS = 3000

/**
 * Resolve a hostname to an IP address using multiple fallback strategies:
 * 1. System DNS (Bun.dns.resolve)
 * 2. DNS-over-HTTPS via Cloudflare
 * 3. dig @8.8.8.8 as last resort
 */
export async function resolveHostname(hostname: string, verbose?: boolean): Promise<string | null> {
  // Strategy 1: Bun.dns.resolve with timeout
  try {
    const records = await Promise.race([
      Bun.dns.resolve(hostname, 'A'),
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

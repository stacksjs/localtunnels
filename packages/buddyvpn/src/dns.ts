/**
 * The resolvers this app will use, by name.
 *
 * A leaf module on purpose: both the settings store and the privileged helper
 * need these, and `control.ts` and `helper.ts` already import each other.
 * Putting a third party into that cycle is how an import ordering bug gets
 * introduced that only shows up in a compiled bundle.
 *
 * Offered by name rather than as an address box because the choice reaches a
 * command running as root. Free text there would let anything running as this
 * user point the machine at a resolver of its own, with no password — which
 * is precisely what the helper exists to prevent. A fixed list means the
 * worst a caller can do is pick a different well-known resolver.
 */
export const DNS_PRESETS = {
  cloudflare: ['1.1.1.1', '1.0.0.1'],
  google: ['8.8.8.8', '8.8.4.4'],
  quad9: ['9.9.9.9', '149.112.112.112'],
} as const

export type DnsPreset = keyof typeof DNS_PRESETS

export const DNS_LABELS: Record<DnsPreset, string> = {
  cloudflare: 'Cloudflare (1.1.1.1)',
  google: 'Google (8.8.8.8)',
  quad9: 'Quad9 (9.9.9.9)',
}

export function isDnsPreset(value: unknown): value is DnsPreset {
  return typeof value === 'string' && value in DNS_PRESETS
}

/** The addresses for a preset, as the CLI's `--dns` wants them. */
export function dnsServers(preset: DnsPreset): string {
  return DNS_PRESETS[preset].join(',')
}

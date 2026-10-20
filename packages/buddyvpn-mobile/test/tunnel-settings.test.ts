/**
 * What this tunnel tells iOS about itself, and the family it used to leave
 * out.
 *
 * `NEPacketTunnelNetworkSettings` is a description, not a request: iOS
 * routes what the description claims and leaves everything else on the
 * physical interface. So a family of addresses the description does not
 * mention is not blocked, and is not an error — it simply goes around the
 * tunnel, which is the one failure this app cannot afford, because the badge
 * is showing and the screen says Connected.
 *
 * Read as text, because this Swift compiles against iOS SDKs and runs in a
 * Network Extension. Reading cannot prove a packet goes where it should. It
 * does pin the claims, so removing one is a failing test rather than a quiet
 * return to leaking.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8')

const PROVIDER = read(PACKAGE_DIR, 'native', 'ios', 'PacketTunnelProvider.swift')
const FULLTUNNEL = read(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'fulltunnel.ts')

/** The body of `networkSettings`, so a claim cannot pass by being in a comment. */
const SETTINGS = (() => {
  const body = /func networkSettings\([\s\S]*?\n {4}\}/.exec(PROVIDER)
  if (!body)
    throw new Error('PacketTunnelProvider.swift has no networkSettings')
  return body[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
})()

describe('IPv6', () => {
  /*
   * The premise, in the desktop's own words. If the tunnel ever learns to
   * carry v6 this stops being a leak and the dropping below stops being
   * right — so the claim that it cannot is checked rather than assumed.
   */
  it('is not something this tunnel carries', () => {
    const interfaceTs = read(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'interface.ts')
    // The exit's route set, which is what a peer is permitted to carry.
    expect(interfaceTs).toMatch(/allowedIps = rec\.publicKey === exit[\s\S]{0,120}'0\.0\.0\.0\/0'/)
    expect(interfaceTs).not.toContain('\'::/0\'')
    // And the desktop, which has shipped longer, treats the gap as the leak
    // it is rather than as a limitation.
    expect(FULLTUNNEL).toContain('export function ipv6Commands')
  })

  /*
   * The regression. With no `ipv6Settings`, v6 stays on the physical
   * interface: every AAAA destination is reached outside the tunnel with the
   * real address, while iOS shows the badge.
   */
  it('is claimed by the tunnel rather than left on the interface', () => {
    expect(SETTINGS).toContain('NEIPv6Settings(')
    expect(SETTINGS).toContain('settings.ipv6Settings = ipv6')
    expect(SETTINGS).toContain('ipv6.includedRoutes = [NEIPv6Route.default()]')
  })

  /*
   * And claimed unconditionally. Behind `if allowLan`, or any other flag, it
   * would be a leak in whichever configuration somebody actually shipped.
   */
  it('is claimed whatever else was asked for', () => {
    const claim = SETTINGS.indexOf('settings.ipv6Settings = ipv6')
    const guard = SETTINGS.indexOf('if allowLan')
    expect(claim).toBeGreaterThan(0)
    // The only `if allowLan` before the claim is the v4 one, which closes
    // before it; the claim itself sits at the function's own indentation.
    expect(SETTINGS).toMatch(/\n {8}settings\.ipv6Settings = ipv6/)
    expect(guard).toBeGreaterThan(0)
  })

  /*
   * The LAN exclusions have to cover v6 too, or `allowLan` keeps a printer
   * reachable by v4 and swallows the link-local address it is actually found
   * on.
   */
  it('lets the local network out when that was asked for', () => {
    expect(SETTINGS).toMatch(/NEIPv6Route\(destinationAddress: "fe80::", networkPrefixLength: 10\)/)
    expect(SETTINGS).toMatch(/NEIPv6Route\(destinationAddress: "fc00::", networkPrefixLength: 7\)/)
  })

  /*
   * The cost is real and is not hidden: an address on the physical interface
   * means applications still try v6 first and stall. The desktop rejected
   * this answer in favour of removing the address, which no app on iOS can
   * do — so the file has to say which of the two it is doing and why.
   */
  it('says what it costs, since it is the worse of two answers', () => {
    expect(PROVIDER).toContain('Happy Eyeballs')
    expect(PROVIDER).toContain('Taking the address away is better')
  })
})

describe('the MTU', () => {
  /*
   * It used to be justified as keeping `TunnelSession.send` from refusing a
   * full-size packet. That limit is `LTVPN_MAX_PLAINTEXT_LEN`, which is
   * 4096 — the reason was wrong, on a constant somebody will eventually tune.
   */
  it('is not justified by a limit that is nowhere near it', () => {
    expect(read(PACKAGE_DIR, '..', 'vpn-core', 'include', 'ltvpn.h'))
      .toContain('#define LTVPN_MAX_PLAINTEXT_LEN 4096')
    expect(PROVIDER).toContain('its\n         * limit is `LTVPN_MAX_PLAINTEXT_LEN`, which is 4096')
  })

  it('is the floor IPv6 guarantees, and says why that and not the desktop’s', () => {
    expect(SETTINGS).toContain('settings.mtu = NSNumber(value: 1280)')
    expect(PROVIDER).toContain('1280 rather than the desktop\'s 1420')
  })
})

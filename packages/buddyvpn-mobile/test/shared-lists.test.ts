/**
 * Two lists this app keeps a copy of, and the only check that they still
 * match.
 *
 * The regions and the resolver presets exist twice: once in
 * `packages/buddyvpn`, once here. Not out of carelessness — that package's
 * entry point reaches for `node:os`, the shell and a privileged helper, and
 * importing it to read five strings would drag all of it into a phone build.
 * Both files say "keep in step with" the other, which is a comment asking a
 * person to remember.
 *
 * Unlike every other contract in this directory, both sides of these are
 * TypeScript, so this is not a text match against Swift that cannot run —
 * the values are imported and compared. There is no reason to check anything
 * weaker.
 *
 * What drift would do is quiet in both cases. A region the phone offers and
 * the desktop does not is a location nobody deployed, which pairs, connects
 * and fails at the first handshake. A resolver address changed on one side
 * is a phone sending every name it looks up to a server the desktop stopped
 * trusting, with nothing anywhere reporting it.
 */
import { describe, expect, it } from 'bun:test'
import { DNS_PRESETS as DESKTOP_DNS } from '../../buddyvpn/src/dns'
import { DEFAULT_REGION as DESKTOP_DEFAULT, REGIONS as DESKTOP_REGIONS } from '../../buddyvpn/src/regions'
import { DEFAULT_REGION, REGIONS } from '../src/regions'
import { DNS_PRESETS } from '../src/settings'

describe('the regions', () => {
  /*
   * `id` is the alias `bun run deploy:vpn --region <id>` takes, so it is the
   * one field that has to be identical: it is the name of a thing that
   * either exists or does not.
   */
  it('are the same places, in the same order', () => {
    expect(REGIONS.map(region => region.id)).toEqual(DESKTOP_REGIONS.map(region => region.id))
  })

  /*
   * And described the same way. A phone calling Falkenstein something else
   * is not a bug anybody would chase, and it is the kind of difference that
   * makes two screenshots of one network look like two products.
   */
  it('are described the same way', () => {
    for (const desktop of DESKTOP_REGIONS) {
      const phone = REGIONS.find(region => region.id === desktop.id)
      expect({ id: desktop.id, found: phone !== undefined }).toEqual({ id: desktop.id, found: true })
      expect({
        badge: phone!.badge,
        country: phone!.country,
        city: phone!.city,
      }).toEqual({
        badge: desktop.badge,
        country: desktop.country,
        city: desktop.city,
      })
    }
  })

  /*
   * The phone carries one field the desktop does not: `exitIp`, because it
   * has no tunnel to ask ipinfo through. That is the documented difference,
   * so it is asserted rather than left as the one thing a reader has to
   * take on trust.
   */
  it('differ only in the address the phone cannot discover', () => {
    const extra = Object.keys(REGIONS[0]).filter(key => !(key in DESKTOP_REGIONS[0]))
    expect(extra).toEqual(['exitIp'])
  })

  it('open on the same one', () => {
    expect(DEFAULT_REGION).toBe(DESKTOP_DEFAULT)
  })

  // A default naming a region neither list has is a first launch with no
  // location selected and nothing to connect to.
  it('open on one that exists', () => {
    expect(REGIONS.map(region => region.id)).toContain(DEFAULT_REGION)
  })
})

describe('the resolver presets', () => {
  it('are the same choices', () => {
    expect(Object.keys(DNS_PRESETS).sort()).toEqual(Object.keys(DESKTOP_DNS).sort())
  })

  /*
   * And the same addresses. This is the one that matters: the preset is
   * chosen by name on both platforms precisely so a caller cannot supply an
   * address, and the whole value of that is the list behind the name being
   * the one somebody checked.
   */
  it('point at the same addresses', () => {
    for (const [preset, servers] of Object.entries(DESKTOP_DNS))
      expect({ preset, servers: DNS_PRESETS[preset as keyof typeof DNS_PRESETS] }).toEqual({ preset, servers })
  })
})

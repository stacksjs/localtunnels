/**
 * The bridge, and what it does without one.
 *
 * Both halves matter equally. A screen is written in a browser, reviewed in a
 * simulator and shipped to a phone, and only the last two have a host — so
 * every one of these helpers has to do something sensible with no `craft` on
 * `window` at all, and must never throw, because a tap that takes the screen
 * down is worse than a tap that does nothing.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { navigation } from '../src/native'

interface Pushed { screen?: string, backs: number }

/** Install a fake host and report what the helpers asked it to do. */
function withHost(bridge: unknown): Pushed {
  const record: Pushed = { backs: 0 }
  ;(globalThis as any).window = {
    craft: bridge,
    location: { assign: (path: string) => { record.screen = path } },
    history: { back: () => { record.backs += 1 } },
  }
  return record
}

afterEach(() => {
  delete (globalThis as any).window
})

describe('navigation.push', () => {
  it('asks the host for a route by name', () => {
    const seen: string[] = []
    withHost({ navigation: { push: (screen: string) => seen.push(screen) } })
    navigation.push('locations')
    expect(seen).toEqual(['locations'])
  })

  /*
   * The bug this helper exists for: a link compiled, rendered and did nothing
   * when tapped, because a native screen is not a page and nothing was
   * listening for an href.
   */
  it('falls back to the browser when there is no host', () => {
    const record = withHost(undefined)
    navigation.push('locations')
    expect(record.screen).toBe('/locations')
  })

  it('does not throw when the host refuses the route', () => {
    withHost({ navigation: { push: () => { throw new Error('Unknown native screen: typo') } } })
    expect(() => navigation.push('typo')).not.toThrow()
  })

  it('does not throw on a host that has no navigation at all', () => {
    withHost({})
    expect(() => navigation.push('locations')).not.toThrow()
  })
})

describe('navigation.back', () => {
  it('pops the host’s stack when there is one', () => {
    let popped = 0
    withHost({ navigation: { back: () => { popped += 1 } } })
    navigation.back()
    expect(popped).toBe(1)
  })

  /*
   * `history.back()` was what the locations screen called, and it is right
   * only in a browser — which is the half this keeps working.
   */
  it('falls back to browser history off a host', () => {
    const record = withHost(undefined)
    navigation.back()
    expect(record.backs).toBe(1)
  })

  it('does not throw when the host throws', () => {
    withHost({ navigation: { back: () => { throw new Error('no navigator') } } })
    expect(() => navigation.back()).not.toThrow()
  })
})

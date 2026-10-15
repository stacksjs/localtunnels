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
import { DEFAULT_REGION, readRegion, writeRegion } from '../src/regions'

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

/*
 * The bug these cover: the picker saved a choice and the screen showing it
 * had already read the old value at mount, so changing location changed
 * nothing. A pushed screen leaves the one beneath it mounted.
 */
describe('navigation.onAppear', () => {
  it('subscribes through the host and hands back its unsubscribe', () => {
    let subscribed = 0
    let disposed = 0
    withHost({ navigation: { onAppear: () => { subscribed += 1; return () => { disposed += 1 } } } })
    const stop = navigation.onAppear(() => {})
    expect(subscribed).toBe(1)
    stop()
    expect(disposed).toBe(1)
  })

  // Off a host there is no stack and nothing to hear, but a caller still
  // disposes unconditionally, so it must hand back a function regardless.
  it('is a no-op that still returns an unsubscribe off a host', () => {
    withHost(undefined)
    expect(() => navigation.onAppear(() => {})()).not.toThrow()
  })

  it('does not throw when the host refuses the subscription', () => {
    withHost({ navigation: { onAppear: () => { throw new Error('no navigator') } } })
    expect(() => navigation.onAppear(() => {})).not.toThrow()
  })
})

/*
 * The bug these cover: the picker's bar read `locations` — the host titles a
 * screen with its route name, and a route name is a filename.
 */
describe('navigation.setOptions', () => {
  it('hands the host the options it was given', () => {
    const seen: unknown[] = []
    withHost({ navigation: { setOptions: (options: unknown) => seen.push(options) } })
    navigation.setOptions({ title: 'Location', largeTitle: true })
    expect(seen).toEqual([{ title: 'Location', largeTitle: true }])
  })

  it('does nothing off a host rather than reaching for the document title', () => {
    withHost(undefined)
    expect(() => navigation.setOptions({ title: 'Location' })).not.toThrow()
  })

  it('does not throw when the host refuses the options', () => {
    withHost({ navigation: { setOptions: () => { throw new Error('no bar') } } })
    expect(() => navigation.setOptions({ title: 'Location' })).not.toThrow()
  })
})

describe('the remembered region', () => {
  const store = (value: string | null) => {
    ;(globalThis as any).localStorage = {
      getItem: () => value,
      setItem: (_k: string, v: string) => { value = v },
    }
    return () => value
  }

  afterEach(() => {
    delete (globalThis as any).localStorage
  })

  it('reads back what was stored', () => {
    store('eu-central')
    expect(readRegion()).toBe('eu-central')
  })

  it('falls back to the default for a region that no longer exists', () => {
    store('atlantis')
    expect(readRegion()).toBe(DEFAULT_REGION)
  })

  it('refuses to store a region it does not know', () => {
    const current = store('us-west')
    expect(writeRegion('atlantis')).toBe(false)
    expect(current()).toBe('us-west')
  })

  it('stores a region it does know', () => {
    const current = store('us-west')
    expect(writeRegion('eu-central')).toBe(true)
    expect(current()).toBe('eu-central')
  })

  /*
   * Storage throws rather than returning null in a private window or with
   * site data cleared. A missing preference is not an error, and a failed
   * save is not a reason to lose the tap.
   */
  it('survives storage that throws', () => {
    ;(globalThis as any).localStorage = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
    }
    expect(readRegion()).toBe(DEFAULT_REGION)
    expect(writeRegion('eu-central')).toBe(false)
  })
})

/**
 * Running the screens, rather than only compiling them.
 *
 * Everything here had been checked one of two ways: the compiler did not
 * complain, or somebody looked at a simulator. The gap between those is where
 * this session's expensive bugs lived — a screen that compiled, bound and
 * rendered blank at hydration; a row that compiled, bound and did nothing
 * when tapped, with the exception swallowed and nothing in any log. The
 * compiler cannot see any of that, and a simulator needs a Mac, Xcode and a
 * person watching.
 *
 * None of that is necessary. The bundle is JavaScript and the host it expects
 * is two functions — `postMessage` out, `onMessage` in — so the real screens
 * run here, in this process, and answer for themselves.
 *
 * ── How a screen is read ───────────────────────────────────────────────
 *
 * Three things arrive from a screen coming up, and all three matter:
 *
 *   RENDER   the static tree, with every `@if` branch still in it
 *   MUTATE   what hydration decided: branches removed, handlers given ids
 *   others   what the screen asked its host for, like a navigation title
 *
 * So the tree is only true once the mutations are applied — before that both
 * shield icons are present and every resolver looks selected. Applying them
 * also yields the handler ids, which is how a tap is sent: the host reads an
 * id off a node and sends it back, and so does {@link Screen.fire}.
 *
 * ── What this still cannot see ─────────────────────────────────────────
 *
 * Pixels. Layout is Yoga and drawing is UIKit, and neither runs here. A row
 * that collapses to zero width, a colour that vanishes in dark mode, an SF
 * Symbol that fails to resolve and falls back to a circle — all of those have
 * happened in this package, and all of them still need a device.
 */
import { beforeAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(PACKAGE_DIR, 'dist', 'native-screens.js')

interface Node {
  id?: string
  type: string
  /** The class list, which is where an `<icon>`'s symbol is named. */
  _classes?: string
  props?: Record<string, unknown>
  events?: Record<string, string>
  children?: (Node | string)[]
}

interface Message { type: string, payload?: any }

interface Screen {
  /** The tree as it would be on screen, with hydration applied. */
  nodes: Node[]
  /** Everything the screen asked its host for. */
  posted: Message[]
  /** All visible text, for asserting on wording. */
  text: string
  /** The handler the host would send back for a node's event. */
  handler: (nodeType: string, event: string, nth?: number) => string
  /** Every handler id on screen, by event name. */
  handlerIds: (event: string) => string[]
  /** Send a handler back the way the host does, and re-read the screen. */
  fire: (handlerId: string, nativeEvent?: unknown) => Screen
}

let source = ''

beforeAll(async () => {
  /*
   * Built here rather than assumed. A stale bundle is this package's oldest
   * failure mode — it shipped one to a simulator twice — and a test that
   * passes against last week's screens is worse than one that does not run.
   */
  const built = Bun.spawnSync(['bun', 'run', 'build:web'], { cwd: PACKAGE_DIR, stdout: 'pipe', stderr: 'pipe' })
  if (built.exitCode !== 0)
    throw new Error(`the screens did not compile:\n${built.stderr.toString()}`)
  if (!existsSync(BUNDLE))
    throw new Error(`no bundle at ${BUNDLE}`)
  source = await Bun.file(BUNDLE).text()
})

/** Run one route against a stub host and read back what it drew. */
function render(route: string, stored: Record<string, string> = {}): Screen {
  const posted: Message[] = []
  let deliver: ((raw: string) => void) | null = null
  const globals = globalThis as any

  /*
   * A fresh app, not a fresh screen.
   *
   * `installCraftBridge` keeps whatever `globalThis.craft` it finds and only
   * fills in what is missing, so a second render inherits the first one's
   * bridge — and its `navigation.setOptions` goes on posting to the first
   * run's host, where nobody is listening any more. Everything the bundle
   * leaves behind is cleared, which is what starting the app again means.
   */
  for (const left of ['craft', 'navigator', 'stx', '__stx_host', '__stx_latestSetup', '__stxNativeUnmount'])
    delete globals[left]

  globals.localStorage = {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => { stored[key] = value },
    removeItem: (key: string) => { delete stored[key] },
  }
  globals.__stxNativeBridge = {
    colorScheme: 'light',
    capabilityTimeoutMs: 5000,
    capabilities: [],
    postMessage: (raw: string) => { posted.push(JSON.parse(raw)) },
    onMessage: (callback: (raw: string) => void) => { deliver = callback },
  }
  globals.__stxNativeRoute = route

  // A fresh evaluation per route: the bundle is an IIFE that picks its screen
  // from `__stxNativeRoute` at run time, so an import would run it once.
  // eslint-disable-next-line no-new-func
  new Function(source)()

  // `payload.document` is the root node itself, not a wrapper around one.
  const root: Node | undefined = posted.find(message => message.type === 'RENDER')?.payload?.document
  if (!root?.type)
    throw new Error(`${route} rendered no document; it posted [${posted.map(message => message.type).join(', ')}]`)

  let applied = 0
  const read = (): Screen => {
    // Mutations are applied cumulatively: each `fire` adds more, and the tree
    // is only true once every one of them has landed.
    const operations = posted
      .filter(message => message.type === 'MUTATE')
      .flatMap(message => message.payload?.operations ?? [])
    for (const operation of operations.slice(applied)) applyOperation(root, operation)
    applied = operations.length

    const nodes: Node[] = []
    const text: string[] = []
    const walk = (node: Node | string): void => {
      if (typeof node === 'string') {
        text.push(node)
        return
      }
      if (!node || typeof node !== 'object')
        return
      nodes.push(node)
      for (const child of node.children ?? []) walk(child)
    }
    walk(root)

    const handlerIds = (event: string): string[] =>
      nodes.map(node => node.events?.[event]).filter((id): id is string => typeof id === 'string')

    return {
      nodes,
      posted,
      text: text.join(' '),
      handlerIds,
      handler: (nodeType, event, nth = 0) => {
        const matches = nodes.filter(node => node.type === nodeType && node.events?.[event])
        const found = matches[nth]?.events?.[event]
        if (!found)
          throw new Error(`no ${nodeType} with ${event} at index ${nth}; found ${matches.length}`)
        return found
      },
      fire: (handlerId, nativeEvent = {}) => {
        if (!deliver)
          throw new Error('the screen never asked to hear from its host')
        deliver(JSON.stringify({ id: `e${Math.random()}`, type: 'EVENT', payload: { handlerId, nativeEvent } }))
        return read()
      },
    }
  }
  return read()
}

/** Apply one hydration operation to the tree, as the host would. */
function applyOperation(root: Node, operation: any): void {
  if (operation.op === 'removeNode') {
    const prune = (node: Node): void => {
      if (!node.children)
        return
      node.children = node.children.filter(child => typeof child === 'string' || child.id !== operation.id)
      for (const child of node.children) if (typeof child !== 'string') prune(child)
    }
    prune(root)
    return
  }
  if (operation.op !== 'updateNode')
    return
  const find = (node: Node): Node | null => {
    if (node.id === operation.id)
      return node
    for (const child of node.children ?? []) {
      if (typeof child === 'string')
        continue
      const found = find(child)
      if (found)
        return found
    }
    return null
  }
  const target = find(root)
  if (!target)
    return
  const patch = operation.patch ?? {}
  if (patch.events)
    target.events = { ...target.events, ...patch.events }
  if (patch.props)
    target.props = { ...target.props, ...patch.props }
  if (patch.style)
    target.props = { ...target.props, __style: { ...(target.props?.__style as object), ...patch.style } }
}

const settings = (stored: Record<string, unknown>): Record<string, string> =>
  ({ 'buddyvpn.settings': JSON.stringify(stored) })

describe('every screen comes up', () => {
  /*
   * The failure this is really for: `@if`/`@else` blanks the screen at
   * hydration on this renderer, with one swallowed error and nothing drawn.
   * It compiles, it binds, and the app opens to an empty rectangle.
   */
  it.each(['connect', 'locations', 'settings'])('%s draws a tree, not an empty one', (route) => {
    const screen = render(route)
    expect(screen.nodes.length).toBeGreaterThan(10)
    expect(screen.nodes[0].type).toBe('View')
  })

  /*
   * Without this the bar is titled `routeName ?? appName`, and a route name
   * is a filename — the picker opened with `locations` above it, lowercase.
   */
  it.each([
    ['connect', 'BuddyVPN'],
    ['locations', 'Location'],
    ['settings', 'Settings'],
  ])('%s titles its navigation bar %s', (route, title) => {
    const options = render(route).posted.find(message => message.type === 'NAVIGATION_SET_OPTIONS')
    expect(options?.payload?.options?.title ?? options?.payload?.title).toBe(title)
  })

  // Native components, not HTML that happens to map. A screen built entirely
  // of plain Views is a web page drawn in native boxes.
  it.each(['connect', 'locations', 'settings'])('%s is built from native components', (route) => {
    const types = new Set(render(route).nodes.map(node => node.type))
    expect(types.has('ScrollView')).toBe(true)
    expect(types.has('Text')).toBe(true)
  })
})

describe('the settings screen', () => {
  it('offers every resolver, with its addresses', () => {
    const screen = render('settings')
    expect(screen.text).toContain('Cloudflare')
    expect(screen.text).toContain('Quad9')
    expect(screen.text).toContain('1.1.1.1, 1.0.0.1')
  })

  /*
   * Real UISwitches, not rows with a checkmark. A boolean drawn as a list row
   * is what makes an app look web-based, which is the complaint these screens
   * were rebuilt to answer.
   */
  it('draws the booleans as switches', () => {
    const screen = render('settings')
    expect(screen.nodes.filter(node => node.type === 'Switch')).toHaveLength(2)
    expect(screen.handlerIds('onValueChange')).toHaveLength(2)
  })

  /*
   * The whole point of the harness. The switch is tapped the way the host
   * taps it — by sending back the id it was given — and the setting has to
   * actually change. A handler that throws is swallowed by the dispatcher,
   * so a control that does nothing is otherwise completely silent.
   */
  it('a tapped switch changes the setting it names', () => {
    const stored = settings({ dns: 'cloudflare', allowLan: false, autoConnect: false })
    const screen = render('settings', stored)
    screen.fire(screen.handler('Switch', 'onValueChange', 0), { value: true })
    expect(JSON.parse(stored['buddyvpn.settings']).allowLan).toBe(true)
  })

  it('the second switch changes the other setting, not the first', () => {
    const stored = settings({ dns: 'cloudflare', allowLan: false, autoConnect: false })
    const screen = render('settings', stored)
    screen.fire(screen.handler('Switch', 'onValueChange', 1), { value: true })
    const after = JSON.parse(stored['buddyvpn.settings'])
    expect(after.autoConnect).toBe(true)
    expect(after.allowLan).toBe(false)
  })

  it('a tapped resolver row is remembered', () => {
    const stored = settings({ dns: 'cloudflare', allowLan: false, autoConnect: false })
    const screen = render('settings', stored)
    // The rows are the TouchableOpacity presses, in the order they were drawn.
    screen.fire(screen.handlerIds('onPress')[2])
    expect(JSON.parse(stored['buddyvpn.settings']).dns).toBe('quad9')
  })

  /*
   * Hydration removes the branch that did not apply, so exactly one check
   * survives — and it is the stored one. Before the mutations are applied
   * every row carries a checkmark.
   */
  it('checks the stored resolver and no other', () => {
    const screen = render('settings', settings({ dns: 'quad9' }))
    const checks = screen.nodes.filter(node => (node._classes ?? '').includes('i-lucide-check'))
    expect(checks).toHaveLength(1)
  })

  it('says what is deliberately not a setting', () => {
    expect(render('settings').text).toContain('kill switch')
  })
})

describe('the connect screen', () => {
  it('says it is simulated while it is', () => {
    expect(render('connect').text).toContain('Simulated')
  })

  it('can be left for either of the other screens', () => {
    expect(render('connect').handlerIds('onPress').length).toBeGreaterThanOrEqual(3)
  })

  /*
   * Disconnected, so the plain shield is the one that survived hydration and
   * the checkmark branch was removed. This is the pair that failed on a
   * device: a `:class` swap re-applied colour without re-resolving the glyph,
   * so the shield never became a checkmark.
   */
  it('shows the plain shield while nothing is connected', () => {
    const classes = render('connect').nodes.map(node => node._classes ?? '')
    expect(classes.some(value => value.includes('i-lucide-shield') && !value.includes('shield-check'))).toBe(true)
    expect(classes.some(value => value.includes('i-lucide-shield-check'))).toBe(false)
  })
})

describe('the locations screen', () => {
  /*
   * A client `@for` draws one empty row on this renderer, because the runtime
   * finds lists with `hasAttribute` and a native node has none. The loop runs
   * server-side, and this is what says so.
   */
  it('bakes one row per region at render', () => {
    const screen = render('locations')
    expect(screen.text).toContain('United States')
    expect(screen.text).toContain('Germany')
    expect(screen.handlerIds('onPress').length).toBeGreaterThanOrEqual(2)
  })

  it('names a region with no server rather than offering it', () => {
    expect(render('locations').text).toContain('No server yet')
  })

  /*
   * The round trip that took three wrong diagnoses to fix: the row saved
   * nothing and went nowhere, and the ReferenceError behind it was swallowed.
   */
  it('a tapped region is remembered', () => {
    const stored: Record<string, string> = {}
    const screen = render('locations', stored)
    screen.fire(screen.handlerIds('onPress')[0])
    expect(stored['buddyvpn.region']).toBe('us-west')
  })

  // A location with no server behind it cannot be chosen, and the tap says so
  // by doing nothing rather than by failing later.
  it('a region with no server is not remembered', () => {
    const stored: Record<string, string> = {}
    const screen = render('locations', stored)
    screen.fire(screen.handlerIds('onPress')[1])
    expect(stored['buddyvpn.region']).toBeUndefined()
  })
})

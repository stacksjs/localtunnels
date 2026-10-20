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
  /**
   * Hand the screen a link the way iOS hands one to an app already running.
   *
   * The other half of `Host.initialURL`, and the only way into a screen that
   * has already settled: a code scanned while the app is open arrives
   * through a listener rather than a request, so nothing else here could
   * reach it. Asynchronous because what a screen does with a link is — it
   * validates it, writes it to the Keychain, and reads the result back.
   */
  deliverLink: (url: string) => Promise<Screen>
  /**
   * Let anything the screen started finish, then read it again.
   *
   * Some of what a screen does on mount is asynchronous — asking the host
   * for the link it was opened with, writing to the Keychain — and the tree
   * at the end of hydration is the tree before any of that came back.
   * Reading without this says a pairing did nothing, which is exactly what
   * it would look like if it were broken.
   */
  settle: () => Promise<Screen>
}

let source = ''

beforeAll(async () => {
  /*
   * Built here rather than assumed. A stale bundle is this package's oldest
   * failure mode — it shipped one to a simulator twice — and a test that
   * passes against last week's screens is worse than one that does not run.
   */
  const built = Bun.spawnSync(['bun', 'run', 'build:web'], { cwd: PACKAGE_DIR, stdout: 'pipe', stderr: 'pipe' })
  const output = `${built.stdout.toString()}\n${built.stderr.toString()}`.trim()
  if (built.exitCode !== 0)
    throw new Error(`the screens did not compile:\n${output}`)
  if (!existsSync(BUNDLE))
    throw new Error(`no bundle at ${BUNDLE}\n${output}`)
  source = await Bun.file(BUNDLE).text()

  /*
   * A bundle that built is not the same as a bundle with screens in it.
   *
   * This exists because of a failure that was invisible from here: the
   * screens compiled on one machine and to empty documents on another, and
   * every assertion below then failed with "expected more than 10 nodes,
   * received 1" — true, useless, and nothing about the build in sight. The
   * build's own output is the thing worth reading, so it is carried to
   * wherever this is noticed.
   */
  for (const route of ['connect', 'locations', 'settings']) {
    if (!source.includes(`"${route}"`))
      throw new Error(`the bundle names no ${route} screen. The build said:\n${output}`)
    /*
     * And a named route is not a drawn one. A compile can produce a bundle
     * with every route in it and a document of one empty node for each,
     * which fails every assertion below with "expected more than 10 nodes,
     * received 1" — twenty-five times, none of them mentioning the build.
     * One failure carrying the build's own words is worth more.
     */
    const drawn = render(route).nodes.length
    if (drawn < 5)
      throw new Error(`${route} compiled to ${drawn} node(s), so the screens did not really build. The build said:\n${output}`)
  }
})

/** Run one route against a stub host and read back what it drew. */
interface Host {
  /** The link the app was launched with, as iOS hands one over. */
  initialURL?: string
  /** Pairings already on this device, as the Keychain would hold them. */
  keychain?: Record<string, string>
}

function render(route: string, stored: Record<string, string> = {}, host: Host = {}): Screen {
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
    postMessage: (raw: string) => {
      const message = JSON.parse(raw)
      posted.push(message)
      /*
       * Answer anything that expects an answer.
       *
       * A screen asking for haptics is making a correlated request, and a
       * host that never replies leaves it pending until the protocol times
       * it out — five seconds later, rejecting into nothing, as an unhandled
       * error attributed to whichever test happened to be running. A real
       * host always answers; so does this one.
       */
      if (message.type === 'API_REQUEST') {
        // Answered as the real host answers: the module and method decide
        // what comes back, and a screen asking for the link it was opened
        // with must get one when there is one.
        const { module, method, args } = message.payload ?? {}
        const answer = (data: unknown): void => {
          deliver?.(JSON.stringify({ id: `r${message.id}`, type: 'API_RESULT', correlationId: message.id, payload: { data } }))
        }
        /*
         * A device with no Keychain refuses rather than quietly succeeding.
         * A stub that always said yes would let a pairing "save" on a host
         * that cannot keep one, which is the case the screen most needs to
         * be able to report.
         */
        if (module === 'SecureStorage' && !host.keychain) {
          deliver?.(JSON.stringify({
            id: `r${message.id}`,
            type: 'API_ERROR',
            correlationId: message.id,
            payload: { code: 'SECURE_STORAGE_ERROR', message: 'no keychain on this device' },
          }))
          return
        }
        if (module === 'DeepLinks' && method === 'getInitialURL')
          return answer(host.initialURL ?? null)
        if (module === 'SecureStorage' && method === 'get')
          return answer(host.keychain?.[args?.[0]] ?? null)
        if (module === 'SecureStorage' && method === 'set') {
          host.keychain![args?.[0]] = args?.[1]
          return answer(true)
        }
        if (module === 'SecureStorage' && (method === 'remove' || method === 'delete')) {
          delete host.keychain![args?.[0]]
          return answer(true)
        }
        answer(null)
      }
    },
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
  // Nodes built by `createNode` and not yet attached. They arrive before the
  // `insertChild` that places them, sometimes in a later batch.
  const pool = new Map<string, Node>()
  const read = (): Screen => {
    // Mutations are applied cumulatively: each `fire` adds more, and the tree
    // is only true once every one of them has landed.
    const operations = posted
      .filter(message => message.type === 'MUTATE')
      .flatMap(message => message.payload?.operations ?? [])
    for (const operation of operations.slice(applied)) applyOperation(root, operation, pool)
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
      settle: async () => {
        // Two turns of the macrotask queue: one for the host's answer to
        // land, one for what the screen does with it.
        await new Promise(resolve => setTimeout(resolve, 0))
        await new Promise(resolve => setTimeout(resolve, 0))
        return read()
      },
      fire: (handlerId, nativeEvent = {}) => {
        if (!deliver)
          throw new Error('the screen never asked to hear from its host')
        deliver(JSON.stringify({ id: `e${Math.random()}`, type: 'EVENT', payload: { handlerId, nativeEvent } }))
        return read()
      },
      deliverLink: async (url) => {
        if (!deliver)
          throw new Error('the screen never asked to hear from its host')
        /*
         * The host's own channel, not a stub of `onLink`.
         *
         * Craft keeps its link listeners in a Set of its own and calls them
         * when a `DEEP_LINK` message arrives, so this is the message iOS
         * would send — and it goes through Craft's bridge exactly as a real
         * one would. Replacing `craft.deepLinks` instead was the first
         * attempt and it does not work: `installCraftBridge` owns that
         * module and overwrites a seeded one, silently.
         *
         * No `initial` flag: Craft drops an initial link once
         * `getInitialURL` has been called, which is precisely the case this
         * is not. This is the other one — a code scanned while the app is
         * already open.
         */
        deliver(JSON.stringify({ id: `l${Math.random()}`, type: 'DEEP_LINK', payload: url }))
        // Three turns: the link being taken, the Keychain write, and the
        // read the screen does to show what happened.
        for (let turn = 0; turn < 3; turn += 1)
          await new Promise(resolve => setTimeout(resolve, 0))
        return read()
      },
    }
  }
  return read()
}

/**
 * Apply one operation to the tree, as the host would.
 *
 * Four kinds matter. `removeNode` and `updateNode` arrive during hydration,
 * when branches that do not apply are dropped and handlers are given ids.
 * `createNode` and `insertChild` arrive later, when something that was
 * dropped comes back — a banner appearing after an answer, a row appearing
 * when state changes. Ignoring those two made this harness blind to
 * everything a screen does after it first draws, which is most of what a
 * reactive screen is for.
 */
function applyOperation(root: Node, operation: any, pool: Map<string, Node>): void {
  if (operation.op === 'createNode') {
    // Built but not attached: `insertChild` says where it goes, and it may
    // arrive in the same batch or a later one.
    pool.set(operation.id, { ...operation.node, id: operation.id })
    return
  }
  if (operation.op === 'insertChild') {
    const parent = findNode(root, operation.parentId) ?? pool.get(operation.parentId)
    const child = pool.get(operation.childId) ?? findNode(root, operation.childId)
    if (!parent || !child)
      return
    const children = parent.children ?? (parent.children = [])
    const at = typeof operation.index === 'number' ? operation.index : children.length
    children.splice(Math.min(at, children.length), 0, child)
    return
  }
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
  const target = findNode(root, operation.id) ?? pool.get(operation.id)
  if (!target)
    return
  const patch = operation.patch ?? {}
  /*
   * Bound text arrives here, not in the document. `:text="statusLabel()"`
   * leaves the node empty at render and replaces its children at hydration,
   * so a harness that ignored this would read every bound label as blank —
   * which is most of the words on these screens.
   */
  if (patch.children)
    target.children = patch.children
  if (patch.events)
    target.events = { ...target.events, ...patch.events }
  if (patch.props)
    target.props = { ...target.props, ...patch.props }
  if (patch.style)
    target.props = { ...target.props, __style: { ...(target.props?.__style as object), ...patch.style } }
}

/** The node with this id, anywhere in the tree. */
function findNode(node: Node, id: string): Node | null {
  if (node.id === id)
    return node
  for (const child of node.children ?? []) {
    if (typeof child === 'string')
      continue
    const found = findNode(child, id)
    if (found)
      return found
  }
  return null
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

  /*
   * The gap this closes: `autoConnect` was stored by the settings screen and
   * read by nothing, so the switch changed the stored value and never the
   * behaviour.
   */
  it('connects on open when that is what was asked for', () => {
    const quiet = render('connect', settings({ autoConnect: false }))
    expect(quiet.text).toContain('Not connected')

    const eager = render('connect', settings({ autoConnect: true }))
    expect(eager.text).toContain('Connecting')
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

/*
 * Opening the app by scanning a code off a desktop screen.
 *
 * The whole point of using a link rather than a scanner is that iOS does
 * the reading and launches the app with a URL — so the moment that matters
 * is the one where the app was closed, and `getInitialURL` is the only way
 * it hears about it. A screen that listened for `onLink` alone would work
 * every time except the first, which is the only time anybody pairs.
 */
describe('a scanned pairing code', () => {
  const link = 'buddyvpn://pair?v=1&c=wss%3A%2F%2Fvpn.example.com%3A51821&r=eu-central&k=a-shared-secret-token'

  it('is acted on when it is what opened the app', async () => {
    const keychain: Record<string, string> = {}
    const screen = await render('connect', {}, { initialURL: link, keychain }).settle()
    expect(screen.text).toContain('Paired')
    expect(JSON.parse(keychain['vpn.pairing'])).toMatchObject({
      coordinatorUrl: 'wss://vpn.example.com:51821',
      region: 'eu-central',
    })
  })

  /*
   * Somebody who scanned a code for Germany meant Germany. Leaving the
   * picker wherever it was is a quiet way to send their traffic somewhere
   * they did not choose.
   */
  it('selects the region it paired', async () => {
    const stored: Record<string, string> = {}
    await render('connect', stored, { initialURL: link, keychain: {} }).settle()
    expect(stored['buddyvpn.region']).toBe('eu-central')
  })

  /*
   * A pairing that silently failed is the worst outcome: the app looks
   * ready and the first connection fails for a reason nobody can trace
   * back to a code scanned minutes earlier.
   */
  it('says so when the code is not one this build understands', async () => {
    const screen = await render('connect', {}, { initialURL: link.replace('v=1', 'v=9'), keychain: {} }).settle()
    expect(screen.text).toContain('not one this app understands')
  })

  it('says so when it could not be kept', async () => {
    // A host with no Keychain: `savePairing` reports false rather than
    // pretending, and the screen has to show that rather than "Paired".
    const screen = await render('connect', {}, { initialURL: link }).settle()
    expect(screen.text).toContain('could not be saved')
  })

  // The app is opened by other links too, and complaining about one it was
  // not given would be noise on every launch.
  it('says nothing about a link that is not a pairing', async () => {
    const screen = await render('connect', {}, { initialURL: 'buddyvpn://connect/us-west', keychain: {} }).settle()
    expect(screen.text).not.toContain('Paired')
    expect(screen.text).toContain('Not connected')
  })

  it('says nothing when the app was opened normally', async () => {
    expect((await render('connect').settle()).text).not.toContain('Paired')
  })

  /*
   * The other moment: a code scanned while the app is already open.
   *
   * `getInitialURL` is the one that matters most, because it is the only
   * time anybody pairs a new device — but re-pairing happens to a device
   * that is already running, and that path arrives through a listener
   * instead. Nothing here reached it until the stub host learned to deliver
   * one.
   */
  it('is acted on when it arrives while the app is open', async () => {
    const keychain: Record<string, string> = {}
    const screen = await render('connect', {}, { keychain }).settle()
    expect(screen.text).not.toContain('Paired')

    const after = await screen.deliverLink(link)
    expect(after.text).toContain('Paired')
    expect(JSON.parse(keychain['vpn.pairing'])).toMatchObject({ region: 'eu-central' })
  })
})

/*
 * Where the traffic leaves from, which is not where the picker points.
 *
 * These are normally the same region and the exception is the one that
 * matters. A pairing code selects the region it paired — deliberately, since
 * somebody who scanned a code for Germany meant Germany — and it can arrive
 * while a tunnel is up, which the picker itself cannot do, because the
 * location row is inert while connected.
 *
 * So the choice moves and the tunnel does not. It is still carrying traffic
 * through whichever exit it connected to, and a screen reading the picker
 * puts a city and an address under the words "would leave from" that the
 * traffic is not using. The status frame has carried the tunnel's own region
 * across the process boundary the whole time; nothing read it.
 */
describe('the location shown while connected', () => {
  const pairTo = (region: string): string =>
    `buddyvpn://pair?v=1&c=wss%3A%2F%2Fvpn.example.com%3A51821&r=${region}&k=a-shared-secret-token`

  /** `us-west`'s address, which appears on this screen in exactly one place. */
  const US_WEST_EXIT = '5.78.208.190'

  /** Pair, tap connect, and wait out the stand-in's pretend handshake. */
  async function connectedTo(region: string): Promise<Screen> {
    const screen = await render('connect', {}, { initialURL: pairTo(region), keychain: {} }).settle()
    screen.fire(screen.handler('TouchableOpacity', 'onPress', 0))
    // `FAKE_CONNECT_MS` in `src/tunnel.ts`, plus room for the clock to tick.
    await new Promise(resolve => setTimeout(resolve, 1600))
    const up = await screen.settle()
    expect(up.text).toContain('Connected')
    return up
  }

  it('is the region the tunnel is on', async () => {
    const up = await connectedTo('us-west')
    expect(up.text).toContain('Would leave from')
    expect(up.text).toContain(US_WEST_EXIT)
  })

  /*
   * The regression. Re-pairing to Germany while a tunnel is up through
   * Oregon used to relabel the exit as Falkenstein, which is the one lie
   * this screen is built not to tell.
   */
  it('does not follow a pairing code to a region the tunnel is not on', async () => {
    const up = await connectedTo('us-west')
    const after = await up.deliverLink(pairTo('eu-central'))

    // The code was acted on: the picker moved, which is what it is for.
    expect(after.text).toContain('Paired')
    expect(after.text).toContain('Falkenstein')
    // And the tunnel did not, so the exit is still the one carrying traffic.
    expect(after.text).toContain(US_WEST_EXIT)
  })
})

/*
 * Unpairing: what a device can do about a key it should no longer hold — a
 * phone that was lost, a secret that was rotated, a network somebody left.
 * `forgetPairing` was written and tested and reached by nothing, which is
 * the same shape as a tunnel nothing selected and settings nothing read.
 */
/**
 * The handler on the control that says a given thing.
 *
 * Found by its words rather than by its position: `handlerIds(...).at(-1)`
 * means "whichever control happens to be last", which is true until somebody
 * adds a row and then quietly taps the wrong one.
 */
function control(screen: Screen, text: string): string {
  const says = (node: Node | string): boolean => {
    if (typeof node === 'string')
      return node.includes(text)
    return (node.children ?? []).some(says)
  }
  const found = screen.nodes.find(node => node.events?.onPress && says(node))
  if (!found?.events?.onPress)
    throw new Error(`no control saying "${text}"`)
  return found.events.onPress
}

describe('the paired network', () => {
  const paired = {
    'vpn.pairing': JSON.stringify({
      coordinatorUrl: 'wss://vpn.example.com:51821',
      authKey: 'a-shared-secret-token',
      region: 'eu-central',
    }),
  }

  it('is shown by host and region once it is known', async () => {
    const screen = await render('settings', {}, { keychain: { ...paired } }).settle()
    expect(screen.text).toContain('Paired')
    expect(screen.text).toContain('vpn.example.com:51821 · eu-central')
  })

  /*
   * Never the key. There is no reason to put a shared secret back on a
   * screen after storing it, and a settings panel left open on a desk is a
   * worse place for one than a code shown on purpose and hidden again.
   */
  it('never shows the secret it is holding', async () => {
    const screen = await render('settings', {}, { keychain: { ...paired } }).settle()
    expect(screen.text).not.toContain('a-shared-secret-token')
  })

  it('says how to pair when this device has not been', async () => {
    const screen = await render('settings', {}, { keychain: {} }).settle()
    expect(screen.text).toContain('Not paired')
    expect(screen.text).toContain("point this phone's camera")
  })

  it('can be forgotten, and the key goes with it', async () => {
    const keychain = { ...paired }
    const screen = await render('settings', {}, { keychain }).settle()
    const after = await screen.fire(control(screen, 'Forget')).settle()
    expect(keychain['vpn.pairing']).toBeUndefined()
    expect(after.text).toContain('Not paired')
  })

  /*
   * Said where somebody is about to rely on it: this reaches the device
   * only. The coordinator has no notion of revoking one member, so anyone
   * still holding the code can still join.
   */
  it('says that forgetting reaches this device only', async () => {
    const screen = await render('settings', {}, { keychain: { ...paired } }).settle()
    expect(screen.text).toContain('removes it from this device only')
  })
})

/*
 * Telling somebody why, rather than that.
 *
 * The status line can only say "Something went wrong". The useful words are
 * the provider's — not allowed to add a VPN configuration, no coordinator to
 * join, a server that stopped answering — and they were being dropped.
 *
 * Both of these notices are dormant in a simulated build, and correctly so:
 * the stand-in has no provider to fail and needs no network to join, so a
 * device running it is not broken and must not be told it is. They come
 * alive with `capabilities.networkExtension`, like everything else behind
 * that flag. What is asserted here is that they are wired to the right
 * things, which is what would silently stop being true.
 */
describe('why a tunnel will not come up', () => {
  /*
   * Asserted against the bundle rather than the rendered tree: a condition
   * lives in the binding manifest, and the branch it guards is removed from
   * the document at hydration when it does not apply — which, on a
   * simulated build, is always.
   */
  it('binds the error itself, not a summary of it', () => {
    expect(source).toContain('snapshot().error')
  })

  it('offers pairing instructions when there is a real tunnel and no network', () => {
    expect(source).toContain('unpaired()')
    expect(source).toContain('point this phone')
  })

  /*
   * And it stays quiet on a build that cannot tunnel. A simulated app
   * telling somebody to go and pair a device would be asking them to fix
   * something that is not wrong.
   */
  it('says neither thing on a simulated build', () => {
    const screen = render('connect')
    expect(screen.text).not.toContain('not part of a network yet')
    expect(screen.text).toContain('Simulated')
  })
})

/*
 * A pairing is for one region's coordinator, so every other location is one
 * this device holds no key for — deployed, reachable, and unusable from
 * here. Saying so on the row beats failing at the tap, because the reason
 * has nothing to do with the server.
 *
 * Dormant on a simulated build, like the other two: the stand-in joins
 * nothing and needs no key, so greying out locations that work perfectly
 * well in it would be a lie.
 */
describe('a location this device cannot join', () => {
  it('is marked, and the mark is bound rather than written', () => {
    expect(source).toContain("joinable('us-west') ? '' : 'Not paired'")
  })

  it('dims the row it belongs to', () => {
    expect(source).toContain("!joinable('us-west')")
  })

  it('marks nothing on a simulated build', () => {
    expect(render('locations').text).not.toContain('Not paired')
  })

  // The tap is guarded too: a row that looks unavailable and still works is
  // worse than one that does neither.
  it('still lets a simulated build choose any deployed region', () => {
    const stored: Record<string, string> = {}
    const screen = render('locations', stored)
    screen.fire(screen.handlerIds('onPress')[0])
    expect(stored['buddyvpn.region']).toBe('us-west')
  })
})

/*
 * What the coordinator calls this device, and how to stop it calling it
 * that. `DeviceIdentity.forget()` existed and nothing called it — the same
 * shape as the unpairing that came before it, and it matters for the same
 * reason: a key that has been somewhere it should not have been needs an
 * answer, and there was none.
 */
describe('this device’s key', () => {
  it('is shown and resettable, both bound to the tunnel', () => {
    expect(source).toContain('deviceShort()')
    expect(source).toContain('resetDevice')
  })

  /*
   * Shown shortened. The whole key on a settings screen is longer than it
   * is useful; sixteen characters is enough to compare against a server's
   * peer list, which is the only thing anybody does with it.
   */
  it('is shortened rather than printed whole', () => {
    expect(source).toContain('slice(0, 16)')
  })

  /*
   * Said next to the button. Resetting reaches this device: the old key
   * keeps whatever access it had until somebody removes it on the server,
   * and whoever is resetting because a key leaked needs to know that is not
   * the end of it.
   */
  it('says that resetting does not revoke the old key', () => {
    expect(source).toContain('until it is removed on the server')
  })

  // The stand-in joins nothing and so is known by nobody; the section is
  // absent rather than showing an empty key.
  it('is absent on a simulated build', async () => {
    const screen = await render('settings', {}, { keychain: {} }).settle()
    expect(screen.text).not.toContain('This device')
    expect(screen.text).toContain('Not paired')
  })
})

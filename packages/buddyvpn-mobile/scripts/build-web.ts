/* eslint-disable no-console */
/**
 * Compile the screens into what Craft renders.
 *
 * stx has two renderers and this uses the native one: `stx native compile`
 * turns a screen into a widget tree — a `<button>` becomes a `Button`, not an
 * HTML element — which Craft draws with UIKit. That is the difference between
 * a phone app and a website in a wrapper, and it is why the screens live in
 * `screens/` with `components/` and `layouts/` beside them, the layout stx
 * looks for.
 *
 * Two outputs:
 *
 *   dist/native-screens.js   the JavaScriptCore bundle Craft loads
 *   dist/craft.config.json   what the app may do, from mobile.config.ts
 *
 * The second is generated rather than written by hand so the capabilities in
 * one place cannot drift from the Info.plist built out of them. A capability
 * declared and not implemented is a permission prompt for something the app
 * never does.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import config from '../mobile.config'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCREENS_DIR = join(PACKAGE_DIR, 'screens')
const OUT_DIR = join(PACKAGE_DIR, 'dist')
const STX = '@stacksjs/stx'

/**
 * The compiler, resolved rather than looked up.
 *
 * This used to run `bunx @stacksjs/stx`, which prefers what is installed and
 * falls back to fetching from the registry when it is not — so a machine
 * with a different or missing copy compiles these screens with a different
 * compiler, silently, and the only sign is that the output is wrong. CI
 * restores `node_modules` from a cache key, which is exactly the situation
 * where "whatever bunx finds" and "what this repo pins" can differ.
 *
 * Resolved from the installed package instead, and loud when it is absent:
 * a missing compiler should stop the build, not quietly become a download.
 */
function stxCli(): string {
  try {
    // The package's own entry, from which its bin sits at a known path.
    const entry = fileURLToPath(import.meta.resolve(STX))
    const root = entry.slice(0, entry.lastIndexOf(`${STX}/`) + STX.length + 1)
    const cli = join(root, 'dist', 'cli.js')
    if (existsSync(cli))
      return cli
    throw new Error(`no cli at ${cli}`)
  }
  catch (error) {
    throw new Error(
      `${STX} is not installed, so these screens cannot be compiled. `
      + `It is a devDependency of this package; run \`bun install\`. (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

const STX_CLI = stxCli()

function run(args: string[], cwd: string): { ok: boolean, stdout: string, stderr: string } {
  const result = Bun.spawnSync(['bun', STX_CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

/** Every screen, in a stable order so the bundle does not churn between builds. */
function screens(): string[] {
  if (!existsSync(SCREENS_DIR))
    return []
  return readdirSync(SCREENS_DIR).filter(name => name.endsWith('.stx')).sort()
}

/**
 * The capability flags, under the names Craft reads.
 *
 * Derived from `mobile.config.ts` rather than duplicated: this is the file
 * that decides what goes in the Info.plist, and two hand-maintained lists
 * would eventually disagree about whether the app asks for location.
 */
function craftConfig(): Record<string, unknown> {
  const { ios } = config
  return {
    renderer: 'native',
    appName: ios.appName,
    bundleId: ios.bundleId,
    darkMode: ios.appearance !== 'light',
    deploymentTarget: ios.deploymentTarget,
    orientations: ios.orientations,
    urlSchemes: ios.urlSchemes,
    enableHaptics: ios.capabilities.haptics,
    enableSecureStorage: ios.capabilities.secureStorage,
    enablePushNotifications: ios.capabilities.pushNotifications,
    enableDeepLinks: ios.capabilities.deepLinks,
    enableNetworkExtension: ios.capabilities.networkExtension,
  }
}

const found = screens()
if (found.length === 0) {
  console.error('[mobile] no screens in screens/ — nothing to build')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
console.log(`[mobile] screens: ${found.join(', ')}`)
// Said out loud because which compiler ran is the thing you want to know
// when the same source produces different output on two machines.
console.log(`[mobile] compiler: ${STX_CLI}`)

/*
 * The screens config stx reads, generated rather than kept by hand.
 *
 * It maps a route name to a screen, and a hand-written copy is a list that
 * silently stops matching the directory the moment a screen is added — the
 * build would succeed and the new screen would simply not exist in the app.
 * `connect` is the route the app opens on, so it is written first.
 */
const routes: Record<string, string> = {}
for (const file of found) {
  const route = file.replace(/\.stx$/, '')
  routes[route] = join('screens', file)
}
const nativeConfig = join(PACKAGE_DIR, 'native.config.json')
writeFileSync(nativeConfig, `${JSON.stringify({ screens: routes, routed: true }, null, 2)}\n`)
console.log(`[mobile] routes: ${Object.keys(routes).join(', ')}`)

const bundle = join(OUT_DIR, 'native-screens.js')
const result = run(['native', 'compile', '--format', 'bundle', '--output', bundle, '--minify'], PACKAGE_DIR)

/*
 * stx reports a screen it could not fully translate as a warning and still
 * emits a bundle, so exit status alone would call a half-compiled app a
 * success. What the warnings mean, though, needs reading carefully — an
 * earlier version of this script got it backwards and said so in the output.
 *
 * `unread-event` comes from the translator's attribute pass, which maps `@x`
 * to a native event. `@if` and `@for` are not events, so that pass reports
 * them — but it runs *after* the binding manifest has already claimed those
 * same attributes as `if` and `for` bindings, and it is the manifest the
 * runtime hydrates from. A warning naming a directive is therefore expected
 * and means nothing is wrong.
 *
 * A warning naming a real event (`@click` on something that cannot carry one)
 * is a different matter and does mean a dead control.
 *
 * Rather than re-deriving which is which, this checks the artifact: an
 * attribute that reached the manifest appears in the emitted bundle as a
 * binding under its own name.
 */
const warnings = `${result.stdout}\n${result.stderr}`
  .split('\n')
  .filter(line => line.includes('warning:'))
  .map(line => line.trim())

for (const warning of warnings)
  console.warn(`[mobile] ${warning}`)

if (!result.ok) {
  console.error(result.stderr || result.stdout)
  process.exit(1)
}

const compiled = existsSync(bundle) ? await Bun.file(bundle).text() : ''

/*
 * The one failure that would make every screen inert, and the one worth
 * failing the build over: no setup function means no signals, so nothing the
 * bindings refer to would exist. stx writes `__stx_latestSetup = null` for a
 * route whose script it could not lift, and still emits a bundle.
 */
if (compiled.includes('__stx_latestSetup = null') || !compiled.includes('__stx_setup_')) {
  console.error('[mobile] the bundle carries no setup function, so the screens would render inert')
  process.exit(1)
}

const bound = new Set(Array.from(compiled.matchAll(/name:"([^"]+)"/g), match => match[1]))
const unaccounted = warnings
  .filter(line => line.includes('unread-event'))
  .map(line => line.slice(line.lastIndexOf(':') + 1).trim())
  .filter(name => !bound.has(name))

writeFileSync(join(OUT_DIR, 'craft.config.json'), `${JSON.stringify(craftConfig(), null, 2)}\n`)

const size = existsSync(bundle) ? Bun.file(bundle).size : 0
console.log(`[mobile] dist/native-screens.js (${(size / 1024).toFixed(0)} KB)`)
console.log('[mobile] dist/craft.config.json')

const bindings = Array.from(compiled.matchAll(/kind:"(if|for|event|attr|text|show|class|style|model|html)"/g), m => m[1])
const counted = bindings.reduce<Record<string, number>>((all, kind) => ({ ...all, [kind]: (all[kind] ?? 0) + 1 }), {})
console.log(`[mobile] bindings: ${Object.entries(counted).map(([kind, n]) => `${n} ${kind}`).join(', ') || 'none'}`)

/*
 * Screens with no bindings are screens that do nothing, and this build has
 * now shipped them twice without saying so.
 *
 * A setup function is not enough on its own: the artifact can carry one and
 * still have had every binding dropped, which is what a machine without a
 * working client-script bundler produces. The result compiles, reports
 * success, and renders a tree that never changes — no taps, no state, no
 * text that was bound rather than written.
 *
 * These screens use `@click` and `:text`, so a build with none of either is
 * wrong by inspection. Said with the compiler's own output, because the
 * reason is never in ours.
 */
const expected = ['event', 'text'] as const
const missing = expected.filter(kind => (counted[kind] ?? 0) === 0)
if (missing.length > 0) {
  console.error(`[mobile] the screens compiled with no ${missing.join(' or ')} bindings, so nothing on them would react`)
  console.error('[mobile] the compiler said:')
  console.error(`${result.stdout}\n${result.stderr}`.trim() || '(nothing)')
  process.exit(1)
}

if (unaccounted.length > 0) {
  console.warn(`[mobile] ${unaccounted.length} handler(s) reached no binding: ${[...new Set(unaccounted)].join(', ')}`)
  console.warn('[mobile] those controls will render and not react — see screens/README.md')
}

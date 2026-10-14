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

function run(args: string[], cwd: string): { ok: boolean, stdout: string, stderr: string } {
  const result = Bun.spawnSync(['bunx', STX, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
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
 * success. The warnings are printed, and the ones that mean a control will
 * not work are counted.
 *
 * `unread-event` is that kind: it means a directive was parsed as an event
 * handler the renderer has no use for, so an `@if` never becomes a condition
 * and a loop never becomes a list.
 */
const warnings = `${result.stdout}\n${result.stderr}`
  .split('\n')
  .filter(line => line.includes('warning:'))
  .map(line => line.trim())

for (const warning of warnings)
  console.warn(`[mobile] ${warning}`)

const unread = warnings.filter(line => line.includes('unread-event')).length

if (!result.ok) {
  console.error(result.stderr || result.stdout)
  process.exit(1)
}

writeFileSync(join(OUT_DIR, 'craft.config.json'), `${JSON.stringify(craftConfig(), null, 2)}\n`)

const size = existsSync(bundle) ? Bun.file(bundle).size : 0
console.log(`[mobile] dist/native-screens.js (${(size / 1024).toFixed(0)} KB)`)
console.log('[mobile] dist/craft.config.json')

if (unread > 0) {
  console.warn(`[mobile] ${unread} directive(s) did not become native behaviour — those controls will render but not react`)
  console.warn('[mobile] see screens/README.md')
}

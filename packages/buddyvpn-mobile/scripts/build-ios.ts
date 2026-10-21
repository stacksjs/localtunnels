/* eslint-disable no-console */
/**
 * Generate the Xcode project that draws the screens on a phone.
 *
 * `build:web` produces the bundle; this produces the app around it. The two
 * are kept separate because they fail for unrelated reasons — a screen that
 * will not compile is a template problem, and a project that will not
 * generate is a toolchain one, and a single command that did both would
 * report either as the other.
 *
 * The builder is `craft-native`, not the `craft` CLI: only the former knows
 * what a native stx bundle is. `craft ios build --html-path` builds a web
 * view around a page, which is the thing this app is deliberately not.
 *
 * Output is `ios/`, generated and gitignored. Nothing in it is edited by
 * hand — it is rebuilt from `mobile.config.ts` and the bundle every time, so
 * an edit there is lost at the next build rather than quietly kept.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build, init } from 'craft-native/ios'
import config from '../mobile.config'
import { installAppIcon } from './ios-app-icon'
import { unjustifiedUsageDescriptions, withoutUnusedUsageDescriptions } from './ios-privacy'
import { emitTunnelExtension, planTunnel, readPlist, removeTunnelExtension, writePlist } from './ios-tunnel-extension'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(PACKAGE_DIR, 'ios')
const BUNDLE = join(PACKAGE_DIR, 'dist', 'native-screens.js')
/*
 * The home screen icon, drawn by `scripts/app-icon.swift`.
 *
 * Committed rather than rendered here: the icon changes about never, and a
 * build that shells out to `swift` to produce one would fail on a machine
 * without Xcode for no gain. `app-icon.swift` paints the background edge to
 * edge, so the file carries no alpha for anything to flatten.
 *
 * Without it `AppIcon.appiconset` is written empty and the app installs
 * with no icon at all — a blank grey square on the home screen, which is
 * exactly what it looked like.
 */
const APP_ICON = join(PACKAGE_DIR, 'assets', 'app-icon.png')

/*
 * The bundle is rebuilt rather than assumed.
 *
 * An Xcode project generated around a stale bundle is the failure this
 * package has already had once in another form: everything reports success
 * and the thing that runs is not the thing that was just written.
 */
const web = Bun.spawnSync(['bun', 'run', 'build:web'], { cwd: PACKAGE_DIR, stdout: 'inherit', stderr: 'inherit' })
if (web.exitCode !== 0) {
  console.error('[mobile] the screens did not compile, so there is nothing to build an app around')
  process.exit(1)
}

if (!existsSync(BUNDLE)) {
  console.error(`[mobile] no bundle at ${BUNDLE}`)
  process.exit(1)
}

/*
 * XcodeGen has to be reached by its real path, not through a symlink.
 *
 * It finds its SettingPresets relative to its own executable, and those
 * presets are where `PRODUCT_NAME = "$(TARGET_NAME)"` comes from. Reached
 * through `~/.local/share/pantry/global/bin/xcodegen` it looks for them
 * beside *that* directory, finds none, and silently generates a project with
 * no product name — which Xcode then fails to build with
 *
 *   error: Multiple commands produce '…/Debug-iphonesimulator/.app'
 *
 * naming an app bundle that is nothing but an extension. The cause is a
 * package that symlinks `bin` without `share`, so it is worth being immune to
 * rather than diagnosing again: the real directory goes first on PATH, and
 * the tool resolves its own resources correctly from there.
 */
function withResolvedXcodegen(): void {
  const found = Bun.spawnSync(['which', 'xcodegen'], { stdout: 'pipe' })
  const onPath = found.stdout.toString().trim()
  if (!onPath)
    return
  const presets = (bin: string): string => join(dirname(bin), '..', 'share', 'xcodegen', 'SettingPresets')
  // Already resolvable where it stands: a prefix whose share/ is linked
  // beside its bin/ needs nothing from us, and saying otherwise would be a
  // line of output that is simply false.
  if (existsSync(presets(onPath)))
    return
  const real = Bun.spawnSync(['readlink', '-f', onPath], { stdout: 'pipe' }).stdout.toString().trim()
  if (!real || real === onPath)
    return
  if (!existsSync(presets(real)))
    return
  console.log(`[mobile] using ${real} directly — its presets do not resolve through the symlink on PATH`)
  process.env.PATH = `${dirname(real)}:${process.env.PATH ?? ''}`
}

withResolvedXcodegen()

const { ios } = config

/*
 * Which app path each screen draws.
 *
 * `renderer: 'native'` means there is no web view at all, so every path here
 * must name a screen in the bundle, and the start path — `/`, with no
 * devServerURL — has to be one of them or the app opens to nothing.
 * The names are the bundle's route names, which `build:web` takes from the
 * screen filenames.
 */
const nativeScreens: Record<string, string> = {
  '/': 'connect',
  '/locations': 'locations',
  '/settings': 'settings',
}

const craft = {
  appName: ios.appName,
  bundleId: ios.bundleId,
  renderer: 'native' as const,
  nativeScreens,
  // An absolute path, not a filename: the builder opens this to copy it into
  // the project, resolving it against the working directory rather than
  // against the config. A bare name only works when the build happens to run
  // from the directory holding the bundle.
  nativeBundle: BUNDLE,
  appearance: ios.appearance,
  deploymentTarget: ios.deploymentTarget,
  orientations: ios.orientations,
  urlSchemes: ios.urlSchemes,
  enableHaptics: ios.capabilities.haptics,
  enableSecureStorage: ios.capabilities.secureStorage,
  enablePushNotifications: ios.capabilities.pushNotifications,
  enableDeepLinks: ios.capabilities.deepLinks,
}

try {
  // `init` lays down the project shell; it is skipped once that exists so a
  // rebuild does not discard Xcode metadata. `build` regenerates the project
  // and copies the bundle in, which is the part that must run every time.
  if (!existsSync(join(OUT_DIR, 'project.yml'))) {
    console.log(`[mobile] initialising ${ios.appName} (${ios.bundleId})`)
    await init({ name: ios.appName, bundleId: ios.bundleId, output: OUT_DIR, config: craft })
  }

  /*
   * The tunnel's own target, added between `init` and `build`.
   *
   * `init` writes project.yml and `build` runs xcodegen over it, so this is
   * the one point where the project can be changed and still be generated
   * from. Craft produces a single app target; a VPN needs a second process,
   * and Craft has no notion of one.
   *
   * Off by default, and that is not timidity: entitlements a provisioning
   * profile does not carry fail to sign, so emitting this before Apple grants
   * the Network Extension entitlement would break every build — including the
   * simulator builds the screens are checked in.
   */
  const plan = planTunnel(ios.appName, ios.bundleId)
  if (ios.capabilities.networkExtension) {
    const written = emitTunnelExtension(OUT_DIR, plan)
    console.log(`[mobile] tunnel extension: ${plan.tunnelBundleId}`)
    for (const file of written)
      console.log(`[mobile]   ${file}`)
  }
  else {
    /*
     * Removed, not merely skipped.
     *
     * `init` runs once and project.yml persists, so a project generated
     * while the capability was on would keep its extension — and, worse,
     * keep the entitlement in Craft.entitlements, which fails to sign
     * against a profile that does not carry it. Turning the capability off
     * has to actually take it back out.
     */
    const removed = removeTunnelExtension(OUT_DIR, plan)
    if (removed.length)
      console.log(`[mobile] removed the tunnel extension (capabilities.networkExtension is off): ${removed.join(', ')}`)
    else
      console.log('[mobile] no tunnel extension: capabilities.networkExtension is off, so the app has no VPN target')
  }

  await build({ nativeBundlePath: BUNDLE, output: OUT_DIR, generateProject: true })

  /*
   * After `build`, not through Craft's own `appIconPath`.
   *
   * Craft writes the asset catalog from `init`, which this build runs once
   * and skips ever after so a rebuild does not discard Xcode's metadata —
   * so an icon handed to Craft would land on a fresh checkout and on no
   * later build. See `ios-app-icon.ts`, which also refuses an icon App
   * Store Connect would, at build rather than at upload.
   */
  installAppIcon(OUT_DIR, APP_ICON)

  /*
   * After `build`, because Craft owns this file and writes it.
   *
   * Craft declares a usage description for every protected API it knows how
   * to reach, which for this app is eleven strings covering ten capabilities
   * it does not enable. None of them prompts anybody — a usage description
   * is read when its API is called and this app calls none — so the only
   * places it surfaces are App Review, the privacy labels, and somebody
   * dumping a VPN's plist, which is a thing that happens to VPNs. See
   * `ios-privacy.ts` for what is kept and why.
   */
  const infoPlistPath = join(OUT_DIR, 'Info.plist')
  if (existsSync(infoPlistPath)) {
    const plist = readPlist(infoPlistPath)
    const unjustified = unjustifiedUsageDescriptions(plist)
    if (unjustified.length > 0) {
      writePlist(infoPlistPath, withoutUnusedUsageDescriptions(plist))
      // Named rather than counted: a step that edits a generated file
      // without saying what it changed is one nobody can audit from a log.
      console.log(`[mobile] removed ${unjustified.length} unused usage description(s): ${unjustified.join(', ')}`)
    }
  }

  console.log(`[mobile] ios/ generated — open it with: bunx craft-sdk ios open`)
}
catch (error) {
  /*
   * Said in full rather than summarised. This step shells out to xcodegen and
   * a Zig runtime, so the useful part of a failure is usually the tool's own
   * message about what is missing, not ours about the step.
   */
  console.error('[mobile] the iOS project could not be generated')
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
}

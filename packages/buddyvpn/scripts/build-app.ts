#!/usr/bin/env bun
/* eslint-disable ts/no-top-level-await, no-console */
/**
 * Package the VPN as a macOS `.app` inside a `.dmg`.
 *
 * SystemCleaner drives `buddy build:desktop` for this, because it is a Stacks
 * application and the framework knows how to assemble its bundle. This repo is
 * not one, so the assembly is here — which is about a hundred lines, because a
 * `.app` is a directory with a plist in it.
 *
 * The bundle is self-contained, and that is the one real departure from
 * SystemCleaner. That app had to hunt PATH for the localtunnels CLI and report
 * "not installed" when it found nothing; this one *is* the VPN, so the CLI and
 * the native core ship inside it:
 *
 *   Contents/MacOS/BuddyVPN   the launcher, with the agent as a subcommand
 *   Contents/MacOS/craft-runtime      the webview
 *   Contents/MacOS/localtunnels       the CLI, elevated to bring the tunnel up
 *   Contents/MacOS/libltvpn.dylib     the native core the CLI dlopens
 *   Contents/Resources/web/           the window
 *
 * `libltvpn.dylib` lands beside the CLI deliberately: the CLI's own resolver
 * looks next to its `execPath` first, which is this directory.
 *
 * Signing
 * -------
 * `DESKTOP_SIGNING_IDENTITY` (a Developer ID Application identity) signs for
 * distribution. Without one the bundle is still sealed, ad hoc — because an
 * unsealed bundle does not launch *anywhere*. `bun build --compile` leaves the
 * launcher linker-signed ad hoc while the bundle around it has no
 * `_CodeSignature`, and macOS kills that combination on exec with SIGTRAP and
 * no message: one bounce in the Dock and gone.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

const PACKAGE_DIR = path.resolve(import.meta.dir, '..')
const ROOT = path.resolve(PACKAGE_DIR, '../..')
const APP_NAME = 'BuddyVPN'
const OUT_DIR = path.join(PACKAGE_DIR, 'dist')
const APP_DIR = path.join(OUT_DIR, `${APP_NAME}.app`)

const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string

if (process.platform !== 'darwin') {
  console.error('[buddyvpn] the VPN app only builds on macOS')
  process.exit(1)
}

function run(command: string, args: string[], cwd = ROOT): void {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed`)
}

/**
 * The macOS SDK a Mach-O was linked against.
 *
 * Not trivia: AppKit keys its appearance off the SDK in `LC_BUILD_VERSION`, so
 * a runtime built against an older one draws last year's window buttons. The
 * runtime draws this app's window, so among candidates the newest SDK wins
 * rather than the newest version.
 */
function linkedSdk(binary: string): number {
  const printed = spawnSync('otool', ['-l', binary], { encoding: 'utf8' })
  if (printed.status !== 0 || !printed.stdout)
    return 0
  const match = printed.stdout.match(/LC_BUILD_VERSION[\s\S]*?sdk (\d+)\.(\d+)/)
  return match ? Number(match[1]) : 0
}

/**
 * Find the Craft runtime to bundle.
 *
 * `CRAFT_BIN` wins, so a checkout can be pointed at without installing
 * anything. Otherwise the pantry this repo's `deps.yaml` declares.
 */
function resolveCraft(): string {
  if (process.env.CRAFT_BIN) {
    if (!fs.existsSync(process.env.CRAFT_BIN))
      throw new Error(`CRAFT_BIN is set to a path that does not exist: ${process.env.CRAFT_BIN}`)
    return process.env.CRAFT_BIN
  }

  const pantry = path.join(ROOT, 'pantry/craft-native.org')
  const candidates = fs.existsSync(pantry)
    ? fs.readdirSync(pantry)
        .filter(name => name.startsWith('v'))
        .map(dir => path.join(pantry, dir, 'bin/craft'))
        .filter(candidate => fs.existsSync(candidate))
    : []

  if (candidates.length === 0) {
    throw new Error(
      'No Craft runtime found. Install it with `launchpad install` (see deps.yaml), '
      + 'or point CRAFT_BIN at a craft binary.',
    )
  }

  return candidates.reduce((best, candidate) => (linkedSdk(candidate) > linkedSdk(best) ? candidate : best))
}

// ── 1. The binaries ─────────────────────────────────────────────
console.log('[buddyvpn] compiling')
fs.rmSync(OUT_DIR, { recursive: true, force: true })
const macosDir = path.join(APP_DIR, 'Contents/MacOS')
const resourcesDir = path.join(APP_DIR, 'Contents/Resources')
fs.mkdirSync(macosDir, { recursive: true })
fs.mkdirSync(resourcesDir, { recursive: true })

run('bun', [
  'build',
  '--production',
  path.join(PACKAGE_DIR, 'src/launcher.ts'),
  '--compile',
  '--outfile',
  path.join(macosDir, APP_NAME),
])

// The CLI the app elevates. Compiled from this repo rather than downloaded,
// so the app and the tunnel it brings up are built from the same commit.
run('bun', [
  'build',
  '--production',
  path.join(ROOT, 'packages/localtunnels/bin/cli.ts'),
  '--compile',
  '--external',
  '@stacksjs/ts-analytics',
  '--outfile',
  path.join(macosDir, 'localtunnels'),
])

// ── 2. The native core ──────────────────────────────────────────
const library = path.join(ROOT, 'packages/vpn-core/zig-out/lib/libltvpn.dylib')
if (!fs.existsSync(library))
  throw new Error(`libltvpn.dylib is missing. Build it first: bun run build:native (looked in ${library})`)
fs.copyFileSync(library, path.join(macosDir, 'libltvpn.dylib'))

// ── 3. The runtime and the payload ──────────────────────────────
const craft = resolveCraft()
console.log(`[buddyvpn] craft runtime: ${path.relative(ROOT, craft)} (SDK ${linkedSdk(craft)})`)
fs.copyFileSync(craft, path.join(macosDir, 'craft-runtime'))
fs.chmodSync(path.join(macosDir, 'craft-runtime'), 0o755)

fs.cpSync(path.join(PACKAGE_DIR, 'web'), path.join(resourcesDir, 'web'), { recursive: true })

// ── 4. Info.plist ───────────────────────────────────────────────
const overrides = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'Info.plist.json'), 'utf8')) as Record<string, unknown>
const plist = {
  CFBundleDisplayName: APP_NAME,
  CFBundleExecutable: APP_NAME,
  CFBundleName: APP_NAME,
  CFBundleInfoDictionaryVersion: '6.0',
  CFBundlePackageType: 'APPL',
  CFBundleShortVersionString: APP_VERSION,
  CFBundleVersion: APP_VERSION,
  ...overrides,
}

/**
 * Written as JSON and converted, rather than assembled as XML by hand.
 *
 * `plutil` owns the escaping, which matters because the usage strings are
 * prose and one unescaped `&` in a hand-built plist is a bundle macOS refuses
 * to load with a message about an unparseable Info.plist.
 */
const plistJson = path.join(os.tmpdir(), `buddyvpn-plist-${process.pid}.json`)
fs.writeFileSync(plistJson, JSON.stringify(plist))
run('plutil', ['-convert', 'xml1', plistJson, '-o', path.join(APP_DIR, 'Contents/Info.plist')])
fs.rmSync(plistJson, { force: true })

// ── 5. Seal ─────────────────────────────────────────────────────
// Inside out: nested code first, the bundle last. A bundle sealed before the
// executables inside it carries hashes of files that then changed.
const identity = process.env.DESKTOP_SIGNING_IDENTITY
const adhoc = !identity
const entitlements = path.join(PACKAGE_DIR, 'Entitlements.plist')

if (!adhoc && !fs.existsSync(entitlements))
  throw new Error(`Signing with an identity needs ${entitlements}`)

const signArgs = adhoc
  ? ['--force', '--sign', '-']
  : ['--force', '--options', 'runtime', '--entitlements', entitlements, '--timestamp', '--sign', identity as string]

console.log(`[buddyvpn] sealing (${adhoc ? 'ad hoc' : 'Developer ID'})`)
for (const name of ['craft-runtime', 'localtunnels', 'libltvpn.dylib', APP_NAME])
  run('codesign', [...signArgs, path.join(macosDir, name)])
run('codesign', [...signArgs, APP_DIR])
run('codesign', ['--verify', '--deep', '--strict', APP_DIR])

// ── 6. Image ────────────────────────────────────────────────────
// The volume carries the version, which is the macOS convention and also
// sidesteps a collision: with the app installed, TCC refuses to let anything
// create a second `/Volumes/<App>/<App>.app` over the copy it manages.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'buddyvpn-dmg-'))
fs.cpSync(APP_DIR, path.join(stage, `${APP_NAME}.app`), { recursive: true, verbatimSymlinks: true })
fs.symlinkSync('/Applications', path.join(stage, 'Applications'))

const dmg = path.join(OUT_DIR, `BuddyVPN-${APP_VERSION}.dmg`)
run('hdiutil', ['create', '-volname', `${APP_NAME} ${APP_VERSION}`, '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg])
fs.rmSync(stage, { recursive: true, force: true })

console.log(`[buddyvpn] ${path.relative(ROOT, APP_DIR)}`)
console.log(`[buddyvpn] ${path.relative(ROOT, dmg)}`)
if (adhoc)
  console.warn('[buddyvpn] DESKTOP_SIGNING_IDENTITY is unset — sealed ad hoc, so it runs on this Mac and is refused on every other')

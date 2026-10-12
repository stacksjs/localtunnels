/* eslint-disable node/prefer-global/process */
/**
 * Build the release artifacts: one zip per platform holding the compiled CLI
 * *and* the native library it needs.
 *
 * The two used to be packaged separately, which meant they were not packaged
 * together at all — `zip:*` packed the binary alone, so every download had a
 * CLI whose first VPN command failed with "native libltvpn not found". The
 * library is resolved beside the executable (see `src/vpn/ffi.ts`), so putting
 * it in the same zip is the whole fix.
 *
 *   bun run package
 *   bun run package -- --target darwin-arm64     # just one
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const REPO_ROOT = join(import.meta.dir, '..')
const BIN_DIR = join(REPO_ROOT, 'bin')
const VPN_CORE = join(REPO_ROOT, 'packages', 'vpn-core')
const CLI_ENTRY = join(REPO_ROOT, 'packages', 'localtunnels', 'bin', 'cli.ts')

interface Target {
  /** Our platform name, used in the artifact filenames. */
  name: string
  /** `bun build --target`. */
  bunTarget: string
  /** `zig build -Dtarget`. */
  zigTarget: string
  /** The file zig writes. Its directory differs by target — see findLibrary. */
  zigOutput: string
  /**
   * What the library must be called next to the binary.
   *
   * Bun's `suffix` gives `dll` on Windows, so the resolver looks for
   * `libltvpn.dll` — but zig emits `ltvpn.dll`, without the `lib` prefix that
   * only applies to Unix shared objects. Renaming on the way into the zip is
   * what makes the one name the resolver uses correct on all five platforms.
   */
  libName: string
  /** Extension on the CLI itself. */
  exeSuffix: string
}

const TARGETS: Target[] = [
  { name: 'linux-x64', bunTarget: 'bun-linux-x64', zigTarget: 'x86_64-linux-gnu.2.31', zigOutput: 'libltvpn.so', libName: 'libltvpn.so', exeSuffix: '' },
  { name: 'linux-arm64', bunTarget: 'bun-linux-arm64', zigTarget: 'aarch64-linux-gnu.2.31', zigOutput: 'libltvpn.so', libName: 'libltvpn.so', exeSuffix: '' },
  { name: 'windows-x64', bunTarget: 'bun-windows-x64', zigTarget: 'x86_64-windows', zigOutput: 'ltvpn.dll', libName: 'libltvpn.dll', exeSuffix: '.exe' },
  { name: 'darwin-x64', bunTarget: 'bun-darwin-x64', zigTarget: 'x86_64-macos', zigOutput: 'libltvpn.dylib', libName: 'libltvpn.dylib', exeSuffix: '' },
  { name: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', zigTarget: 'aarch64-macos', zigOutput: 'libltvpn.dylib', libName: 'libltvpn.dylib', exeSuffix: '' },
]

async function run(cmd: string[], cwd?: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (await proc.exited !== 0)
    throw new Error(`\`${cmd.join(' ')}\` failed:\n${err.trim() || out.trim()}`)
}

/**
 * Locate the shared library zig just installed.
 *
 * Not always `lib/`: a Windows build puts the runtime `ltvpn.dll` in `bin/`
 * and leaves only the import library `ltvpn.lib` in `lib/`. Looking only in
 * `lib/` therefore found nothing for the one target whose layout differs.
 */
function findLibrary(prefix: string, t: Target): string {
  for (const dir of ['lib', 'bin']) {
    const candidate = join(prefix, dir, t.zigOutput)
    if (existsSync(candidate))
      return candidate
  }
  throw new Error(`zig produced no ${t.zigOutput} for ${t.zigTarget} (looked in ${prefix}/{lib,bin})`)
}

async function packageTarget(t: Target): Promise<void> {
  const exe = `localtunnels-${t.name}${t.exeSuffix}`
  // Staged in its own directory so `zip -j` cannot pick up a neighbouring
  // target's library, and so the zip has exactly two entries.
  const stage = join(BIN_DIR, `.stage-${t.name}`)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  console.log(`  ${t.name}: compiling CLI...`)
  await run([
    'bun', 'build', '--production', CLI_ENTRY,
    '--compile', '--minify',
    '--external', '@stacksjs/ts-analytics',
    `--target=${t.bunTarget}`,
    `--outfile=${join(stage, exe)}`,
  ])

  console.log(`  ${t.name}: cross-compiling ${t.libName}...`)
  const prefix = join(stage, '.zig')
  await run(['zig', 'build', `-Dtarget=${t.zigTarget}`, '--prefix', prefix], VPN_CORE)

  const built = findLibrary(prefix, t)
  await run(['cp', built, join(stage, t.libName)])
  rmSync(prefix, { recursive: true, force: true })

  const zip = join(BIN_DIR, `localtunnels-${t.name}.zip`)
  rmSync(zip, { force: true })
  // -j so the zip holds the two files flat, with no staging path around them:
  // the library has to land beside the binary wherever it is unpacked.
  await run(['zip', '-j', '-q', zip, join(stage, exe), join(stage, t.libName)])

  // Keep the loose binary where the old scripts left it, for anyone who used it.
  await run(['cp', join(stage, exe), join(BIN_DIR, exe)])
  rmSync(stage, { recursive: true, force: true })

  const size = (await Bun.file(zip).arrayBuffer()).byteLength
  console.log(`  ${t.name}: ${exe} + ${t.libName} -> ${(size / 1024 / 1024).toFixed(1)} MB`)
}

async function main(): Promise<void> {
  const idx = process.argv.indexOf('--target')
  const only = idx !== -1 ? process.argv[idx + 1] : null
  const targets = only ? TARGETS.filter(t => t.name === only) : TARGETS
  if (targets.length === 0)
    throw new Error(`Unknown target "${only}" — use one of: ${TARGETS.map(t => t.name).join(', ')}`)

  mkdirSync(BIN_DIR, { recursive: true })
  console.log(`Packaging ${targets.length} target${targets.length === 1 ? '' : 's'}...`)
  for (const t of targets)
    await packageTarget(t)

  // The host library is rebuilt last: the cross-compiles above leave zig-out
  // holding whichever target ran most recently, which would otherwise break
  // local tests in a way that looks nothing like its cause.
  console.log('Restoring the host native build...')
  await run(['zig', 'build'], VPN_CORE)
  console.log('Done.')
}

main().catch((err) => {
  console.error(`\n  Packaging failed: ${err.message}\n`)
  process.exit(1)
})

/* eslint-disable no-console */
/**
 * Cross-compile libltvpn for iOS.
 *
 * The protocol is Zig, in `packages/vpn-core`, and it does not need
 * rewriting in Swift to run on a phone: `zig build-lib -target aarch64-ios`
 * produces a static archive with every entry point intact. What it does need
 * is an iOS SDK to link against — Zig ships no libSystem stub for iOS, so
 * without `--sysroot` the compile succeeds and the link fails on `getentropy`,
 * `mmap` and `bzero`.
 *
 * ── Why an XCFramework rather than a library ───────────────────────────
 *
 * A phone and a simulator are different platforms, not different
 * architectures, so their archives cannot be `lipo`'d into one file — the
 * tool refuses, and rightly. An XCFramework is the container Apple provides
 * for exactly this, and Xcode picks the right slice per destination without
 * the project knowing which one it is.
 *
 * ── On the deployment target ───────────────────────────────────────────
 *
 * Pinned to the app's, not left to Zig. A bare `-target aarch64-ios` builds
 * for whatever iOS the toolchain thinks is current — 18.0 here — and a
 * library with a higher minimum than the app linking it is a mismatch that
 * surfaces at link time as a warning nobody reads, or at launch on an older
 * phone as a crash.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import config from '../mobile.config'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORE_DIR = resolve(PACKAGE_DIR, '..', 'vpn-core')
const BUILD_DIR = join(PACKAGE_DIR, 'dist', 'core-ios')
export const XCFRAMEWORK: string = join(BUILD_DIR, 'libltvpn.xcframework')

/** A slice of the framework: one platform, one archive. */
interface Slice {
  name: string
  /** The Zig target triple, with the deployment target spelled in full. */
  target: string
  /** Which SDK `xcrun` should hand us. */
  sdk: 'iphoneos' | 'iphonesimulator'
}

function slices(deploymentTarget: string): Slice[] {
  // Zig wants three version components; the config carries two.
  const version = deploymentTarget.split('.').length === 2 ? `${deploymentTarget}.0` : deploymentTarget
  return [
    { name: 'device', target: `aarch64-ios.${version}`, sdk: 'iphoneos' },
    // Apple silicon only. An Intel Mac would need an x86_64 simulator slice
    // beside this one; nothing here builds for one, and the simulator slice
    // exists for checking the build rather than for shipping.
    { name: 'simulator', target: `aarch64-ios.${version}-simulator`, sdk: 'iphonesimulator' },
  ]
}

function sdkPath(sdk: string): string {
  const found = Bun.spawnSync(['xcrun', '--sdk', sdk, '--show-sdk-path'], { stdout: 'pipe', stderr: 'pipe' })
  const path = found.stdout.toString().trim()
  if (found.exitCode !== 0 || !path)
    throw new Error(`no ${sdk} SDK: ${found.stderr.toString().trim() || 'xcrun found nothing'}`)
  return path
}

export function buildCore(): string {
  if (!existsSync(join(CORE_DIR, 'src', 'lib.zig')))
    throw new Error(`no vpn-core sources at ${CORE_DIR}`)

  rmSync(BUILD_DIR, { recursive: true, force: true })
  mkdirSync(BUILD_DIR, { recursive: true })

  const args: string[] = []
  for (const slice of slices(config.ios.deploymentTarget)) {
    const out = join(BUILD_DIR, slice.name)
    mkdirSync(out, { recursive: true })
    const archive = join(out, 'libltvpn.a')

    const built = Bun.spawnSync([
      'zig',
      'build-lib',
      join(CORE_DIR, 'src', 'lib.zig'),
      '-target',
      slice.target,
      '-OReleaseFast',
      '-lc',
      '--sysroot',
      sdkPath(slice.sdk),
      '-static',
      `-femit-bin=${archive}`,
    ], { cwd: CORE_DIR, stdout: 'pipe', stderr: 'pipe' })

    if (built.exitCode !== 0 || !existsSync(archive))
      throw new Error(`libltvpn did not build for ${slice.target}:\n${built.stderr.toString()}`)

    console.log(`[mobile] libltvpn ${slice.name}: ${slice.target}`)
    args.push('-library', archive, '-headers', join(CORE_DIR, 'include'))
  }

  const packed = Bun.spawnSync([
    'xcodebuild',
    '-create-xcframework',
    ...args,
    '-output',
    XCFRAMEWORK,
  ], { stdout: 'pipe', stderr: 'pipe' })

  if (packed.exitCode !== 0 || !existsSync(XCFRAMEWORK))
    throw new Error(`the xcframework could not be assembled:\n${packed.stderr.toString() || packed.stdout.toString()}`)

  console.log(`[mobile] libltvpn.xcframework (iOS ${config.ios.deploymentTarget}+)`)
  return XCFRAMEWORK
}

if (import.meta.main) {
  try {
    buildCore()
  }
  catch (error) {
    console.error('[mobile] the VPN core did not build for iOS')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

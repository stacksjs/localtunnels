/**
 * Add the packet tunnel provider target to the generated Xcode project.
 *
 * Craft generates one target: the app. A VPN needs two. The provider is an
 * app extension — a separate process with its own bundle id, its own
 * entitlements and its own Info.plist, embedded in the app and started by the
 * system rather than by us. Craft has no notion of app extensions beyond
 * WidgetKit, and nothing anywhere in it mentions NetworkExtension, so this
 * step is ours.
 *
 * It runs between `init` and `build`: `init` writes `project.yml`, this
 * rewrites it, and `build` runs xcodegen over the result. Every function here
 * is idempotent, because `ios/` is only initialised once and this runs on
 * every build.
 *
 * Gated on `capabilities.networkExtension`. With it off — which is where it
 * is today, because Apple has not granted the entitlement — nothing below
 * touches the project and the build is exactly what it was. That matters more
 * than it sounds: an app whose entitlements claim a capability its
 * provisioning profile does not carry will not sign at all, so emitting this
 * unconditionally would break every build for the sake of a target nobody can
 * run yet.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCore } from './build-core-ios'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NATIVE_DIR = join(PACKAGE_DIR, 'native', 'ios')

/**
 * Refuse to build while a native source belongs to no target.
 *
 * The lists above decide what is copied, and a file added to `native/ios/`
 * without being named in one of them is simply not compiled — the build
 * succeeds, the symbol is absent, and nothing says so until something calls
 * it. That has now happened three times in this package in one form or
 * another, so it is a build failure rather than a thing to remember.
 */
export function assertEveryNativeSourceIsClaimed(): void {
  const claimed = new Set([...TUNNEL_SOURCES, ...BRIDGE_SOURCES, BRIDGING_HEADER])
  const present = readdirSync(NATIVE_DIR).filter(name => /\.(?:swift|m|h)$/.test(name))
  const orphans = present.filter(name => !claimed.has(name))
  if (orphans.length > 0) {
    throw new Error(
      `native/ios/${orphans.join(', ')} belongs to no target. `
      + `Add it to TUNNEL_SOURCES or BRIDGE_SOURCES in ${'scripts/ios-tunnel-extension.ts'}, `
      + 'or it will not be compiled and nothing will say so.',
    )
  }
}

/** The suffix that turns the app's names into the extension's. */
export const TUNNEL_SUFFIX = 'Tunnel'

/**
 * Where the app-target half goes: the code that asks iOS for a tunnel.
 *
 * A second directory rather than more files in `Tunnel/`, because these
 * belong to a different process. `NETunnelProviderManager` lives in the
 * container app and the provider lives in the extension, and compiling
 * either into the other's target is a mistake that builds.
 */
export const BRIDGE_DIR = 'Bridge'

/** The app-target sources copied from `native/ios/`, in build order. */
const BRIDGE_SOURCES = ['TunnelControl.swift', 'TunnelBootstrap.m']

/** The extension-target sources, likewise. */
const TUNNEL_SOURCES = ['PacketTunnelProvider.swift', 'TunnelSession.swift']

/** The protocol core, cross-compiled for iOS and linked into the provider. */
export const CORE_FRAMEWORK = 'libltvpn.xcframework'

/** How Swift reaches the C the core exposes. */
const BRIDGING_HEADER = 'Tunnel-Bridging-Header.h'

/**
 * The extension point iOS starts a packet tunnel through. Not a name we
 * choose: the system matches on this string to decide what this process is.
 */
export const EXTENSION_POINT = 'com.apple.networkextension.packet-tunnel'

export interface TunnelPlan {
  /** The app's target name, which is also the scheme's. */
  appTarget: string
  /** The extension's target name. */
  tunnelTarget: string
  /** The app's bundle id. */
  bundleId: string
  /**
   * The extension's bundle id, which must be the app's plus one component —
   * iOS requires an extension to live under its container app.
   */
  tunnelBundleId: string
  /**
   * The App Group both processes share. The extension cannot read the app's
   * `localStorage` or its Application Support; a group container is the only
   * place they can both reach, and it is where the chosen region has to land
   * for the tunnel to know where to go.
   */
  appGroup: string
}

export function planTunnel(appName: string, bundleId: string): TunnelPlan {
  return {
    appTarget: appName,
    tunnelTarget: `${appName}${TUNNEL_SUFFIX}`,
    bundleId,
    tunnelBundleId: `${bundleId}.${TUNNEL_SUFFIX.toLowerCase()}`,
    appGroup: `group.${bundleId}`,
  }
}

/**
 * The extension's target, and the app's dependency on it.
 *
 * Mutating a parsed `project.yml` rather than appending text: the file is
 * generated, so its shape is known but not ours to assume line by line, and
 * a second run must produce the same project rather than a second target.
 */
export function withTunnelTarget(project: any, plan: TunnelPlan): any {
  const next = structuredClone(project)
  const app = next.targets?.[plan.appTarget]
  if (!app)
    throw new Error(`project.yml has no target named ${plan.appTarget}`)

  next.targets[plan.tunnelTarget] = {
    type: 'app-extension',
    platform: 'iOS',
    sources: [TUNNEL_SUFFIX],
    /*
     * The protocol core, as an XCFramework.
     *
     * `embed: false` because the slices hold static archives: the code is
     * linked into the extension's binary, and an embedded copy would be a
     * second one the loader never opens. A phone and a simulator are
     * different platforms rather than different architectures, which is why
     * this is a framework at all and not a single `.a`.
     */
    dependencies: [{ framework: CORE_FRAMEWORK, embed: false }],
    settings: {
      INFOPLIST_FILE: `${TUNNEL_SUFFIX}/Info.plist`,
      CODE_SIGN_ENTITLEMENTS: `${TUNNEL_SUFFIX}/${plan.tunnelTarget}.entitlements`,
      PRODUCT_BUNDLE_IDENTIFIER: plan.tunnelBundleId,
      SWIFT_OBJC_BRIDGING_HEADER: `${TUNNEL_SUFFIX}/${BRIDGING_HEADER}`,
      // Spelled out rather than inherited. This is the setting whose absence
      // once produced an app bundle named `.app`, because xcodegen could not
      // find its SettingPresets through a symlinked bin directory.
      PRODUCT_NAME: '$(TARGET_NAME)',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '1,2',
    },
  }

  // `embed` is what copies the built extension into the app's PlugIns
  // directory. Without it the app ships without its tunnel and the system has
  // nothing to start.
  const dependencies = (app.dependencies ?? []).filter((entry: any) => entry?.target !== plan.tunnelTarget)
  app.dependencies = [...dependencies, { target: plan.tunnelTarget, embed: true }]

  // The app's own half compiles into the app, not the extension.
  const sources = (app.sources ?? []).filter((entry: any) => entry !== BRIDGE_DIR)
  app.sources = [...sources, BRIDGE_DIR]
  return next
}

/**
 * The two entitlements a packet tunnel needs, merged into whatever is there.
 *
 * A merge rather than a file of our own: Craft writes the app's entitlements
 * with its keychain access group in them, and replacing that file would
 * silently drop secure storage.
 */
export function withNetworkEntitlements(entitlements: Record<string, unknown>, plan: TunnelPlan): Record<string, unknown> {
  return {
    ...entitlements,
    // The entitlement Apple grants by request. `packet-tunnel-provider` is
    // the one that carries a custom protocol; `vpn.api` — the one a paid
    // account gets — only drives IKEv2, IPsec and L2TP, which this is not.
    'com.apple.developer.networking.networkextension': ['packet-tunnel-provider'],
    'com.apple.security.application-groups': [plan.appGroup],
  }
}

/** The extension's Info.plist, which is what tells iOS what this process is. */
export function tunnelInfoPlist(plan: TunnelPlan): Record<string, unknown> {
  return {
    CFBundleDevelopmentRegion: '$(DEVELOPMENT_LANGUAGE)',
    CFBundleDisplayName: `${plan.appTarget} ${TUNNEL_SUFFIX}`,
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: '$(PRODUCT_NAME)',
    // Extensions are XPC services, and the package type says so. Xcode will
    // build a bundle that iOS refuses to load without it.
    CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: '$(MARKETING_VERSION)',
    CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
    NSExtension: {
      NSExtensionPointIdentifier: EXTENSION_POINT,
      // The class the system instantiates. `$(PRODUCT_MODULE_NAME)` is the
      // Swift module, and a provider named without it is not found at launch.
      NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).PacketTunnelProvider',
    },
  }
}

/** The extension's own entitlements: the same two, for the other process. */
export function tunnelEntitlements(plan: TunnelPlan): Record<string, unknown> {
  return {
    'com.apple.developer.networking.networkextension': ['packet-tunnel-provider'],
    'com.apple.security.application-groups': [plan.appGroup],
  }
}

/**
 * The project without the extension.
 *
 * The other half of {@link withTunnelTarget}, and not an afterthought.
 * `init` runs once and `project.yml` then persists, so turning the capability
 * off has to take the target back out — otherwise a project generated while
 * it was on keeps building an extension nobody asked for, which is the kind
 * of stale generated state this build goes out of its way to avoid.
 */
export function withoutTunnelTarget(project: any, plan: TunnelPlan): any {
  const next = structuredClone(project)
  delete next.targets?.[plan.tunnelTarget]
  const app = next.targets?.[plan.appTarget]
  if (app?.dependencies) {
    app.dependencies = app.dependencies.filter((entry: any) => entry?.target !== plan.tunnelTarget)
    if (app.dependencies.length === 0)
      delete app.dependencies
  }
  if (app?.sources)
    app.sources = app.sources.filter((entry: any) => entry !== BRIDGE_DIR)
  return next
}

/**
 * The app's entitlements without the two this adds.
 *
 * This is the one that matters. An entitlement left behind after the
 * capability is turned off is not cosmetic: a provisioning profile that does
 * not carry it fails to sign, so a stale key here breaks every device build
 * and archive while the config says the feature is off.
 */
export function withoutNetworkEntitlements(entitlements: Record<string, unknown>): Record<string, unknown> {
  const next = { ...entitlements }
  delete next['com.apple.developer.networking.networkextension']
  delete next['com.apple.security.application-groups']
  return next
}

/**
 * Read a plist as an object.
 *
 * Through `plutil` rather than an XML parser: a plist is a format with types,
 * and the one place a correct reader of it is guaranteed to exist is the
 * machine that is already running xcodebuild.
 */
export function readPlist(path: string): Record<string, unknown> {
  const converted = Bun.spawnSync(['plutil', '-convert', 'json', '-o', '-', path], { stdout: 'pipe', stderr: 'pipe' })
  if (converted.exitCode !== 0)
    throw new Error(`could not read ${path}: ${converted.stderr.toString().trim()}`)
  return JSON.parse(converted.stdout.toString())
}

/** Write an object as an XML plist, which is what Xcode expects to read. */
export function writePlist(path: string, value: Record<string, unknown>): void {
  const json = join(dirname(path), `.${TUNNEL_SUFFIX}.json`)
  writeFileSync(json, JSON.stringify(value))
  const converted = Bun.spawnSync(['plutil', '-convert', 'xml1', '-o', path, json], { stdout: 'pipe', stderr: 'pipe' })
  Bun.spawnSync(['rm', '-f', json])
  if (converted.exitCode !== 0)
    throw new Error(`could not write ${path}: ${converted.stderr.toString().trim()}`)
}

/**
 * Emit the extension into a generated `ios/` directory.
 *
 * Returns what it did, so the build can say so rather than leaving a second
 * target to be discovered in Xcode.
 */
export function emitTunnelExtension(output: string, plan: TunnelPlan): string[] {
  const done: string[] = []
  const tunnelDir = join(output, TUNNEL_SUFFIX)
  mkdirSync(tunnelDir, { recursive: true })

  /** Copy one tracked source into a generated directory. */
  function copyNative(name: string, into: string): void {
    const source = join(NATIVE_DIR, name)
    if (!existsSync(source))
      throw new Error(`the native source ${name} is missing at ${source}`)
    copyFileSync(source, join(into, name))
  }

  assertEveryNativeSourceIsClaimed()

  for (const file of [...TUNNEL_SOURCES, BRIDGING_HEADER]) {
    copyNative(file, tunnelDir)
    done.push(`${TUNNEL_SUFFIX}/${file}`)
  }

  /*
   * The core, built before the project is generated rather than alongside it.
   * xcodegen resolves the framework path when it writes the project, so a
   * framework that does not exist yet produces a project missing its only
   * dependency — and an extension that compiles and cannot encrypt anything.
   */
  const framework = buildCore()
  const installed = join(output, CORE_FRAMEWORK)
  rmSync(installed, { recursive: true, force: true })
  cpSync(framework, installed, { recursive: true })
  done.push(CORE_FRAMEWORK)

  // The app's half: the manager that asks iOS for a tunnel, and the one hook
  // there is to start it from.
  const bridgeDir = join(output, BRIDGE_DIR)
  mkdirSync(bridgeDir, { recursive: true })
  for (const file of BRIDGE_SOURCES) {
    copyNative(file, bridgeDir)
    done.push(`${BRIDGE_DIR}/${file}`)
  }

  writePlist(join(tunnelDir, 'Info.plist'), tunnelInfoPlist(plan))
  done.push(`${TUNNEL_SUFFIX}/Info.plist`)

  writePlist(join(tunnelDir, `${plan.tunnelTarget}.entitlements`), tunnelEntitlements(plan))
  done.push(`${TUNNEL_SUFFIX}/${plan.tunnelTarget}.entitlements`)

  const appEntitlements = join(output, 'Craft.entitlements')
  if (existsSync(appEntitlements)) {
    writePlist(appEntitlements, withNetworkEntitlements(readPlist(appEntitlements), plan))
    done.push('Craft.entitlements')
  }

  rewriteProject(output, project => withTunnelTarget(project, plan))
  done.push('project.yml')

  return done
}

/**
 * Take the extension back out of a generated `ios/`.
 *
 * Runs whenever the capability is off, not only when it has just been turned
 * off: there is no record of what the last build did, and doing this
 * unconditionally is cheaper than keeping one. Returns what it removed, so a
 * build that quietly undoes a previous one still says so.
 */
export function removeTunnelExtension(output: string, plan: TunnelPlan): string[] {
  const removed: string[] = []

  for (const directory of [TUNNEL_SUFFIX, BRIDGE_DIR, CORE_FRAMEWORK]) {
    const path = join(output, directory)
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true })
      removed.push(`${directory}${directory === CORE_FRAMEWORK ? '' : '/'}`)
    }
  }

  const appEntitlements = join(output, 'Craft.entitlements')
  if (existsSync(appEntitlements)) {
    const current = readPlist(appEntitlements)
    const stripped = withoutNetworkEntitlements(current)
    if (Object.keys(stripped).length !== Object.keys(current).length) {
      writePlist(appEntitlements, stripped)
      removed.push('Craft.entitlements')
    }
  }

  const projectPath = join(output, 'project.yml')
  if (existsSync(projectPath)) {
    const changed = rewriteProject(output, project => withoutTunnelTarget(project, plan))
    if (changed)
      removed.push('project.yml')
  }

  return removed
}

/** Apply a change to `project.yml`, reporting whether it changed anything. */
function rewriteProject(output: string, change: (project: any) => any): boolean {
  const projectPath = join(output, 'project.yml')
  const before = readFileSync(projectPath, 'utf8')
  const after = Bun.YAML.stringify(change(Bun.YAML.parse(before)), null, 2)
  if (after === before)
    return false
  writeFileSync(projectPath, after)
  return true
}

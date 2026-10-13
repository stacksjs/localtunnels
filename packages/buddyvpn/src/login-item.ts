/**
 * Starting BuddyVPN when the user logs in.
 *
 * A LaunchAgent in the user's own directory, which needs no privileges and no
 * entitlement — unlike the helper, nothing here runs as root. `SMAppService`
 * is the modern equivalent and wants a signed bundle, which this build does
 * not have.
 *
 * The plist launches the bundle through `open` rather than execing the binary
 * directly: a GUI app started outside a login session gets no connection to
 * the window server, and launchd would restart the corpse on a loop.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { exec, shellEscape } from './support/shell'

export const LOGIN_ITEM_LABEL = 'org.localtunnels.buddyvpn'

export function loginItemPath(): string {
  return path.join(os.homedir(), 'Library/LaunchAgents', `${LOGIN_ITEM_LABEL}.plist`)
}

/**
 * The .app this agent is running inside, or null when it is not in one.
 *
 * `execPath` is `BuddyVPN.app/Contents/MacOS/BuddyVPN`, so the bundle is two
 * directories up. Running from source there is no bundle to launch and the
 * setting has nothing to point at.
 */
export function bundlePath(): string | null {
  const macos = path.dirname(process.execPath)
  const contents = path.dirname(macos)
  const bundle = path.dirname(contents)
  return bundle.endsWith('.app') && fs.existsSync(bundle) ? bundle : null
}

export function loginItemPlist(bundle: string): string {
  // Written with the bundle path escaped for XML rather than for a shell:
  // this is a plist, and a path containing an ampersand would otherwise make
  // it unparseable rather than merely wrong.
  const xml = bundle
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LOGIN_ITEM_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>${xml}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`
}

export function loginItemEnabled(): boolean {
  return fs.existsSync(loginItemPath())
}

/** Install or remove the login item. Returns whether it is enabled after. */
export function setLoginItem(enabled: boolean): { ok: boolean, enabled: boolean, error?: string } {
  const target = loginItemPath()
  try {
    if (!enabled) {
      // Unloaded before removal, or launchd keeps the old definition until
      // the next login and the setting appears not to have taken.
      exec(`launchctl bootout gui/$(id -u)/${LOGIN_ITEM_LABEL}`, { timeout: 5000 })
      fs.rmSync(target, { force: true })
      return { ok: true, enabled: false }
    }

    const bundle = bundlePath()
    if (!bundle)
      return { ok: false, enabled: false, error: 'BuddyVPN is running from source, so there is no app to launch at login' }

    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, loginItemPlist(bundle), { mode: 0o644 })
    exec(`launchctl bootstrap gui/$(id -u) ${shellEscape(target)}`, { timeout: 5000 })
    return { ok: true, enabled: true }
  }
  catch (error) {
    return { ok: false, enabled: loginItemEnabled(), error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * What the shipped plist says this app wants.
 *
 * Craft writes a usage description for every protected API it knows how to
 * reach, and this app enables three capabilities: haptics, secure storage,
 * deep links. The generated `Info.plist` arrived declaring eleven — camera,
 * contacts, calendar, photos, microphone, speech, motion, Bluetooth, Apple
 * Music, location and Face ID.
 *
 * That is invisible from every direction a bug is normally found from. No
 * prompt appears, because a usage description is read when its API is called
 * and this app calls none of them. Nothing crashes. The build succeeds. It
 * surfaces at App Review, in the privacy labels, and when somebody dumps a
 * VPN's plist and posts it — which is a thing that happens to VPNs, and the
 * reason this is worth a test rather than a one-time edit.
 *
 * The real generated file is read where there is one, so this measures what
 * would actually ship rather than a fixture agreeing with itself.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JUSTIFIED, unjustifiedUsageDescriptions, withoutUnusedUsageDescriptions } from '../scripts/ios-privacy'
import { readPlist } from '../scripts/ios-tunnel-extension'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GENERATED = join(PACKAGE_DIR, 'ios', 'Info.plist')

/** Everything Craft was observed to write, so this holds with no `ios/`. */
const AS_CRAFT_WRITES_IT: Record<string, unknown> = {
  CFBundleIdentifier: 'org.localtunnels.buddyvpn',
  CFBundleURLTypes: [{ CFBundleURLSchemes: ['buddyvpn'] }],
  NSAppleMusicUsageDescription: 'BuddyVPN asks for your music only in a feature that needs it.',
  NSBluetoothAlwaysUsageDescription: 'x',
  NSCalendarsUsageDescription: 'x',
  NSCameraUsageDescription: 'x',
  NSContactsUsageDescription: 'x',
  NSFaceIDUsageDescription: 'x',
  NSLocationWhenInUseUsageDescription: 'x',
  NSMicrophoneUsageDescription: 'x',
  NSMotionUsageDescription: 'x',
  NSPhotoLibraryUsageDescription: 'x',
  NSSpeechRecognitionUsageDescription: 'x',
}

describe('pruning', () => {
  it('takes out every description nothing here justifies', () => {
    expect(unjustifiedUsageDescriptions(AS_CRAFT_WRITES_IT)).toEqual([
      'NSAppleMusicUsageDescription',
      'NSBluetoothAlwaysUsageDescription',
      'NSCalendarsUsageDescription',
      'NSCameraUsageDescription',
      'NSContactsUsageDescription',
      'NSLocationWhenInUseUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSMotionUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSSpeechRecognitionUsageDescription',
    ])
  })

  /*
   * Kept out of caution, not knowledge: saving a VPN profile raises the
   * system's add-configuration alert and then Face ID, which should need
   * nothing from this app — and is the one flow the whole app is built
   * around, cannot be run in this repository, and has no device to try it
   * on. A wrong guess there traps in the app's central action.
   */
  it('keeps the one it cannot yet rule out', () => {
    expect(JUSTIFIED).toEqual(['NSFaceIDUsageDescription'])
    expect(withoutUnusedUsageDescriptions(AS_CRAFT_WRITES_IT)).toHaveProperty('NSFaceIDUsageDescription')
  })

  // Everything that is not a usage description is none of this step's business.
  it('touches nothing else', () => {
    const pruned = withoutUnusedUsageDescriptions(AS_CRAFT_WRITES_IT)
    expect(pruned.CFBundleIdentifier).toBe('org.localtunnels.buddyvpn')
    expect(pruned.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: ['buddyvpn'] }])
  })

  // Craft rewrites `Info.plist` on an `init`, so this runs again over a file
  // it has already pruned.
  it('is idempotent', () => {
    const once = withoutUnusedUsageDescriptions(AS_CRAFT_WRITES_IT)
    expect(withoutUnusedUsageDescriptions(once)).toEqual(once)
    expect(unjustifiedUsageDescriptions(once)).toEqual([])
  })

  /*
   * A keep-list, not a pattern. Removing everything matching
   * `NS*UsageDescription` would take a future justified entry with it, and
   * the entry is where the reason for keeping one is written down.
   */
  it('removes by name rather than by shape', () => {
    const invented = { NSSomethingWeActuallyUseUsageDescription: 'x' }
    expect(unjustifiedUsageDescriptions(invented)).toEqual(['NSSomethingWeActuallyUseUsageDescription'])
    expect(unjustifiedUsageDescriptions({ NSFaceIDUsageDescription: 'x' })).toEqual([])
  })
})

/*
 * Against the file that would ship, when one has been generated.
 *
 * `ios/` is build output and is not in a clean checkout, so this is skipped
 * rather than failed there — but where it exists it is the only assertion
 * here that is about reality instead of about a fixture.
 */
describe('the generated plist', () => {
  const built = existsSync(GENERATED)

  it.skipIf(!built)('still registers the scheme the pairing link uses', () => {
    const plist = readPlist(GENERATED)
    // Not this step's doing, and the thing most worth noticing if it broke:
    // without it iOS does not offer to open the app and QR pairing is dead.
    expect(JSON.stringify(plist.CFBundleURLTypes)).toContain('buddyvpn')
  })

  it.skipIf(!built)('asks for nothing this app has no feature for', () => {
    const plist = readPlist(GENERATED)
    const left = unjustifiedUsageDescriptions(plist)
    /*
     * Fails before `bun run build:ios` has run since this landed, which is
     * correct: the file on disk is what would ship, and a stale one asking
     * for the camera is the finding, not a false alarm.
     */
    expect({ left, hint: 'run bun run build:ios' }).toEqual({ left: [], hint: 'run bun run build:ios' })
  })

  /*
   * The decision this contradicted. PROVISIONING.md says there is no
   * scanner in this app and no camera permission, because iOS reads the
   * pairing code and hands over a URL — and the plist asked for the camera
   * anyway. Named on its own because it is the one a reader would check.
   */
  it.skipIf(!built)('does not ask for the camera it says it does not need', () => {
    expect(readPlist(GENERATED)).not.toHaveProperty('NSCameraUsageDescription')
  })
})

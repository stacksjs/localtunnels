/**
 * The app icon, which the app shipped without.
 *
 * `AppIcon.appiconset` held an empty `images` array, so BuddyVPN installed
 * as a blank grey square on the home screen. Craft can place an icon, but
 * only from `init` — which this build runs once and skips ever after — so
 * the fix had to be its own step, and a step is a thing that can be tested.
 *
 * The rules checked here are App Store Connect's, and both are refusals at
 * upload. The alpha one especially: an icon with transparency looks right
 * in Xcode, in the simulator and on a device, and is rejected only when
 * somebody tries to submit the build.
 */

import { Buffer } from 'node:buffer'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'
import {
  ICON_FILENAME,
  ICON_SIZE,
  iconCatalog,
  iconRefusal,
  installAppIcon,
  pngShape,
} from '../scripts/ios-app-icon'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ICON = join(PACKAGE_DIR, 'assets', 'app-icon.png')

/** A PNG header and nothing else, which is all `pngShape` reads. */
function header(width: number, height: number, colourType: number): Buffer {
  const bytes = Buffer.alloc(26)
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes[24] = 8
  bytes[25] = colourType
  return bytes
}

describe('the committed app icon', () => {
  it('is in the repository, so a build needs no Xcode to have one', () => {
    expect(existsSync(ICON)).toBe(true)
  })

  /*
   * Drawn by `scripts/app-icon.swift`, which paints the background edge to
   * edge precisely so this holds. If somebody replaces the file by hand,
   * this is where that is caught.
   */
  it('is the size iOS asks for, with nothing transparent in it', () => {
    expect(iconRefusal(pngShape(readFileSync(ICON)))).toBeNull()
    expect(pngShape(readFileSync(ICON))).toEqual({
      width: ICON_SIZE,
      height: ICON_SIZE,
      hasAlpha: false,
    })
  })
})

describe('an icon that could not be shipped', () => {
  it('is refused for carrying transparency', () => {
    expect(iconRefusal(pngShape(header(1024, 1024, 6)))).toContain('alpha')
    // Greyscale-with-alpha is the other transparent colour type, and the
    // one a hand-exported mark is likelier to be than RGBA.
    expect(iconRefusal(pngShape(header(1024, 1024, 4)))).toContain('alpha')
  })

  it('is refused for being the wrong size', () => {
    expect(iconRefusal(pngShape(header(512, 512, 2)))).toContain('512×512')
  })

  /*
   * A JPEG renamed `.png` passes Xcode and the catalog and fails at upload,
   * so the signature is worth reading rather than the extension.
   */
  it('is refused for not being a PNG at all', () => {
    expect(iconRefusal(pngShape(Buffer.from('JFIF, honestly')))).toContain('not a PNG')
  })

  it('stops the build rather than warning it', () => {
    const output = mkdtempSync(join(tmpdir(), 'buddyvpn-icon-'))
    const wrong = join(output, 'wrong.png')
    writeFileSync(wrong, header(1024, 1024, 6))
    expect(() => installAppIcon(output, wrong)).toThrow(/alpha/)
  })
})

describe('installing the icon', () => {
  it('puts the icon and a catalog that names it into the project', () => {
    const output = mkdtempSync(join(tmpdir(), 'buddyvpn-icon-'))
    const appIcon = installAppIcon(output, ICON)

    expect(readFileSync(join(appIcon, ICON_FILENAME))).toEqual(readFileSync(ICON))
    const catalog = JSON.parse(readFileSync(join(appIcon, 'Contents.json'), 'utf8'))
    expect(catalog.images).toHaveLength(1)
    expect(catalog.images[0].filename).toBe(ICON_FILENAME)
    expect(catalog.images[0].size).toBe(`${ICON_SIZE}x${ICON_SIZE}`)
  })

  /*
   * An empty `images` array is what shipped, and it is valid JSON that
   * Xcode accepts without complaint. The catalog has to name a file.
   */
  it('never writes the empty catalog the app shipped with', () => {
    expect(JSON.parse(iconCatalog()).images).not.toEqual([])
  })
})

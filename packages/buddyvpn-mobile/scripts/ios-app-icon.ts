/**
 * The home screen icon, put into the generated project.
 *
 * Craft takes an `appIconPath` and would do this itself — but only from
 * `init`, which this build runs once and skips ever after so a rebuild does
 * not discard Xcode's own metadata. So the icon landed on a fresh checkout
 * and on no later build, which is the worst of the two: it would have been
 * there the day it was added and gone the next time anybody regenerated.
 *
 * Done here instead, after `build`, alongside the other edits this package
 * makes to a project Craft owns.
 */

import { Buffer } from 'node:buffer'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** What Xcode calls the single icon a modern asset catalog holds. */
export const ICON_FILENAME = 'AppIcon-1024.png'

/** The one size iOS asks for; Xcode derives the rest. */
export const ICON_SIZE = 1024

export interface IconShape {
  width: number
  height: number
  /** PNG colour type 6 and 4 carry an alpha channel; 2 and 0 do not. */
  hasAlpha: boolean
}

/**
 * A PNG's dimensions and whether it carries transparency, read from the
 * header rather than by decoding it.
 *
 * IHDR is the first chunk and fixed in layout: an 8-byte signature, then a
 * 4-byte length and the type, then width and height as big-endian 32-bit
 * integers, bit depth, and colour type. Everything needed is in the first
 * 26 bytes.
 *
 * Returns null for anything that is not a PNG, which is the answer for a
 * JPEG renamed `.png` — a file Xcode accepts into the catalog and App Store
 * Connect then refuses.
 */
export function pngShape(bytes: Buffer): IconShape | null {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  if (bytes.length < 26 || !bytes.subarray(0, 8).equals(SIGNATURE))
    return null
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR')
    return null
  const colourType = bytes[25]
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: colourType === 4 || colourType === 6,
  }
}

/**
 * Why this icon cannot be shipped, or null if it can.
 *
 * Both rules are App Store Connect's and both are refusals at upload rather
 * than warnings at build, which is the expensive end to find them at. The
 * alpha one is the trap: an icon with transparency looks perfect everywhere
 * — Xcode, the simulator, a device — and is rejected only when the build is
 * submitted.
 */
export function iconRefusal(shape: IconShape | null): string | null {
  if (!shape)
    return 'the app icon is not a PNG'
  if (shape.width !== ICON_SIZE || shape.height !== ICON_SIZE)
    return `the app icon is ${shape.width}×${shape.height}, and iOS wants ${ICON_SIZE}×${ICON_SIZE}`
  if (shape.hasAlpha)
    return 'the app icon has an alpha channel, which App Store Connect refuses'
  return null
}

/** The catalog entry pointing at the icon, as Xcode writes it. */
export function iconCatalog(filename: string = ICON_FILENAME): string {
  return `${JSON.stringify({
    images: [{ filename, idiom: 'universal', platform: 'ios', size: `${ICON_SIZE}x${ICON_SIZE}` }],
    info: { author: 'xcode', version: 1 },
  }, null, 2)}\n`
}

/**
 * Copy the icon into the generated project's asset catalog.
 *
 * Throws rather than warning when the icon would be refused: a build that
 * says "could not" and carries on produces an app that installs, runs, and
 * cannot be submitted, and nobody reads that line until the day it matters.
 */
export function installAppIcon(output: string, source: string): string {
  const refusal = iconRefusal(pngShape(readFileSync(source)))
  if (refusal)
    throw new Error(`${refusal}: ${source}`)

  const appIcon = join(output, 'Assets.xcassets', 'AppIcon.appiconset')
  mkdirSync(appIcon, { recursive: true })
  copyFileSync(source, join(appIcon, ICON_FILENAME))
  writeFileSync(join(appIcon, 'Contents.json'), iconCatalog())
  return appIcon
}

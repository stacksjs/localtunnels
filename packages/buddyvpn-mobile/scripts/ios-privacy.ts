/**
 * What the shipped app says it wants, against what it actually asks for.
 *
 * Craft writes a usage description for every protected API it knows how to
 * reach, whether or not this app enables the capability behind it. The
 * generated `Info.plist` therefore arrives declaring eleven of them —
 * camera, contacts, calendar, photos, microphone, speech, motion, Bluetooth,
 * Apple Music, location — for an app whose enabled capabilities are haptics,
 * secure storage and deep links.
 *
 * None of that is a crash or a prompt. A usage description is only consulted
 * when the API behind it is called, and this app calls none of them, so
 * nothing about it shows up in testing. It shows up in the two places that
 * are hard to walk back.
 *
 * **Review and the privacy labels.** A declared string is what Apple's own
 * tooling and a reviewer read as the app's intent, cross-checked against the
 * App Privacy answers. Eleven strings for three capabilities is a question
 * to answer at the worst moment to be answering it.
 *
 * **Trust.** This is a VPN. Its plist will be dumped and posted, because
 * that is what people do with VPN apps, and
 * `NSCameraUsageDescription = "BuddyVPN asks for the camera only in a
 * feature that needs it"` is not defensible when there is no such feature.
 * It also contradicts a decision this project made on purpose and wrote
 * down: PROVISIONING.md says there is no scanner in this app and no camera
 * permission, because iOS reads the pairing code and hands over a URL. The
 * plist asked for the camera anyway.
 *
 * ── What removing one costs ────────────────────────────────────────────
 *
 * A protected API called without its usage description does not degrade, it
 * traps. That is the right trade here and close to the point: an app
 * carrying no camera string cannot quietly start using the camera, because
 * the attempt dies in testing instead of becoming a prompt a user sees in
 * the wild. A string is a standing permission to add a feature nobody
 * decided on.
 *
 * It is also why this prunes a named list rather than everything matching a
 * pattern. See `JUSTIFIED`.
 */

/**
 * The usage descriptions this app keeps, and why each one survives.
 *
 * `NSFaceIDUsageDescription` is the only entry, and it is here out of
 * caution rather than knowledge. Saving a VPN profile raises the system's
 * "Would Like to Add VPN Configurations" alert followed by Face ID, Touch ID
 * or the passcode. That is the system authenticating its own user and should
 * need nothing from this app — but it is also the single flow the whole app
 * is built around, it cannot be run anywhere in this repository, and nobody
 * has a device with the entitlement yet. A wrong guess costs a trap in the
 * app's central action, discovered by the first person ever to tap the
 * button. One honest-sounding line in a plist is the cheaper mistake.
 *
 * Anything added here should carry the same kind of sentence: which call
 * needs it, and how that was established.
 */
export const JUSTIFIED: readonly string[] = [
  'NSFaceIDUsageDescription',
]

/** Whether a key is a usage description at all. */
function isUsageDescription(key: string): boolean {
  return /^NS[A-Za-z]*UsageDescription$/.test(key)
}

/**
 * The usage descriptions in `plist` that nothing here justifies.
 *
 * Separated from the removal so the build can say what it took out: a step
 * that silently edits a generated file is one nobody can audit from a log.
 */
export function unjustifiedUsageDescriptions(plist: Record<string, unknown>): string[] {
  return Object.keys(plist)
    .filter(key => isUsageDescription(key) && !JUSTIFIED.includes(key))
    .sort()
}

/**
 * The plist with those keys gone.
 *
 * A copy rather than a mutation, and idempotent: Craft rewrites `Info.plist`
 * on an `init`, so this runs again over a file it has already pruned and has
 * to be a no-op the second time.
 */
export function withoutUnusedUsageDescriptions(plist: Record<string, unknown>): Record<string, unknown> {
  const next = { ...plist }
  for (const key of unjustifiedUsageDescriptions(plist))
    delete next[key]
  return next
}

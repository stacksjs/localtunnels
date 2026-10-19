/**
 * Handing a network to a phone.
 *
 * This machine has `servers.json`, written by `bun run deploy:vpn`, which
 * holds each region's coordinator and the secret to join it. A phone has no
 * way to be given that file, and the values cannot be built into the app —
 * `authKey` is shared by every member, so a copy in a shipped binary belongs
 * to anyone who downloads it.
 *
 * So the window shows them, once, as a link the phone's own camera can read:
 *
 *     buddyvpn://pair?v=1&c=wss%3A%2F%2Fvpn.example%3A51821&k=<secret>&r=us-west
 *
 * The phone registers that scheme, so iOS recognises it and offers to open
 * the app. Nothing scans anything here, and the app only ever sees a URL it
 * was launched with.
 *
 * Keep in step with `packages/buddyvpn-mobile/src/pairing.ts`, which parses
 * exactly this and refuses anything else. A field renamed on one side is a
 * link the other side silently declines.
 *
 * ── What this is, plainly ──────────────────────────────────────────────
 *
 * A shared secret on a screen. Anyone who photographs it joins the network
 * and can advertise themselves as an exit, a claim the coordinator relays
 * without checking. That is no worse than this file on a laptop and no
 * better; the window says as much where it shows the code, and the real
 * answer is per-device credentials the coordinator can revoke, which it has
 * no notion of today.
 */
/**
 * What this needs from a server entry, named here rather than imported.
 *
 * `ServerEntry` lives in `vpn/control.ts`, which reaches for `node:os`, the
 * shell and the privileged helper. Importing the type drags the module graph
 * behind it into anything that wants to check this format — including the
 * phone app's own tests, which have no business compiling a helper installer.
 * Structurally identical, and the test that matters feeds a real entry
 * through it.
 */
export interface PairableServer {
  coordinatorUrl: string
  authKey?: string
}

/** The format version, carried so an older phone can refuse a newer link. */
export const PAIR_VERSION = '1'

/**
 * Build the link for one region, or null when there is nothing to hand over.
 *
 * A region with no server deployed has no coordinator, and a code that
 * cannot be acted on is worse than no code: it is scanned, accepted, and
 * fails at the first connection with nothing to point at.
 */
export function pairingUrl(regionId: string, entry: PairableServer | undefined): string | null {
  if (!entry?.coordinatorUrl)
    return null
  const query = new URLSearchParams({
    v: PAIR_VERSION,
    c: entry.coordinatorUrl,
    r: regionId,
  })
  if (entry.authKey)
    query.set('k', entry.authKey)
  return `buddyvpn://pair?${query.toString()}`
}

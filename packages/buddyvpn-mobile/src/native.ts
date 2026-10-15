/**
 * The Craft bridge, and what to do when there is not one.
 *
 * Every screen here has to render in three places: a desktop browser while it
 * is being built, an iOS Simulator, and a phone. Only the last two have a
 * native host, so nothing may depend on one existing — a screen that throws
 * without the bridge is a screen nobody can look at while writing it.
 *
 * Craft installs its bridge *after* the document starts. Asking at setup is
 * therefore the wrong moment and reliably answers "no" on a real phone, which
 * is how native-only chrome ends up never applying. {@link whenNativeHost}
 * resolves once the answer is actually knowable.
 */

interface CraftBridge {
  haptics?: { impact?: (style: string) => void, selection?: () => void }
  window?: { startDrag?: () => void }
  navigation?: {
    push?: (screen: string, params?: Record<string, unknown>) => void
    back?: () => void
    onAppear?: (callback: () => void) => () => void
    setOptions?: (options: Record<string, unknown>) => void
  }
}

declare global {
  interface Window {
    craft?: CraftBridge
  }
}

/** The parts of the host's bar these screens set. The host takes more. */
export interface NavigationOptions {
  /** What the bar says. Set it, or the bar says the screen's filename. */
  title?: string
  /** A large title that collapses into the bar as the screen scrolls. */
  largeTitle?: boolean
  /** What the *next* screen's back button says. Defaults to this title. */
  backTitle?: string
  /** No bar at all. */
  hidden?: boolean
}

/** How long to wait for Craft to install itself before concluding it will not. */
const BRIDGE_TIMEOUT_MS = 1500

let resolved: Promise<boolean> | null = null

/**
 * Whether this is running inside a native host, answered once it is knowable.
 *
 * Memoised: every component asks, and the answer cannot change within a
 * session — a page does not become native halfway through.
 */
export function whenNativeHost(): Promise<boolean> {
  if (resolved)
    return resolved

  resolved = new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined')
      return resolve(false)
    if (window.craft)
      return resolve(true)

    // Poll rather than wait on an event: Craft publishes no "ready" signal we
    // can rely on across versions, and a missed event is indistinguishable
    // from a browser.
    const started = Date.now()
    const tick = (): void => {
      if (window.craft)
        return resolve(true)
      if (Date.now() - started > BRIDGE_TIMEOUT_MS)
        return resolve(false)
      setTimeout(tick, 50)
    }
    tick()
  })
  return resolved
}

/** True only once {@link whenNativeHost} has said so. Cheap, and may be stale. */
export function isNativeHost(): boolean {
  return typeof window !== 'undefined' && Boolean(window.craft)
}

/**
 * Physical feedback for the two moments that deserve it.
 *
 * Silent off a phone rather than throwing, so a screen can ask
 * unconditionally. Feedback is a garnish; a connect button that fails because
 * a browser has no taptic engine is not.
 */
export const haptics = {
  /** Picking a location, or any other change of selection. */
  selection(): void {
    try {
      window.craft?.haptics?.selection?.()
    }
    catch {
      // Feedback is never worth an exception.
    }
  },
  /** Connecting and disconnecting — the two state changes worth feeling. */
  impact(style: 'light' | 'medium' | 'heavy' = 'medium'): void {
    try {
      window.craft?.haptics?.impact?.(style)
    }
    catch {
      // As above.
    }
  },
}

/**
 * Moving between screens.
 *
 * A native screen is not a page, and a link is not how you leave one. Each
 * screen in the bundle is its own route that the host pushes onto a stack, so
 * `<a href>` and `history.back()` reach nothing — the location row rendered
 * perfectly and did nothing at all when tapped, because there was no
 * navigator listening for a link.
 *
 * `push` takes the *route name* the bundle knows, which is the screen's
 * filename without its extension, not a URL path. The host rejects a name it
 * has no screen for, so a typo here is an error at the tap rather than a
 * blank screen.
 *
 * Falls back to the browser's own history so the screens stay walkable while
 * being written, where there is no host to push anything.
 */
export const navigation = {
  /** Open another screen, keeping this one beneath it. */
  push(screen: string): void {
    try {
      const native = window.craft?.navigation?.push
      if (native)
        return native.call(window.craft!.navigation, screen)
      window.location.assign(`/${screen}`)
    }
    catch {
      // A screen that cannot be opened should not take the current one down.
    }
  },
  /**
   * Run something each time this screen comes back to the front.
   *
   * A pushed screen does not replace the one beneath it — that screen stays
   * mounted, so its setup does not run again when the stack pops back to it.
   * Anything it read once at mount is stale from then on, which is how
   * picking a different location changed nothing: the choice was saved, and
   * the screen showing it had already read the old value.
   *
   * Returns an unsubscribe. Off a native host there is no stack and nothing
   * to hear, so it is a no-op that still returns one, letting a caller
   * dispose unconditionally.
   */
  onAppear(callback: () => void): () => void {
    try {
      const native = window.craft?.navigation?.onAppear
      if (native)
        return native.call(window.craft!.navigation, callback) ?? (() => {})
    }
    catch {
      // A screen that cannot hear the event still has to render.
    }
    return () => {}
  },
  /**
   * Describe this screen's navigation bar.
   *
   * Without this the bar is titled with the route name, which is a filename:
   * the picker's bar read `locations`, lowercase, above a screen that drew
   * its own heading underneath. The bar is the title on iOS — a large one
   * that collapses into the bar as the screen scrolls — so a heading in the
   * content is a second title, not a substitute for setting this one.
   *
   * Every key is optional and only the keys given change. Silent off a host,
   * where there is no bar to describe.
   */
  setOptions(options: NavigationOptions): void {
    try {
      const native = window.craft?.navigation?.setOptions
      if (native)
        native.call(window.craft!.navigation, options as Record<string, unknown>)
    }
    catch {
      // A bar that cannot be titled is not worth losing the screen over.
    }
  },
  /** Return to the screen underneath. */
  back(): void {
    try {
      const native = window.craft?.navigation?.back
      if (native)
        return native.call(window.craft!.navigation)
      window.history.back()
    }
    catch {
      // As above.
    }
  },
}

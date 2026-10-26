/**
 * Types for `tray.js`.
 *
 * The module is plain JavaScript because it is served to the window as-is —
 * the agent hands `web/` to the page without a build step, so a `.ts` file
 * there would need compiling and there is nothing to compile it. The tests
 * import it directly, though, and `tsc` will not take an untyped module, so
 * the shapes live here instead.
 */

/** A location, as `app.js` publishes it: the agent's region plus whether a server exists. */
export interface TrayRegion {
  id: string
  country: string
  configured?: boolean
}

/** What the window last drew, which is all the menu bar renders from. */
export interface TrayView {
  connected?: boolean
  /** '' | 'connecting' | 'disconnecting' — the window's, not the agent's. */
  phase?: string
  /** Connected, and the coordinator has stopped hearing from us. */
  forgotten?: boolean
  regionId?: string | null
  regions?: TrayRegion[]
}

/** An `NSMenu` item, in the shape the native bridge parses. */
export interface TrayMenuItem {
  label?: string
  /** Native routes a click by this, not by `id`; an item without one is dead. */
  action?: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  enabled?: boolean
  shortcut?: string
  submenu?: TrayMenuItem[]
}

export function traySymbol(view: TrayView): string
export function trayStatusLine(view: TrayView): string
export function trayTooltip(view: TrayView): string
export function trayMenu(view: TrayView): TrayMenuItem[]

/** Attach a no-op handler to a bridge call, so a rejection is not unhandled. */
export function quietly(result: unknown): void

/** Claim regular activation and key status — see craft-native/craft#419. */
export function claimWindow(craft: any): boolean

/** Wire the tray to the window's events. Returns a teardown. */
export function startTray(craft: any, target: EventTarget): () => void

/** Wait for Craft's bridge, then start. Returns whether it started now. */
export function bootstrapTray(
  win: any,
  schedule?: (fn: () => void) => void,
  attempts?: number,
): boolean

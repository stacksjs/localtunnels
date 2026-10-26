/**
 * The menu bar item.
 *
 * A VPN is the kind of thing you check far more often than you change, and
 * until now checking meant finding the window. The useful answer — am I
 * covered, and where do I look like I am — is one glance at the menu bar in
 * every other VPN, so it is one glance here.
 *
 * Only the top line of that answer is the icon. The menu under it carries the
 * two things worth doing without opening anything: turn it off, and move to
 * another location.
 *
 * ── Why this is its own module ─────────────────────────────────────────
 *
 * `app.js` owns the window. Nothing in here touches the DOM, and nothing in
 * `app.js` knows a tray exists: they pass `buddyvpn:status` one way and
 * `buddyvpn:tray` the other. That keeps the menu honest — it renders the
 * status the window already has, rather than polling for a second copy that
 * could disagree with what is on screen — and it keeps the parts that decide
 * what the menu says testable without a webview.
 *
 * ── What the runtime gives us ──────────────────────────────────────────
 *
 * `window.craft.tray` is the injected bridge, not the npm SDK, and the two
 * differ in one way that matters: the SDK fills in `action` from `id`, and
 * the bridge does not. Native routes a click by `action` alone, so an item
 * without one renders fine and is dead on click. Every item below sets it.
 *
 * `show` and `quit` are handled natively and never come back to this page.
 * Everything else arrives through one callback carrying the action string.
 */

/** Connected, and the coordinator still hears from us. */
const CONNECTED = 'lock.shield.fill'
/** Nothing routed. An outline, so the filled state reads as the loud one. */
const IDLE = 'shield'
/** Mid-handshake, in either direction. */
const WORKING = 'shield.lefthalf.filled'
/**
 * Connected, and the coordinator has stopped hearing from us.
 *
 * Its own glyph rather than the connected one, because this is the state the
 * window exists to surface: traffic is still going somewhere, and the route
 * home is gone. A menu bar that said "connected" here would be the single
 * most misleading thing in the app.
 */
const STALLED = 'exclamationmark.shield.fill'

/**
 * What the icon says.
 *
 * Order matters. A connection that is being torn down is working, not
 * connected, and a stalled one is neither — so the transitional and the
 * broken states are both asked about before the happy one.
 */
export function traySymbol(view) {
  if (view.phase === 'connecting' || view.phase === 'disconnecting')
    return WORKING
  if (view.forgotten)
    return STALLED
  return view.connected ? CONNECTED : IDLE
}

/** The region's display name, or null when nothing is chosen. */
function placeName(view) {
  const region = (view.regions || []).find(entry => entry.id === view.regionId)
  return region ? region.country : null
}

/**
 * The line at the top of the menu, and the tooltip.
 *
 * Shares one function because they answer the same question and disagreeing
 * about it would be a bug. The tooltip is what hovering says; the menu item
 * is what opening says.
 */
export function trayStatusLine(view) {
  if (view.phase === 'connecting')
    return 'Connecting…'
  if (view.phase === 'disconnecting')
    return 'Disconnecting…'

  const place = placeName(view)
  if (view.forgotten)
    return place ? `Unreachable — ${place}` : 'Unreachable'
  if (view.connected)
    return place ? `Connected — ${place}` : 'Connected'
  return 'Not connected'
}

export function trayTooltip(view) {
  return `BuddyVPN · ${trayStatusLine(view)}`
}

/**
 * The menu.
 *
 * The first item is the status, disabled — it is a label, not a thing to
 * click, and AppKit greys it accordingly. Disabling it is also what stops it
 * being the item the keyboard lands on first.
 */
export function trayMenu(view) {
  const regions = view.regions || []
  const current = regions.find(entry => entry.id === view.regionId)
  const busy = view.phase === 'connecting' || view.phase === 'disconnecting'

  return [
    { label: trayStatusLine(view), action: 'status', enabled: false },
    { type: 'separator' },
    {
      label: view.connected ? 'Disconnect' : 'Connect',
      action: 'toggle',
      /*
       * Off mid-handshake, and off for a location with no server behind it.
       * Both are states the window already refuses, and a menu that offered
       * what the window greys out would be the easier of the two to reach.
       */
      enabled: !busy && (view.connected || Boolean(current && current.configured)),
    },
    {
      label: 'Location',
      action: 'location',
      submenu: regions.map(entry => ({
        label: entry.country,
        action: `region:${entry.id}`,
        type: 'radio',
        checked: entry.id === view.regionId,
        /*
         * A location with nothing deployed stays listed and unselectable.
         * Hiding it would make a half-configured install look like a smaller
         * product rather than an unfinished one.
         */
        enabled: Boolean(entry.configured) && !busy,
      })),
    },
    { type: 'separator' },
    // Handled natively; neither reaches this page.
    { label: 'Open BuddyVPN', action: 'show' },
    { label: 'Quit BuddyVPN', action: 'quit', shortcut: 'Cmd+Q' },
  ]
}

/**
 * Hand the menu to the runtime, and route what comes back.
 *
 * `craft` is passed in rather than read off `window` so a test can drive this
 * with a recording stand-in. Returns a teardown, which matters less here than
 * it would in a page that navigates — this one never does — but costs a line.
 */
/** Attach a no-op handler to a bridge call, so a rejection is not unhandled. */
export function quietly(result) {
  if (result && typeof result.catch === 'function')
    result.catch(() => {})
}

export function startTray(craft, target) {
  const tray = craft && craft.tray
  if (!tray)
    return () => {}

  let last = ''

  const render = (view) => {
    /*
     * Rebuilt only when something it shows has changed.
     *
     * The window repaints on a five-second poll and on every interaction,
     * and each `setMenu` destroys and rebuilds the NSMenu — which, done
     * while the menu is open, closes it under whoever opened it.
     */
    const signature = JSON.stringify([traySymbol(view), trayMenu(view)])
    if (signature === last)
      return
    last = signature

    /*
     * The runtime creates the item with the app's name as text, which is
     * how it is visible before this page says otherwise. Cleared, because a
     * word in the menu bar costs the width of a word forever and says
     * nothing the icon does not: every other VPN there is a glyph.
     */
    /*
     * Every one of these is a promise, and a runtime with no status item
     * rejects all of them. That is a normal state — the flag that creates
     * the item is off while craft-native/craft#420 is open — and a page
     * that logged four unhandled rejections a second would be the louder
     * bug of the two.
     */
    quietly(tray.setTitle && tray.setTitle(''))
    quietly(tray.setIcon(traySymbol(view)))
    quietly(tray.setTooltip(trayTooltip(view)))
    quietly(tray.setMenu(trayMenu(view)))
  }

  const onStatus = event => render(event.detail || {})
  target.addEventListener('buddyvpn:status', onStatus)

  const stopActions = tray.onMenuAction((detail) => {
    const action = detail && detail.action
    if (!action)
      return
    target.dispatchEvent(new CustomEvent('buddyvpn:tray', { detail: { action } }))
  })

  /*
   * A left click opens the window rather than the menu: AppKit gives the
   * menu to the right button already, and a left click that did the same
   * would leave no way to reach the window from the bar at all.
   */
  const stopClicks = tray.onClick(() => {
    if (craft.window && craft.window.show)
      craft.window.show()
  })

  return () => {
    target.removeEventListener('buddyvpn:status', onStatus)
    if (stopActions)
      stopActions()
    if (stopClicks)
      stopClicks()
  }
}

/**
 * Give the window back its left mouse button.
 *
 * `--system-tray` costs the app its activation, and the cost is not obvious
 * from the flag's name. Craft activates a windowed app like this:
 *
 *     if (self.system_tray == null and !self.headless) {
 *         macos.showAllWindows();
 *         macos.activateWindowedApp();
 *     } else if (self.headless) { ... }
 *
 * With a tray, neither branch runs — so `activateWindowedApp` is never
 * called, and that is the function which both sets the activation policy to
 * Regular and brings the app to the front. The app therefore cannot become
 * active, the window cannot become key, and macOS spends every left click
 * activating a window that never activates. Right-clicks still work, because
 * a context menu does not need a key window: which is exactly how this
 * presented — a window that looked fine, drew fine, and ignored the button.
 *
 * `showDockIcon` is the policy half and `focus` is the ordering half. Both
 * are page-reachable, so this is fixable here rather than by pinning a
 * different runtime.
 *
 * Worth deleting when Craft activates a tray app itself. Harmless until
 * then: an app the person just launched claiming the foreground is what any
 * other app does.
 */
export function claimWindow(craft) {
  try {
    if (craft.app && craft.app.showDockIcon)
      craft.app.showDockIcon()
    if (craft.window && craft.window.focus)
      craft.window.focus()
    return true
  }
  catch {
    /* An older runtime missing either half is still a working window; it is
     * only this flag's window that needs the help. */
    return false
  }
}

/**
 * Wait for the bridge, then start.
 *
 * Craft installs `window.craft` after the page begins running, and this file
 * is a module — which is deferred, but not deferred until *that*. Checking
 * once and giving up is the failure that looks exactly like success: the
 * runtime creates the status item either way, so the bar shows a default
 * "BuddyVPN" title, nothing throws, and the icon simply never becomes a
 * shield and the menu never appears.
 *
 * So it is asked for repeatedly, briefly. `schedule` is a parameter so a
 * test can run the retries without waiting through them.
 */
export function bootstrapTray(win, schedule, attempts) {
  let left = attempts === undefined ? 60 : attempts
  const again = schedule || (fn => setTimeout(fn, 50))

  const attempt = () => {
    if (win && win.craft && win.craft.tray) {
      claimWindow(win.craft)
      startTray(win.craft, win)
      return true
    }
    if (left-- > 0) {
      again(attempt)
      return false
    }
    /*
     * Out of patience, and that is a normal outcome rather than an error:
     * a page opened in a browser for development has no bridge and never
     * will. The window is the whole app there, exactly as it was before any
     * of this existed.
     */
    return false
  }

  return attempt()
}

/* Importing this in a test starts nothing: there is no `window` there. */
if (typeof window !== 'undefined')
  bootstrapTray(window)

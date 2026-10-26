/**
 * The menu bar item.
 *
 * What is worth testing here is not that a menu renders — it is what the
 * menu *claims*. The icon and its top line are the only part of this app
 * most people will look at on most days, so a state they describe wrongly is
 * a state nobody finds out about.
 *
 * Two of these guard mistakes the window already made once and had fixed:
 * a stall reported as a healthy connection, and a control offered for a
 * location with no server behind it.
 */

import { describe, expect, it } from 'bun:test'
import { bootstrapTray, quietly, startTray, trayMenu, trayStatusLine, traySymbol, trayTooltip } from '../web/tray.js'

const REGIONS = [
  { id: 'us-west', country: 'United States', configured: true },
  { id: 'eu-central', country: 'Germany', configured: false },
]

/** A view in the shape `app.js` publishes, with the differences spelled out. */
function view(over: Record<string, unknown> = {}) {
  return { connected: false, phase: '', forgotten: false, regionId: 'us-west', regions: REGIONS, ...over }
}

/** Every item in the menu, submenus flattened in. */
function items(menu: any[]): any[] {
  return menu.flatMap(item => (item.submenu ? [item, ...item.submenu] : [item]))
}

function labelled(menu: any[], label: string): any {
  return items(menu).find(item => item.label === label)
}

describe('what the icon says', () => {
  it('is filled while connected and an outline while not', () => {
    expect(traySymbol(view({ connected: true }))).toBe('lock.shield.fill')
    expect(traySymbol(view())).toBe('shield')
  })

  /*
   * Both directions, because a disconnect is a handshake too — and an icon
   * that went straight to the outline would say "off" while the routes and
   * the kill switch were still up.
   */
  it('shows a handshake in progress rather than the state it is leaving', () => {
    expect(traySymbol(view({ connected: false, phase: 'connecting' }))).toBe('shield.lefthalf.filled')
    expect(traySymbol(view({ connected: true, phase: 'disconnecting' }))).toBe('shield.lefthalf.filled')
  })

  /*
   * The state this whole mechanism exists for. The tunnel is up, traffic is
   * going somewhere, and the coordinator has stopped hearing from us — so
   * `connected` is true and saying so would be the most misleading thing the
   * app could put on screen.
   */
  it('does not report a stalled tunnel as a healthy one', () => {
    const stalled = view({ connected: true, forgotten: true })
    expect(traySymbol(stalled)).toBe('exclamationmark.shield.fill')
    expect(traySymbol(stalled)).not.toBe(traySymbol(view({ connected: true })))
    expect(trayStatusLine(stalled)).not.toContain('Connected')
    expect(trayStatusLine(stalled)).toContain('Unreachable')
  })
})

describe('what the menu says', () => {
  it('names the place it has put you', () => {
    expect(trayStatusLine(view({ connected: true }))).toBe('Connected — United States')
    expect(trayStatusLine(view())).toBe('Not connected')
    expect(trayTooltip(view({ connected: true }))).toBe('BuddyVPN · Connected — United States')
  })

  /*
   * Native routes a menu click by `action` and gives an item without one no
   * target at all, so it renders, greys nothing, and does nothing when
   * clicked. The injected bridge — unlike the npm SDK — does not fill it in
   * from `id`, which makes this the easiest way to ship a dead menu.
   */
  it('gives every clickable item an action to route by', () => {
    for (const item of items(trayMenu(view()))) {
      if (item.type === 'separator')
        continue
      expect(item.action).toBeString()
      expect(item.action.length).toBeGreaterThan(0)
    }
  })

  it('offers the opposite of what is happening', () => {
    expect(labelled(trayMenu(view()), 'Connect')).toBeTruthy()
    expect(labelled(trayMenu(view({ connected: true })), 'Disconnect')).toBeTruthy()
  })

  // The status line is a label. Enabled, it is also the item the keyboard
  // lands on first, and clicking it would route an action meaning nothing.
  it('does not offer the status line as something to click', () => {
    expect(trayMenu(view())[0].enabled).toBe(false)
  })

  describe('a location with no server behind it', () => {
    it('is listed, and cannot be chosen', () => {
      const germany = labelled(trayMenu(view()), 'Germany')
      expect(germany).toBeTruthy()
      expect(germany.enabled).toBe(false)
    })

    it('cannot be connected to from the bar either', () => {
      // The window disables its button for exactly this. A menu that did not
      // would be the easier of the two to reach.
      expect(labelled(trayMenu(view({ regionId: 'eu-central' })), 'Connect').enabled).toBe(false)
    })
  })

  /*
   * Asked separately from the one above: disconnecting is always allowed.
   * Tying it to whether the *current* region is configured would strand
   * somebody connected to a location they had since un-deployed.
   */
  it('always lets a running tunnel be stopped', () => {
    const odd = view({ connected: true, regionId: 'eu-central' })
    expect(labelled(trayMenu(odd), 'Disconnect').enabled).toBe(true)
  })

  it('offers nothing to press mid-handshake', () => {
    const busy = trayMenu(view({ phase: 'connecting' }))
    expect(labelled(busy, 'Connect').enabled).toBe(false)
    expect(labelled(busy, 'United States').enabled).toBe(false)
  })

  it('checks the location it is set to, and no other', () => {
    const checked = items(trayMenu(view())).filter(item => item.checked)
    expect(checked.map(item => item.label)).toEqual(['United States'])
  })
})

describe('driving the runtime', () => {
  function stub() {
    const calls: { icons: string[], menus: unknown[], titles: string[] } = { icons: [], menus: [], titles: [] }
    let onAction: ((detail: unknown) => void) | null = null
    const craft = {
      tray: {
        setTitle: (title: string) => calls.titles.push(title),
        setIcon: (icon: string) => calls.icons.push(icon),
        setTooltip: () => {},
        setMenu: (menu: unknown) => calls.menus.push(menu),
        onMenuAction: (cb: (detail: unknown) => void) => { onAction = cb; return () => {} },
        onClick: () => () => {},
      },
      window: { show: () => {} },
    }
    return { craft, calls, fire: (detail: unknown) => onAction?.(detail) }
  }

  /*
   * `setMenu` destroys the NSMenu and builds a new one. The window repaints
   * every five seconds whether anything changed or not, and rebuilding the
   * menu while somebody has it open closes it under them — so a repaint that
   * changes nothing has to reach the runtime as nothing.
   */
  it('leaves the menu alone when a repaint changed nothing', () => {
    const { craft, calls } = stub()
    const target = new EventTarget()
    startTray(craft, target)

    const same = { detail: view() }
    target.dispatchEvent(new CustomEvent('buddyvpn:status', same))
    target.dispatchEvent(new CustomEvent('buddyvpn:status', same))
    expect(calls.menus).toHaveLength(1)

    target.dispatchEvent(new CustomEvent('buddyvpn:status', { detail: view({ connected: true }) }))
    expect(calls.menus).toHaveLength(2)
  })

  /*
   * The status item is created carrying the app's name as text. Left alone
   * it stays there beside the icon, costing the width of a word in a strip
   * where every other VPN is a glyph and nothing else.
   */
  it('clears the text the runtime names the item with', () => {
    const { craft, calls } = stub()
    const target = new EventTarget()
    startTray(craft, target)
    target.dispatchEvent(new CustomEvent('buddyvpn:status', { detail: view() }))
    expect(calls.titles).toEqual([''])
  })

  it('passes a menu action on as something the window can act on', () => {
    const { craft, fire } = stub()
    const target = new EventTarget()
    startTray(craft, target)

    const seen: string[] = []
    target.addEventListener('buddyvpn:tray', (event: any) => seen.push(event.detail.action))

    fire({ action: 'toggle' })
    fire({ action: 'region:eu-central' })
    // Native handles these two and they never reach the page; an empty one
    // is what the bridge sends if a click arrives with no action attached.
    fire({ action: '' })
    fire(null)

    expect(seen).toEqual(['toggle', 'region:eu-central'])
  })

  // A runtime too old for a tray is not an error. The window is still the
  // whole app, exactly as it was before this existed.
  it('does nothing at all on a runtime with no tray', () => {
    expect(() => startTray({}, new EventTarget())()).not.toThrow()
  })
})

/*
 * The bridge is not there when this module runs.
 *
 * Craft installs `window.craft` after the page starts, and a module script is
 * deferred but not that far. The original version checked once — which fails
 * in the one way worth guarding against, because the runtime creates the
 * status item regardless: the bar would show a default "BuddyVPN" title,
 * nothing would throw, and the icon would simply never become a shield.
 */
describe('waiting for the bridge', () => {
  function bridge() {
    return { tray: { setIcon() {}, setTooltip() {}, setMenu() {}, onMenuAction: () => () => {}, onClick: () => () => {} } }
  }

  it('starts immediately when the bridge is already there', () => {
    const win = Object.assign(new EventTarget(), { craft: bridge() })
    expect(bootstrapTray(win, () => {}, 0)).toBe(true)
  })

  it('keeps asking until the bridge arrives', () => {
    const win: any = Object.assign(new EventTarget(), { craft: undefined })
    const queue: (() => void)[] = []

    expect(bootstrapTray(win, (fn: () => void) => queue.push(fn), 10)).toBe(false)

    // Three turns with nothing, then the runtime installs it.
    queue.shift()!()
    queue.shift()!()
    win.craft = bridge()
    queue.shift()!()

    // Started: it stopped rescheduling.
    expect(queue).toHaveLength(0)
  })

  // A page opened in a browser for development never gets a bridge. Giving
  // up quietly is the right outcome there, not an error in the console.
  it('gives up quietly when one never arrives', () => {
    const queue: (() => void)[] = []
    const win = Object.assign(new EventTarget(), { craft: undefined })
    bootstrapTray(win, (fn: () => void) => queue.push(fn), 2)
    while (queue.length) queue.shift()!()
    expect(queue).toHaveLength(0)
  })
})

/*
 * The flag that creates the status item is off while
 * craft-native/craft#420 is open, so `window.craft.tray` exists with
 * nothing behind it and every call on it rejects. The window repaints
 * every five seconds, so the failure to avoid is not a dead tray — that
 * is expected — but a page printing four unhandled rejections a second
 * underneath it.
 *
 * Asserted on the handler being attached rather than on the process
 * reporting an unhandled rejection: bun does not surface one here, so a
 * test written that way passes just as happily with the catch removed.
 * This one was, and did.
 */
describe('a tray the runtime never created', () => {
  it('attaches a handler to a bridge call that rejects', () => {
    let handled = false
    const promise: any = { catch(fn: () => void) { handled = true; return fn } }
    quietly(promise)
    expect(handled).toBe(true)
  })

  it('accepts a bridge call that returns nothing at all', () => {
    expect(() => quietly(undefined)).not.toThrow()
    expect(() => quietly(null)).not.toThrow()
  })

  it('renders against a wholly rejecting tray without throwing', () => {
    const reject = () => Promise.reject(new Error('no tray handle'))
    const craft = {
      tray: { setTitle: reject, setIcon: reject, setTooltip: reject, setMenu: reject, onMenuAction: () => () => {}, onClick: () => () => {} },
      window: { show: () => {} },
    }
    const target = new EventTarget()
    startTray(craft, target)
    expect(() => target.dispatchEvent(new CustomEvent('buddyvpn:status', { detail: view() }))).not.toThrow()
  })
})

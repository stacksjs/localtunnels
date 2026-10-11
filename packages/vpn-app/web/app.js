/*
 * The window's behaviour.
 *
 * Plain DOM, no framework: one screen with four controls does not need a
 * render loop, and a dependency here would be shipped inside the app bundle
 * forever. The markup in `index.html` is the structure; nothing below builds
 * elements except the picker's rows.
 *
 * The agent owns the truth. This polls `/api/status` and paints what comes
 * back, holding one piece of state of its own — the transient `connecting` /
 * `disconnecting` phase, which lives between a click and the next status and
 * has nowhere else to be.
 */
(() => {
  const POLL_MS = 5000

  const el = {
    statusLabel: document.querySelector('[data-status-label]'),
    clock: document.querySelector('[data-clock]'),
    power: document.querySelector('[data-power]'),
    caption: document.querySelector('[data-caption]'),
    location: document.querySelector('[data-location]'),
    badge: document.querySelector('[data-badge]'),
    country: document.querySelector('[data-country]'),
    city: document.querySelector('[data-city]'),
    picker: document.querySelector('[data-picker]'),
    foot: document.querySelector('[data-foot]'),
  }

  /** Last payload from the agent. Null until the first answer arrives. */
  let status = null
  /** '' | 'connecting' | 'disconnecting' — ours, not the agent's. */
  let phase = ''
  let region = null
  let picking = false
  let error = ''
  /** When this window first saw the connection. */
  let connectedSince = null

  const regions = () => (status && status.regions) || []
  const connected = () => Boolean(status && status.managedPid)
  const coreReady = () => Boolean(status && status.core && status.core.available && status.core.healthy)
  const current = () => regions().find(entry => entry.id === region) || regions()[0] || null

  const remember = (key, value) => {
    try {
      if (value === null) return localStorage.getItem(key)
      localStorage.setItem(key, value)
    }
    catch {
      // A private window or cleared site data. The default is a correct
      // answer, and the app works without remembering anything.
    }
    return null
  }

  /** Why the button cannot be pressed, or '' when it can. */
  const blocker = () => {
    if (!status) return 'Checking this Mac…'
    if (!status.supported) return 'This build only brings up tunnels on macOS.'
    if (!coreReady()) return (status.core && status.core.detail) || 'The native VPN core is not healthy.'

    const here = current()
    if (!here) return 'No locations are configured.'
    if (!here.configured) return `No server for ${here.country} yet. Deploy one: bun run deploy:vpn --region ${here.id}`
    return ''
  }

  const clockText = () => {
    if (!connected() || connectedSince === null) return ''
    const total = Math.max(0, Math.floor((Date.now() - connectedSince) / 1000))
    const pad = n => String(n).padStart(2, '0')
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  }

  // Switching while connected would mean a disconnect and a fresh handshake,
  // which is two authorization prompts. Pick the location, then connect.
  const choose = (id) => {
    region = id
    picking = false
    remember('ltvpn.region', id)
    paint()
  }

  const row = (entry) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pick'

    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = entry.badge

    const text = document.createElement('span')
    text.className = 'location-text'
    const name = document.createElement('span')
    name.className = 'location-name'
    name.textContent = entry.country
    const city = document.createElement('span')
    city.className = 'location-city'
    city.textContent = entry.city
    text.append(name, city)

    button.append(badge, text)

    if (!entry.configured) {
      const note = document.createElement('span')
      note.className = 'pick-note'
      note.textContent = 'no server'
      button.append(note)
    }
    else if (entry.id === region) {
      const check = document.createElement('span')
      check.className = 'pick-check'
      check.textContent = '✓'
      button.append(check)
    }

    button.addEventListener('click', () => choose(entry.id))
    return button
  }

  const paintPicker = () => {
    el.picker.hidden = !picking
    el.location.setAttribute('aria-expanded', picking ? 'true' : 'false')
    if (!picking) return

    el.picker.textContent = ''
    for (const entry of regions()) el.picker.append(row(entry))
  }

  const paint = () => {
    const here = current()
    const why = blocker()

    let label = 'Not connected'
    let tone = ''
    if (error) { label = 'Something went wrong'; tone = 'error' }
    else if (phase === 'connecting') { label = 'Connecting…'; tone = 'busy' }
    else if (phase === 'disconnecting') { label = 'Disconnecting…'; tone = 'busy' }
    else if (connected()) { label = 'Connected'; tone = 'on' }
    else if (!status) { label = 'Checking…' }

    el.statusLabel.textContent = label
    if (tone) el.statusLabel.setAttribute('data-tone', tone)
    else el.statusLabel.removeAttribute('data-tone')

    el.clock.textContent = clockText()

    el.power.setAttribute('data-state', phase || (connected() ? 'on' : (status ? 'off' : 'unknown')))
    el.power.disabled = Boolean(phase) || (!connected() && Boolean(why))
    el.power.setAttribute('aria-label', connected() ? 'Disconnect' : 'Connect')

    if (error) el.caption.textContent = error
    else if (phase) el.caption.textContent = 'Waiting for authorization…'
    else if (connected()) el.caption.textContent = here ? `Your traffic leaves from ${here.city}` : ''
    else if (why) el.caption.textContent = ''
    else el.caption.textContent = here ? `Tap to connect to ${here.country}` : ''

    el.badge.textContent = here ? here.badge : '--'
    el.country.textContent = here ? here.country : '—'
    el.city.textContent = here ? here.city : ''
    el.foot.textContent = why && !connected() ? why : ''

    paintPicker()
  }

  const post = (url, payload) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
    .then(response => response.json().catch(() => null))
    .then(data => data || { success: false, error: 'The agent gave no answer' })
    .catch(e => ({ success: false, error: e.message || 'network error' }))

  const refresh = force => post('/api/status', { refresh: force === true }).then((data) => {
    if (!data || data.success !== true) {
      error = (data && data.error) || 'Could not read VPN status'
      paint()
      return
    }

    error = ''
    const wasConnected = connected()
    status = data

    if (region === null)
      region = remember('ltvpn.region', null) || data.defaultRegion || (data.regions[0] && data.regions[0].id) || null

    // The agent does not record when a tunnel started, so the clock counts
    // from when this window first saw it. A window opened onto a tunnel that
    // was already up therefore times from the open — the honest answer to a
    // question nothing on this Mac can answer exactly.
    if (connected() && !wasConnected) connectedSince = Date.now()
    if (!connected()) connectedSince = null

    paint()
  })

  const toggle = () => {
    if (phase) return
    const goingUp = !connected()
    phase = goingUp ? 'connecting' : 'disconnecting'
    error = ''
    paint()

    post(goingUp ? '/api/connect' : '/api/disconnect', goingUp ? { region } : {}).then((result) => {
      phase = ''
      // A cancelled prompt is an answer, not a failure: the person said no.
      if (!result.success && result.error !== 'Cancelled')
        error = result.error || 'Could not change the connection'
      return refresh(false)
    })
  }

  el.power.addEventListener('click', toggle)
  el.location.addEventListener('click', () => { picking = !picking; paint() })

  /*
   * Moving a window with no titlebar. WebKit never implemented
   * `-webkit-app-region: drag` — a WKWebView discards the declaration — so
   * the press is handed to AppKit, which runs a real window drag loop.
   */
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element) || !target.closest('[data-window-drag]')) return
    if (window.craft?.window?.startDrag) window.craft.window.startDrag()
  })

  setInterval(() => {
    if (connected() && connectedSince !== null) el.clock.textContent = clockText()
  }, 1000)

  paint()
  refresh(false)
  setInterval(() => { if (!phase) refresh(false) }, POLL_MS)
})()

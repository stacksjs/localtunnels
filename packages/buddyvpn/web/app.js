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

  /**
   * Demo mode.
   *
   * With it on, a location that has no server still works the button: the
   * window walks off -> connecting -> on, runs its clock, and comes back
   * down, without a tunnel existing anywhere. That is the point — the app can
   * be clicked through and judged before a single server has been paid for.
   *
   * It only ever applies to a location with no server behind it. The moment
   * one is configured, that location takes the real path and this flag stops
   * mattering for it, so there is no mode where a real connection is faked.
   *
   * Off now that a real server exists and this is used in earnest. A location
   * without one is disabled and says so, rather than offering a button that
   * walks through a connection it is not making. The labelling was honest —
   * caption and foot both said demo — but "appears to connect" is the wrong
   * risk to carry on a tool someone relies on, and a mis-tapped location is an
   * easy mistake.
   *
   * Set back to `true` to click through the UI without a server.
   */
  const DEMO = false

  /** How long the fake handshake takes, in milliseconds. */
  const DEMO_CONNECT_MS = 1200
  const DEMO_DISCONNECT_MS = 600

  const el = {
    statusLabel: document.querySelector('[data-status-label]'),
    clock: document.querySelector('[data-clock]'),
    power: document.querySelector('[data-power]'),
    caption: document.querySelector('[data-caption]'),
    location: document.querySelector('[data-location]'),
    kicker: document.querySelector('[data-kicker]'),
    badge: document.querySelector('[data-badge]'),
    country: document.querySelector('[data-country]'),
    city: document.querySelector('[data-city]'),
    picker: document.querySelector('[data-picker]'),
    foot: document.querySelector('[data-foot]'),
    egress: document.querySelector('[data-egress]'),
    egressKicker: document.querySelector('[data-egress-kicker]'),
    egressWhere: document.querySelector('[data-egress-where]'),
    egressIp: document.querySelector('[data-egress-ip]'),
    settings: document.querySelector('[data-settings]'),
    settingsOpen: document.querySelector('[data-settings-open]'),
    settingsClose: document.querySelector('[data-settings-close]'),
    setRegion: document.querySelector('[data-set-region]'),
    setAutoconnect: document.querySelector('[data-set-autoconnect]'),
    setLogin: document.querySelector('[data-set-login]'),
    setDns: document.querySelector('[data-set-dns]'),
    setLan: document.querySelector('[data-set-lan]'),
    setShowLocation: document.querySelector('[data-set-showlocation]'),
    about: document.querySelector('[data-about]'),
    helperRemove: document.querySelector('[data-helper-remove]'),
    helperNote: document.querySelector('[data-helper-note]'),
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
  /** Demo mode's own connection, which exists only in this window. */
  let demoConnected = false
  /** Last answer from /api/location, or null while unknown. */
  let egress = null
  /** Last answer from /api/settings. */
  let config = null
  /** Guards the one automatic connect, so a reconnect never triggers it. */
  let autoConnectDone = false

  const regions = () => (status && status.regions) || []
  const realConnected = () => Boolean(status && status.managedPid)
  const connected = () => realConnected() || demoConnected
  /** True when the chosen location has no server and the demo stands in. */
  const demoing = () => DEMO && Boolean(status) && Boolean(current()) && !current().configured
  /**
   * What to say while connecting.
   *
   * "Waiting for authorization" under a dialog that is never going to appear
   * is how a privileged helper working perfectly looks exactly like one that
   * has hung — which is what it looked like.
   */
  const captionForPhase = () => {
    if (demoing()) return 'Pretending to ask for authorization…'
    if (status && status.needsPassword === false) return 'Starting the tunnel…'
    return 'Waiting for authorization…'
  }
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

  /**
   * Why the button cannot be pressed.
   *
   * Two forms, because they go in two places: `short` sits under the button
   * where a sentence would wrap into the location card, and `detail` is the
   * actionable version at the foot. Returning only the long one left the
   * caption empty, which read as a window that had failed to finish loading.
   */
  const blocker = () => {
    if (!status) return { short: 'Checking…', detail: 'Reading this Mac’s VPN state…' }
    if (!status.supported)
      return { short: 'Not supported here', detail: 'This build only brings up tunnels on macOS.' }
    if (!coreReady()) {
      return {
        short: 'The VPN core needs attention',
        detail: (status.core && status.core.detail) || 'The native VPN core is not healthy.',
      }
    }

    const here = current()
    if (!here) return { short: 'No locations', detail: 'No locations are configured.' }
    if (!here.configured && !DEMO) {
      return {
        short: `No server in ${here.country} yet`,
        detail: `Deploy one: bun run deploy:vpn --region ${here.id}`,
      }
    }
    return null
  }

  const clockText = () => {
    if (!connected() || connectedSince === null) return ''
    // Same arithmetic either way; only the origin differs — the demo sets it
    // when the button was pressed, the real one from the tunnel's own age.
    const total = Math.max(0, Math.floor((Date.now() - connectedSince) / 1000))
    const pad = n => String(n).padStart(2, '0')
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  }

  // Switching while connected would mean a disconnect and a fresh handshake,
  // which is two authorization prompts. Pick the location, then connect.
  const choose = (id) => {
    region = id
    picking = false
    remember('buddyvpn.region', id)
    // A real switch is a disconnect and a fresh handshake, so the demo drops
    // its connection too rather than appearing to teleport.
    if (demoConnected) {
      demoConnected = false
      connectedSince = null
    }
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
    const blocked = Boolean(why) && !connected()

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
    el.power.disabled = Boolean(phase) || blocked
    el.power.setAttribute('aria-label', connected() ? 'Disconnect' : 'Connect')

    if (error) el.caption.textContent = error
    else if (phase) el.caption.textContent = captionForPhase()
    else if (demoConnected) el.caption.textContent = 'Demo — no tunnel was created'
    else if (connected()) el.caption.textContent = here ? `Your traffic leaves from ${here.city}` : ''
    else if (blocked) el.caption.textContent = why.short
    else el.caption.textContent = here ? `Tap to connect to ${here.country}` : ''

    el.badge.textContent = here ? here.badge : '--'
    el.country.textContent = here ? here.country : '—'
    el.city.textContent = here ? here.city : ''

    /*
     * The location is fixed while the tunnel is up. Changing it is a
     * disconnect and a fresh handshake — two authorization prompts and a
     * window that lies about where it is in between — so the control says so
     * instead of offering a choice it would have to take back.
     */
    const locked = connected() || Boolean(phase)
    el.location.disabled = locked
    el.kicker.textContent = locked ? 'Location · disconnect to change' : 'Location'
    if (locked && picking) picking = false

    // The demo never stops saying it is one. A window that looks connected
    // and is not is the one thing this app must not do.
    if (blocked) el.foot.textContent = why.detail
    else if (demoing() && here) el.foot.textContent = `Demo. Nothing is routed. Deploy a server: bun run deploy:vpn --region ${here.id}`
    else el.foot.textContent = ''

    paintPicker()
    paintEgress()
    /*
     * The settings panel is repainted from here rather than only when it
     * opens. Its location list comes from the agent, and settings are loaded
     * before the first status arrives — so the list was built from an empty
     * array and the dropdown stayed blank until the panel was closed and
     * reopened. Painting it with everything else means it cannot be left
     * describing a state that has since moved on.
     */
    if (!el.settings.hidden) paintSettings()
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
      region = remember('buddyvpn.region', null) || data.defaultRegion || (data.regions[0] && data.regions[0].id) || null

    // The real clock is anchored to the tunnel's own age, which the agent
    // reads from the kernel — a window counting from when it first noticed
    // would restart the clock every time the app was reopened and show a
    // two-hour tunnel as thirty seconds old.
    //
    // The demo's clock is its own, and a poll must not reset it: the agent
    // correctly reports no tunnel while the demo says it is connected, and
    // those two are not in conflict.
    if (demoConnected) {
      // Left alone.
    }
    else if (realConnected()) {
      const age = typeof data.uptimeSeconds === 'number' ? data.uptimeSeconds : 0
      if (!wasConnected || connectedSince === null) connectedSince = Date.now() - age * 1000
    }
    else {
      connectedSince = null
    }

    paint()

    /*
     * The route out has changed, so the address the world sees has too.
     * Asked here rather than on every poll because that is the only moment
     * the answer can differ, and each ask is a request to a third party.
     */
    if (wasConnected !== connected())
      refreshEgress()

    maybeAutoConnect()
  })

/**
 * Connect once, if that is what was asked for.
 *
 * Guarded by a flag rather than by "are we disconnected": without it, this
 * would reconnect every time the tunnel dropped, which turns a setting about
 * launching into a reconnect policy nobody asked for.
 */
  function maybeAutoConnect() {
    if (autoConnectDone || !config || !config.settings.autoConnect) return
    autoConnectDone = true
    if (connected() || phase || !coreReady()) return
    const here = current()
    if (here && here.configured) toggle()
  }

  /**
   * The demo's transitions, on a timer instead of a round trip.
   *
   * Deliberately the same shape as the real path — a pending phase, then a
   * settled one — because the real connect is an API call that waits on a
   * password dialog, and a demo that resolved instantly would be a different
   * screen from the one being judged.
   */
  const demoToggle = (goingUp) => {
    phase = goingUp ? 'connecting' : 'disconnecting'
    error = ''
    paint()

    setTimeout(() => {
      phase = ''
      demoConnected = goingUp
      connectedSince = goingUp ? Date.now() : null
      paint()
    }, goingUp ? DEMO_CONNECT_MS : DEMO_DISCONNECT_MS)
  }

  const toggle = () => {
    if (phase) return
    const goingUp = !connected()

    // A location with no server has nothing to ask, so it never posts.
    if (demoing()) {
      demoToggle(goingUp)
      return
    }

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

  /* ── What the internet sees ─────────────────────────────────────────── */

  /**
   * Ask the agent where this machine appears to be, and paint it.
   *
   * Called when the window opens and after the connection changes, not on
   * the status poll: it costs a request to a third party, and the answer can
   * only differ when the route out has.
   */
  function refreshEgress() {
    return post('/api/location').then((data) => {
      egress = (data && data.success === true) ? (data.location || null) : null
      paintEgress()
    })
  }

  function paintEgress() {
    if (!egress) {
      el.egress.hidden = true
      return
    }
    el.egress.hidden = false
    // Connected, this is the exit and the words should say so; disconnected,
    // it is where the user actually is. Same row, because it answers the same
    // question either way: where does my traffic come from?
    const on = connected()
    el.egressKicker.textContent = on ? 'Traffic leaves from' : 'Your location'
    el.egress.dataset.tone = on ? 'on' : 'off'
    const where = [egress.city, egress.country].filter(Boolean).join(', ')
    el.egressWhere.textContent = where || 'Unknown location'
    el.egressIp.textContent = egress.ip
  }

  /* ── Settings ───────────────────────────────────────────────────────── */

  function loadSettings() {
    return post('/api/settings').then((data) => {
      if (!data || data.success !== true) return
      config = data
      paintSettings()
    })
  }

  function paintSettings() {
    if (!config) return
    const s = config.settings

    // Locations come from the agent so this list cannot drift from the one
    // on the main screen.
    if (el.setRegion.options.length !== regions().length) {
      el.setRegion.innerHTML = ''
      for (const r of regions()) {
        const option = document.createElement('option')
        option.value = r.id
        option.textContent = r.country
        el.setRegion.append(option)
      }
    }
    el.setRegion.value = s.defaultRegion

    if (el.setDns.options.length !== (config.dnsChoices || []).length) {
      el.setDns.innerHTML = ''
      for (const choice of config.dnsChoices || []) {
        const option = document.createElement('option')
        option.value = choice.id
        option.textContent = choice.label
        el.setDns.append(option)
      }
    }
    el.setDns.value = s.dns

    el.setAutoconnect.checked = s.autoConnect
    el.setLogin.checked = s.launchAtLogin
    el.setLan.checked = s.allowLan
    el.setShowLocation.checked = s.showLocation

    // A location cannot be changed while connected, and neither can the
    // settings that only take effect when a tunnel is built.
    const live = connected()
    el.setLan.disabled = live
    el.setDns.disabled = live

    el.about.innerHTML = ''
    const facts = [
      ['App', config.versions && config.versions.app],
      ['Core', config.versions && config.versions.cli],
      ['Your key', status && status.identity && status.identity.publicKey],
      ['Helper', config.helperPresent
        ? (config.helperReady ? 'installed' : 'installed, updates on next connect')
        : 'not installed'],
      ['Log', config.logPath],
    ]
    for (const [name, value] of facts) {
      if (!value) continue
      const dt = document.createElement('dt')
      dt.textContent = name
      const dd = document.createElement('dd')
      dd.textContent = value
      el.about.append(dt, dd)
    }

    el.helperRemove.hidden = !config.helperPresent
    el.helperNote.textContent = config.helperPresent
      ? 'Removing it means every connect asks for your password again.'
      : 'Installed the first time you connect, so connecting stops asking for your password.'
  }

  function save(patch) {
    return post('/api/settings/update', patch).then((data) => {
      if (data && data.success === true) config = data
      paintSettings()
      // Turning the location off should clear what is already on screen,
      // rather than leaving the last answer visible under a setting that
      // says it is not being asked for.
      return refreshEgress()
    })
  }

  function openSettings() {
    el.settings.hidden = false
    // Painted before the fetch, not after it. Opening on an empty panel and
    // filling it a round trip later shows a blank dropdown for long enough
    // to read as broken, and everything needed is already in hand from the
    // last time.
    paintSettings()
    loadSettings()
  }

  function closeSettings() {
    el.settings.hidden = true
  }

  el.settingsOpen.addEventListener('click', openSettings)
  el.settingsClose.addEventListener('click', closeSettings)
  el.setRegion.addEventListener('change', () => save({ defaultRegion: el.setRegion.value }))
  el.setDns.addEventListener('change', () => save({ dns: el.setDns.value }))
  el.setAutoconnect.addEventListener('change', () => save({ autoConnect: el.setAutoconnect.checked }))
  el.setLogin.addEventListener('change', () => save({ launchAtLogin: el.setLogin.checked }))
  el.setLan.addEventListener('change', () => save({ allowLan: el.setLan.checked }))
  el.setShowLocation.addEventListener('change', () => save({ showLocation: el.setShowLocation.checked }))

  el.helperRemove.addEventListener('click', () => {
    post('/api/helper/uninstall').then((data) => {
      if (data && data.success === true) config = data
      paintSettings()
    })
  })

  /*
   * The standard macOS shortcut. The application menu has a Settings item
   * that this app never wired to anything, so pressing it does nothing and
   * the shortcut is the only thing a Mac user will try next.
   */
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault()
      el.settings.hidden ? openSettings() : closeSettings()
      return
    }
    if (event.key === 'Escape' && !el.settings.hidden) closeSettings()
  })

  el.power.addEventListener('click', toggle)
  el.location.addEventListener('click', () => {
    if (el.location.disabled) return
    picking = !picking
    paint()
  })

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
  // Settings first: the stored default location is what the window should
  // open on, and auto-connect cannot be decided before it is known.
  loadSettings()
    .then(() => {
      if (region === null && config) region = config.settings.defaultRegion
      return refresh(false)
    })
    .then(refreshEgress)
  setInterval(() => { if (!phase) refresh(false) }, POLL_MS)
})()

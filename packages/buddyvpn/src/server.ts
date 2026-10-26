/**
 * The agent: a Bun server on loopback that the window talks to.
 *
 * The window is a web view, so everything it needs about this Mac has to
 * arrive over HTTP. That server is this file. It binds 127.0.0.1 on a port the
 * OS picks, serves the window's static payload, and answers four endpoints.
 *
 * Bound to loopback, never to an interface: the API brings up a VPN and can
 * raise an authorization prompt, and neither belongs on the network. A VPN app
 * listening on 0.0.0.0 would be a particularly poor joke.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import { DEFAULT_REGION, REGIONS } from './regions'
import { renderSVG } from 'uqr'
import { pairingUrl } from './pairing'
import { connect, connectionPid, connectionUptime, coordinatorHealth, disconnect, readServers } from './vpn/control'
import { version } from '../package.json'
import { DNS_LABELS } from './dns'
import { loginItemEnabled, setLoginItem } from './login-item'
import { readSettings, writeSettings } from './settings'
import { readCore, readIdentity, readTunnels } from './vpn/core'
import { lookupLocation } from './vpn/geo'
import { helperLogPath, helperPresent, helperReady, uninstallHelper } from './vpn/helper'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

function webRoot(): string {
  // In the bundle this is `Contents/Resources/web`, passed by the launcher. In
  // a source run it is the package's own `web/`.
  return process.env.BUDDYVPN_WEB_ROOT || path.join(import.meta.dir, '../web')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/**
 * Everything the window paints, in one response.
 *
 * One call rather than four, because the window shows a single coherent
 * picture — a core that is healthy, a location that has a server, a tunnel
 * that is up — and four calls would let it paint three quarters of a state
 * that never existed.
 */
/** Settings plus the state of the two things that are not stored in the file. */
function settingsPayload(): Record<string, unknown> {
  const settings = readSettings()
  return {
    success: true,
    // Read from disk rather than trusted from the file: the login item is a
    // plist somebody can remove in System Settings, and the stored flag would
    // then describe something that is no longer true.
    settings: { ...settings, launchAtLogin: loginItemEnabled() },
    dnsChoices: Object.entries(DNS_LABELS).map(([id, label]) => ({ id, label })),
    // Present and current are different questions; a helper from an older
    // build is installed but not usable, and saying "not installed" hid the
    // only control that removes it.
    helperPresent: helperPresent(),
    helperReady: helperReady(),
    logPath: helperLogPath(),
    versions: { app: version, cli: readCore(false).version },
  }
}

function updateSettings(patch: Record<string, unknown>): Record<string, unknown> {
  // The login item is an action, not a value, so it is applied before the
  // file is written and its real outcome is what gets stored.
  let loginError: string | undefined
  if (typeof patch.launchAtLogin === 'boolean') {
    const applied = setLoginItem(patch.launchAtLogin)
    patch.launchAtLogin = applied.enabled
    loginError = applied.error
  }
  writeSettings(patch as Parameters<typeof writeSettings>[0])
  // A changed resolver or LAN rule only takes effect on the next connect;
  // the window says so rather than implying a live change.
  return { ...settingsPayload(), error: loginError }
}

/**
 * The pairing code for one region, as a link and as something to point a
 * camera at.
 *
 * The SVG is rendered here rather than in the window because the window has
 * no encoder and should not grow one: this is the process that already holds
 * the secret, and handing it a drawing rather than the values keeps the
 * number of places that can leak it at one.
 */
function pairingFor(regionId: string): Record<string, unknown> {
  const entry = readServers()[regionId]
  const url = pairingUrl(regionId, entry)
  if (!url) {
    // A region with nothing deployed has no coordinator, so there is nothing
    // to hand over. Saying so beats a code that is scanned and then fails.
    return { success: false, error: 'No server is deployed in that location yet' }
  }
  return { success: true, region: regionId, url, svg: renderSVG(url, { border: 1 }) }
}

function status(refresh: boolean): Response {
  const core = readCore(refresh)
  const servers = readServers()
  const tunnels = readTunnels()
  const managedPid = connectionPid()
  const connected = tunnels.some(tunnel => tunnel.localtunnelsRange)

  return json({
    success: true,
    supported: process.platform === 'darwin',
    core,
    identity: readIdentity(),
    tunnels,
    connected,
    /**
     * Whether the coordinator is still hearing from this tunnel.
     *
     * `connected` above cannot answer this, and that is the whole point of
     * it being separate: it is true whenever a utun with our range exists,
     * which it is throughout the failure where this node has been dropped
     * from the directory and the exit has withdrawn the route home. The
     * interface is up, the handshakes succeed, and nothing comes back.
     *
     * Only asked while connected. A warning from the last run reported over
     * a tunnel that is not even up would be noise.
     */
    coordinator: connected ? coordinatorHealth() : { reachable: true, message: null, detail: null },
    managedPid,
    /** How long the tunnel has been up. The window shows this as its clock. */
    uptimeSeconds: managedPid === null ? null : connectionUptime(managedPid),
    /**
     * Whether connecting will ask for a password.
     *
     * Only so the window can say the right thing. "Waiting for
     * authorization" under a dialog that is never going to appear is how a
     * helper working perfectly looks identical to one that has hung.
     */
    needsPassword: !helperReady(),
    defaultRegion: DEFAULT_REGION,
    regions: REGIONS.map(region => ({
      ...region,
      // Whether this location can be connected to at all. The window disables
      // the button and says why rather than letting it fail at the prompt.
      configured: Boolean(servers[region.id]),
    })),
  })
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json()
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

/** Serve a file from the payload, refusing anything that escapes it. */
function asset(pathname: string): Response {
  const root = webRoot()
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const resolved = path.resolve(root, relative)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    return new Response('Not found', { status: 404 })
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
    return new Response('Not found', { status: 404 })

  return new Response(fs.readFileSync(resolved), {
    headers: { 'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream' },
  })
}

/**
 * Bring this app's tunnel down as the agent goes.
 *
 * Quitting used to leave it running. The window closes, the launcher kills
 * the agent, and the tunnel — a separate process, running as root, detached
 * from both — carried on holding the default route, the DNS override, the
 * disabled IPv6 and an armed kill switch, with nothing left on screen that
 * could turn any of it off. Recoverable by launching the app again, which
 * finds the tunnel by scanning for it, but nobody should have to guess that.
 *
 * A VPN with no interface is not a VPN anybody chose to be running. Quit
 * means off.
 *
 * Returns a function rather than registering one, so the once-only guard
 * belongs to the caller and can be tested without sending real signals: exit
 * arrives both as a signal and as `exit`, and tearing a tunnel down twice
 * means the second attempt runs against whatever took its place.
 */
export function agentShutdown(stop: () => unknown): () => void {
  let done = false
  return () => {
    if (done)
      return
    done = true
    try {
      stop()
    }
    catch {
      // Nothing useful is left to do with this: the process is on its way
      // out, and a throw here would only replace a tidy exit with a crash.
    }
  }
}

export async function runAgent(): Promise<void> {
  const requested = Number.parseInt(process.env.BUDDYVPN_PORT ?? '0', 10)

  /*
   * `disconnect` is synchronous all the way down — it shells out and waits —
   * so it completes inside a signal handler, where an async teardown would
   * be abandoned at the first await.
   */
  const shutdown = agentShutdown(disconnect)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(signal, () => {
      shutdown()
      process.exit(0)
    })
  process.on('exit', shutdown)

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: Number.isInteger(requested) && requested > 0 ? requested : 0,
    async fetch(request) {
      const url = new URL(request.url)

      if (url.pathname === '/__health')
        return json({ ok: true })

      if (request.method === 'POST') {
        switch (url.pathname) {
          case '/api/status':
            return status((await body(request)).refresh === true)
          case '/api/connect': {
            const region = (await body(request)).region
            return json(connect(typeof region === 'string' ? region : ''))
          }
          case '/api/disconnect':
            return json(disconnect())
          /*
           * Its own endpoint rather than a field on status, because it costs
           * a request to a third party and status is polled every few
           * seconds. The window asks for it when it opens and after the
           * connection changes, which is when the answer can differ.
           */
          case '/api/location': {
            if (!readSettings().showLocation)
              return json({ success: true, location: null, disabled: true })
            return json({ success: true, location: await lookupLocation() })
          }
          /*
           * The code that hands this network to a phone.
           *
           * Asked for rather than included in status, and never drawn until
           * somebody asks: it carries the coordinator's shared secret, and a
           * secret that is on screen by default is a secret shown to whoever
           * walks past.
           */
          case '/api/pairing': {
            const region = (await body(request)).region
            if (typeof region !== 'string')
              return json({ success: false, error: 'No location given' })
            return json(pairingFor(region))
          }
          case '/api/settings':
            return json(settingsPayload())
          case '/api/settings/update':
            return json(updateSettings(await body(request)))
          case '/api/helper/uninstall': {
            const removed = uninstallHelper()
            return json({ ...removed, ...settingsPayload() })
          }
          default:
            return json({ success: false, error: 'Unknown endpoint' }, 404)
        }
      }

      return asset(url.pathname)
    },
  })

  // The launcher reads the port off this line, so its shape is a contract.
  console.log(`buddyvpn-agent listening on http://127.0.0.1:${server.port}`)
}

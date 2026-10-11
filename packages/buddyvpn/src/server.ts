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
import { connect, connectionPid, disconnect, readServers } from './vpn/control'
import { readCore, readIdentity, readTunnels } from './vpn/core'

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
function status(refresh: boolean): Response {
  const core = readCore(refresh)
  const servers = readServers()
  const tunnels = readTunnels()

  return json({
    success: true,
    supported: process.platform === 'darwin',
    core,
    identity: readIdentity(),
    tunnels,
    connected: tunnels.some(tunnel => tunnel.localtunnelsRange),
    managedPid: connectionPid(),
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

export async function runAgent(): Promise<void> {
  const requested = Number.parseInt(process.env.BUDDYVPN_PORT ?? '0', 10)

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

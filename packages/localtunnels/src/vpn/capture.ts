/**
 * Applying full-tunnel mode, and — more importantly — undoing it.
 *
 * `fulltunnel.ts` says what the commands are. This runs them, and carries the
 * responsibility that comes with that: every change made here is written to
 * disk as its own undo before it is applied, so a process that dies holding
 * the network shut can still be cleaned up by the next one.
 *
 * That file is the whole design. A kill switch that vanishes when its process
 * does is not a kill switch, so these rules deliberately outlive us — which
 * means something has to be able to lift them when we are not around to be
 * asked. `vpn:down` reads the file and runs what it finds, whether or not it
 * was the process that wrote it.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import {
  defaultRouteCommands,
  dnsCommands,
  killSwitchCommands,
  type Reversible,
} from './fulltunnel'

export interface CaptureOptions {
  tun: string
  /** The VPN server's public address and port. */
  endpointIp: string
  endpointPort: number
  /** Resolvers to use while connected — usually the tunnel's own. */
  dnsServers: string[]
  /** Off by default; a kill switch is the point of connecting. */
  killSwitch?: boolean
  /** Let the LAN through while the switch is armed. */
  allowLan?: boolean
}

/** Where the undo lives. Next to the keys, which is already a root-only dir. */
export function restorePath(): string {
  const base = process.env.LOCALTUNNELS_HOME || path.join(os.homedir(), '.localtunnels')
  return path.join(base, 'vpn', 'restore.json')
}

export interface RunResult {
  command: string[]
  ok: boolean
  stderr: string
}

/** Run one command, never throwing. Callers decide what a failure means. */
export async function runCommand(command: string[]): Promise<RunResult> {
  try {
    const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    return { command, ok: code === 0, stderr: (await new Response(proc.stderr).text()).trim() }
  }
  catch (error) {
    return { command, ok: false, stderr: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The physical default gateway, parsed from `route -n get default` (macOS) or
 * `ip route show default` (Linux).
 *
 * Split from the command so the parsing is testable — the output format is
 * the kind of thing that changes between releases and is never noticed until
 * a tunnel silently stops pinning its own endpoint.
 */
export function parseGateway(output: string): { gateway: string, iface: string | null } | null {
  // macOS: a block of `key: value` lines.
  const mac = output.match(/^\s*gateway:\s*(\S+)/m)
  if (mac) {
    const iface = output.match(/^\s*interface:\s*(\S+)/m)
    return { gateway: mac[1], iface: iface ? iface[1] : null }
  }

  // Linux: `default via 192.168.1.1 dev eth0 ...`
  const linux = output.match(/default\s+via\s+(\S+)(?:\s+dev\s+(\S+))?/)
  if (linux)
    return { gateway: linux[1], iface: linux[2] ?? null }

  return null
}

export async function discoverGateway(): Promise<{ gateway: string, iface: string | null } | null> {
  const command = process.platform === 'darwin'
    ? ['route', '-n', 'get', 'default']
    : ['ip', 'route', 'show', 'default']

  try {
    const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    return parseGateway(output)
  }
  catch {
    return null
  }
}

/**
 * Network service names from `networksetup -listallnetworkservices`.
 *
 * The first line is a header, and a service that has been disabled is
 * prefixed with an asterisk — setting DNS on one of those fails, and a failed
 * command in the middle of bringing a tunnel up is indistinguishable from a
 * tunnel that cannot be brought up.
 */
export function parseNetworkServices(output: string): string[] {
  return output
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('*'))
}

/** `networksetup -getdnsservers` prints a sentence when there are none set. */
export function parseDnsServers(output: string): string[] | null {
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean)
  // The apostrophe is matched as "any character": pickier's parser treats a
  // literal one inside a regex as the start of a string and loses the rest of
  // the file, reporting the surrounding function as unused.
  if (lines.length === 0 || lines.some(line => /there aren.t any/i.test(line)))
    return null
  return lines.filter(line => /^[0-9a-f.:]+$/i.test(line))
}

async function readCommand(command: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    return output
  }
  catch {
    return ''
  }
}

/** Every enabled network service, with the DNS it is set to right now. */
export async function discoverDnsServices(): Promise<Array<{ name: string, previous: string[] | null }>> {
  if (process.platform !== 'darwin')
    return []

  const names = parseNetworkServices(await readCommand(['networksetup', '-listallnetworkservices']))
  const services = []
  for (const name of names)
    services.push({ name, previous: parseDnsServers(await readCommand(['networksetup', '-getdnsservers', name])) })
  return services
}

/**
 * Apply full-tunnel mode.
 *
 * The undo is written before the first change is made, not after the last —
 * a crash halfway through has to be recoverable, and a file written at the
 * end would describe a state the machine never reached.
 *
 * If any step fails the whole thing is rolled back and the error raised,
 * because a half-captured network is the worst of both: traffic escaping the
 * tunnel while the window says otherwise.
 */
export async function captureTraffic(options: CaptureOptions): Promise<void> {
  const route = await discoverGateway()
  if (!route)
    throw new Error('Could not find the default gateway, so the tunnel has nothing to pin its own packets to')

  const parts: Reversible[] = [
    defaultRouteCommands({
      tun: options.tun,
      endpointIp: options.endpointIp,
      gateway: route.gateway,
      wanInterface: route.iface ?? undefined,
    }),
    dnsCommands({ servers: options.dnsServers, services: await discoverDnsServices() }),
  ]

  if (options.killSwitch) {
    parts.push(killSwitchCommands({
      tun: options.tun,
      endpointIp: options.endpointIp,
      endpointPort: options.endpointPort,
      allowLan: options.allowLan,
    }))
  }

  // Undone in the reverse of the order it was done: the kill switch comes off
  // before the routes it was protecting.
  const undo = parts.map(part => part.down).reverse().flat()
  writeRestore(undo)

  const applied: string[][][] = []
  for (const part of parts) {
    for (const command of part.up) {
      const result = await runCommand(command)
      if (!result.ok) {
        await rollback(applied.flat().reverse())
        throw new Error(`\`${command.join(' ')}\` failed: ${result.stderr || 'unknown error'}`)
      }
    }
    applied.push(part.down)
  }
}

async function rollback(commands: string[][]): Promise<void> {
  for (const command of commands)
    await runCommand(command)
  clearRestore()
}

export function writeRestore(commands: string[][]): void {
  const target = restorePath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify({ commands }, null, 2)}\n`, { mode: 0o600 })
}

export function readRestore(): string[][] {
  try {
    const parsed = JSON.parse(fs.readFileSync(restorePath(), 'utf8')) as { commands?: unknown }
    if (!Array.isArray(parsed.commands))
      return []
    // Validated rather than trusted: this file is read as root and executed.
    // It is ours and it is 0600, but "we wrote it" is not a property that
    // survives a disk someone else has had their hands on.
    return parsed.commands.filter((command): command is string[] =>
      Array.isArray(command) && command.length > 0 && command.every(arg => typeof arg === 'string'))
  }
  catch {
    return []
  }
}

export function clearRestore(): void {
  try {
    fs.rmSync(restorePath(), { force: true })
  }
  catch {
    // Advisory. Leaving it behind costs a redundant teardown next time.
  }
}

/**
 * Undo whatever the last capture did, including one from a process that is
 * no longer running.
 *
 * Every failure is swallowed: this runs against a machine that may have none
 * of the changes, some of them, or all of them, and stopping at the first
 * command that finds nothing to undo would leave the rest in place.
 */
export async function releaseTraffic(): Promise<RunResult[]> {
  const results: RunResult[] = []
  for (const command of readRestore())
    results.push(await runCommand(command))
  clearRestore()
  return results
}

/* eslint-disable node/prefer-global/process */
import { describe, expect, it } from 'bun:test'
import { isVpnAvailable, packetDestination, TunDevice } from '../src/vpn'

// A genuine layer-3 test: open a real TUN device, bring it up, and read an
// actual IP packet the kernel routes into it. Creating a TUN device needs
// CAP_NET_ADMIN, so this only runs as root on Linux (e.g. the CI `sudo` step);
// it skips cleanly everywhere else rather than failing.
const isLinux = process.platform === 'linux'
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const enabled = isVpnAvailable() && isLinux && isRoot
const describeRoot = enabled ? describe : describe.skip

if (isVpnAvailable() && isLinux && !isRoot) {
  // eslint-disable-next-line no-console
  console.warn('[vpn.tun-root] not root — skipping real-device test. Run under sudo to exercise it.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('timed out waiting for condition')
    await sleep(20)
  }
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`\`${cmd.join(' ')}\` failed (${code}): ${err.trim()}`)
  }
}

describeRoot('vpn/tun (real device, root)', () => {
  it('reads an IP packet the kernel routes into the device', async () => {
    const dev = TunDevice.open()
    try {
      expect(dev.name).toMatch(/^tun\d+$/)

      // Point-to-point: packets to 10.9.9.2 are routed into our device.
      await run(['ip', 'addr', 'add', '10.9.9.1', 'peer', '10.9.9.2', 'dev', dev.name])
      await run(['ip', 'link', 'set', 'dev', dev.name, 'up'])

      const packets: Uint8Array[] = []
      dev.on('packet', p => packets.push(p.slice()))
      dev.on('error', () => {})
      dev.start()

      // Ping the peer; the kernel emits an ICMP echo request into the tun.
      const ping = Bun.spawn(['ping', '-c', '1', '-W', '1', '10.9.9.2'], { stdout: 'ignore', stderr: 'ignore' })

      await until(() => packets.some(p => packetDestination(p) === '10.9.9.2'), 4000)
      const icmp = packets.find(p => packetDestination(p) === '10.9.9.2')!
      expect(icmp[0] >> 4).toBe(4) // IPv4
      expect(icmp[9]).toBe(1) // protocol 1 = ICMP

      await ping.exited
    }
    finally {
      dev.close()
    }
  })

  it('writes a packet to the device without error', async () => {
    const dev = TunDevice.open()
    try {
      await run(['ip', 'link', 'set', 'dev', dev.name, 'up'])
      // A minimal 20-byte IPv4 header (well-formed enough for the write path).
      const pkt = new Uint8Array(20)
      pkt[0] = 0x45 // version 4, IHL 5
      pkt[8] = 64 // TTL
      pkt[9] = 1 // ICMP
      pkt.set([10, 9, 9, 1], 12) // src
      pkt.set([10, 9, 9, 2], 16) // dst
      const n = dev.write(pkt)
      expect(n).toBe(pkt.length)
    }
    finally {
      dev.close()
    }
  })
})

/* eslint-disable node/prefer-global/process */
import { describe, expect, it } from 'bun:test'
import { isVpnAvailable, TunDevice, TunError } from '../src/vpn'

// Opening a TUN device needs root. These tests assert the code path behaves —
// it either opens a real device (when privileged) or throws a clean TunError,
// never crashes. Skipped entirely when the native lib isn't built.
const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

describeVpn('vpn/tun', () => {
  it('opens a device when root, or fails cleanly when not', () => {
    if (isRoot) {
      const dev = TunDevice.open()
      try {
        expect(dev.fd).toBeGreaterThanOrEqual(0)
        expect(dev.name.length).toBeGreaterThan(0)
        // macOS names are utunN, Linux tunN.
        expect(dev.name).toMatch(/^(utun|tun)\d+$/)
      }
      finally {
        dev.close()
      }
    }
    else {
      let threw: unknown
      try {
        TunDevice.open().close()
      }
      catch (err) {
        threw = err
      }
      expect(threw).toBeInstanceOf(TunError)
      // EPERM (1) or EACCES (13) are the expected unprivileged errnos.
      expect([1, 13]).toContain((threw as TunError).code)
    }
  })
})

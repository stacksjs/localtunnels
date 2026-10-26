/**
 * Quitting the app stops the tunnel.
 *
 * It used not to. The window closed, the launcher killed the agent, and the
 * tunnel went on running: a separate process, owned by root, detached from
 * both, still holding the default route, the DNS override, IPv6 disabled and
 * the kill switch armed — with nothing on screen that could lift any of it.
 *
 * The part worth a test is not the signal wiring, which is one line, but the
 * guard around it: exit reaches the agent twice, once as a signal and once as
 * `exit`, and tearing down twice means the second attempt runs against
 * whatever has taken the first one's place.
 */

import { describe, expect, it } from 'bun:test'
import { agentShutdown } from '../src/server'

describe('shutting the agent down', () => {
  it('stops the tunnel', () => {
    let stops = 0
    agentShutdown(() => { stops += 1 })()
    expect(stops).toBe(1)
  })

  /*
   * `process.on('exit')` fires after the signal handler has already run, so
   * both paths arrive on an ordinary quit. The second must do nothing: by
   * then this app's tunnel is gone, and `disconnect` stops every tunnel it
   * finds rather than only the recorded pid.
   */
  it('stops it once, however many ways the process is told to go', () => {
    let stops = 0
    const shutdown = agentShutdown(() => { stops += 1 })
    shutdown()
    shutdown()
    shutdown()
    expect(stops).toBe(1)
  })

  /*
   * The teardown shells out, and a tunnel that is already gone, a helper
   * that is not installed, or a refused prompt all throw. None of them is a
   * reason to replace a tidy exit with a crash — and a throw here would also
   * skip whatever the launcher does next.
   */
  it('does not turn a failed teardown into a crash on the way out', () => {
    const shutdown = agentShutdown(() => { throw new Error('no helper installed') })
    expect(() => shutdown()).not.toThrow()
  })

  // Still spent, so a teardown that threw is not retried against a machine
  // somebody has since fixed by hand.
  it('counts a failed teardown as the attempt it was', () => {
    let attempts = 0
    const shutdown = agentShutdown(() => {
      attempts += 1
      throw new Error('refused')
    })
    shutdown()
    shutdown()
    expect(attempts).toBe(1)
  })
})

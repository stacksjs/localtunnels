/**
 * Reading the tunnel's own warning out of its log.
 *
 * This exists because `connected` cannot answer the question. It is true
 * whenever a utun carrying our range exists, and it stays true through the
 * entire failure where this node has been dropped from the coordinator's
 * directory and the exit has withdrawn the route home: the interface is up,
 * the handshakes succeed, and nothing comes back. The window said
 * "Connected" for all of it.
 *
 * The tunnel now notices and says so. These cover the window reading it —
 * and above all, reading it from the *current* run, because the log
 * accumulates across connects and a warning from a previous one shown over a
 * healthy tunnel is worse than showing nothing.
 */
import { describe, expect, it } from 'bun:test'
import { readCoordinatorHealth } from '../src/vpn/control'

/** The line the tunnel writes when the coordinator stops answering. */
const QUIET = '  ! coordinator silent for 60s — the coordinator has not answered. '
  + 'This node will be dropped from the directory and the exit will stop routing to it.'
const QUIET_LOCAL = '  ! coordinator silent for 60s — heartbeats are queued unsent — nothing is leaving this machine. '
  + 'This node will be dropped from the directory and the exit will stop routing to it.'
const ANSWERING = '  ✓ coordinator answering again (silent for 75s)'

/** One run's output, as the tunnel writes it. */
function run(...lines: string[]): string {
  return [
    '  Interface:   utun7 (100.100.0.2/16, mtu 1380)',
    '  Public key:  abc123',
    '  ✓ link up to def456…',
    ...lines,
  ].join('\n')
}

describe('a healthy tunnel', () => {
  it('is reachable when nothing has gone wrong', () => {
    expect(readCoordinatorHealth(run())).toEqual({ reachable: true, detail: null })
  })

  it('is reachable when there is no log at all', () => {
    expect(readCoordinatorHealth('')).toEqual({ reachable: true, detail: null })
  })

  /*
   * A run that died before printing its interface line leaves no marker. The
   * whole log is then the only thing to read, which is right: there is no
   * later run to confuse it with.
   */
  it('still reads a run that never got as far as the interface', () => {
    const health = readCoordinatorHealth(`  starting\n${QUIET}`)
    expect(health.reachable).toBe(false)
  })
})

describe('a tunnel that has been forgotten', () => {
  it('is not reachable, and carries the warning', () => {
    const health = readCoordinatorHealth(run(QUIET))
    expect(health.reachable).toBe(false)
    expect(health.detail).toContain('coordinator silent for 60s')
    // The leading `!` is the log's, not the window's.
    expect(health.detail?.startsWith('!')).toBe(false)
  })

  /*
   * Two different failures the person fixes differently: a local firewall
   * rule versus a coordinator that has gone away. The distinction is in the
   * line, so it has to survive being passed along.
   */
  it('keeps the distinction between a local and a remote cause', () => {
    expect(readCoordinatorHealth(run(QUIET_LOCAL)).detail).toContain('leaving this machine')
    expect(readCoordinatorHealth(run(QUIET)).detail).toContain('has not answered')
  })
})

describe('recovery', () => {
  it('is reachable again once the tunnel says so', () => {
    expect(readCoordinatorHealth(run(QUIET, ANSWERING))).toEqual({ reachable: true, detail: null })
  })

  // A stall, a recovery, then another stall is an ordinary night on a laptop
  // that keeps changing networks. The last word wins.
  it('follows the last thing that happened, not the first', () => {
    const health = readCoordinatorHealth(run(QUIET, ANSWERING, QUIET))
    expect(health.reachable).toBe(false)
  })
})

describe('across runs', () => {
  /*
   * The mistake this is here to prevent, and one already made once in this
   * codebase against this very log: a naive read of the tail picked up a
   * previous, failed run's output and reported it against the current one.
   */
  it('ignores a warning from a previous run', () => {
    const log = [run(QUIET), run()].join('\n')
    expect(readCoordinatorHealth(log)).toEqual({ reachable: true, detail: null })
  })

  it('reports a warning from the current run even after a clean one', () => {
    const log = [run(), run(QUIET)].join('\n')
    expect(readCoordinatorHealth(log).reachable).toBe(false)
  })

  // A recovery belonging to the previous run must not clear this run's stall.
  it('does not let an old recovery clear a new warning', () => {
    const log = [run(QUIET, ANSWERING), run(QUIET)].join('\n')
    expect(readCoordinatorHealth(log).reachable).toBe(false)
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPair, isVpnAvailable, VpnPeer } from '../src/vpn'

const available = isVpnAvailable()
const describeVpn = available ? describe : describe.skip

if (!available) {
  // eslint-disable-next-line no-console
  console.warn('[vpn.rekey-retry] native libltvpn not built — skipping.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`condition not met within ${timeoutMs}ms`)
    await sleep(50)
  }
}

/*
 * The failure this covers took a machine off the internet for twenty minutes.
 *
 * Rekeying is chained: the next attempt is scheduled by a *successful*
 * handshake. So a rekey that failed scheduled nothing, and no further attempt
 * was ever made. The live session kept carrying traffic until it expired and
 * then stopped — with a kill switch armed, that is the whole machine offline,
 * interface up, window still saying connected.
 *
 * A handshake gets five tries a second apart. On a link with a 180ms round
 * trip that is a thin margin, and losing it once was permanent.
 */
describeVpn('a rekey that fails is tried again', () => {
  const peers: VpnPeer[] = []

  afterEach(() => {
    for (const peer of peers.splice(0))
      peer.stop()
  })

  it('keeps attempting after the far end stops answering', async () => {
    const a = generateKeyPair()
    const b = generateKeyPair()

    const responder = new VpnPeer({ keyPair: b, port: 0, raw: true })
    peers.push(responder)
    await responder.start()
    const responderPort = responder.port

    const initiator = new VpnPeer({
      keyPair: a,
      port: 0,
      raw: true,
      // Rekey almost immediately, and retry quickly, so the behaviour is
      // observable without a two-minute test.
      rekeyAfter: 1,
      rekeyRetry: 1,
    })
    peers.push(initiator)
    initiator.addPeer({ publicKey: b.publicKey })
    responder.addPeer({ publicKey: a.publicKey })
    await initiator.start()

    await initiator.connect(b.publicKey, '127.0.0.1', responderPort)

    // Silence the far end. Every rekey from here on must fail.
    responder.stop()

    /*
     * Count attempts rather than trust that a timer exists. One rekey is five
     * handshake tries a second apart, so a second failure can only happen if
     * something scheduled another attempt after the first gave up.
     *
     * Polled rather than slept for a fixed span: the timing here is five
     * seconds of handshake plus a retry delay, which leaves almost no margin
     * on a loaded CI runner. Waiting for the condition finishes as soon as it
     * is true and tolerates a slow machine.
     */
    let rekeyTimeouts = 0
    /*
     * Only handshake timeouts count. On Linux a datagram to a port nobody is
     * bound to returns ICMP port-unreachable, which the kernel reports on the
     * sending socket as ECONNREFUSED — so stopping the responder produces a
     * stream of socket errors that have nothing to do with rekeying, and
     * counting those would make this pass without the retry existing.
     */
    initiator.on('error', (err) => {
      if (/timed out after/.test(err.message))
        rekeyTimeouts += 1
    })
    // The responder is stopped and will raise for the same reason; nothing
    // listening would make that an uncaught error.
    responder.on('error', () => {})

    await until(() => rekeyTimeouts > 1, 30_000)
    expect(rekeyTimeouts).toBeGreaterThan(1)
  }, 45_000)
})

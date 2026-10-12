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

    // Count the attempts rather than trusting a timer exists: a handshake
    // takes five tries over five seconds, so two full rounds is enough to
    // show the chain did not stop at the first failure.
    let failures = 0
    initiator.on('error', () => { failures += 1 })

    await sleep(14_000)
    expect(failures).toBeGreaterThan(1)
  }, 25_000)
})

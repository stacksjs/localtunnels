/**
 * Two implementations of one protocol, checked against each other.
 *
 * `packages/localtunnels/src/vpn/protocol.ts` is the contract, and
 * `native/ios/CoordinatorClient.swift` is a second implementation of it in a
 * language that cannot run here. That is the whole problem: a phone that
 * spells `publicKey` differently, or sends `join` where the coordinator
 * expects `register`, does not fail loudly. It connects, says something
 * nobody understands, is never registered, and reports a tunnel that will
 * not come up — with no error on either side naming the cause.
 *
 * So the vocabulary is read out of the TypeScript and looked for in the
 * Swift. This cannot prove the two agree about meaning; it does prove they
 * agree about spelling, which is the half that fails silently.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROTOCOL = readFileSync(
  resolve(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'protocol.ts'),
  'utf8',
)
const SWIFT = readFileSync(join(PACKAGE_DIR, 'native', 'ios', 'CoordinatorClient.swift'), 'utf8')

/** Every `t: 'name'` the contract defines. */
function messageTypes(): string[] {
  return [...PROTOCOL.matchAll(/^\s*t:\s*'([a-z-]+)'/gm)].map(match => match[1])
}

/**
 * The field names of one interface in the contract, split by whether the
 * contract requires them.
 *
 * The distinction is the point. A required field this client does not send
 * is a registration that never happens; an optional one it leaves out may be
 * a deliberate decision, and `exitNode` is exactly that.
 */
function fieldsOf(name: string): { required: string[], optional: string[] } {
  const block = new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(PROTOCOL)
  if (!block)
    throw new Error(`protocol.ts has no interface ${name}`)
  const required: string[] = []
  const optional: string[] = []
  for (const match of block[1].matchAll(/^ {2}(\w+)(\??):/gm)) {
    if (match[1] === 't')
      continue
    ;(match[2] === '?' ? optional : required).push(match[1])
  }
  return { required, optional }
}

/** Whether the Swift mentions a token, without printing the file on failure. */
const mentions = (token: string): boolean => SWIFT.includes(token)

describe('the message vocabulary', () => {
  it('is the one the contract defines, with nothing invented', () => {
    const defined = new Set(messageTypes())
    expect(defined.has('register')).toBe(true)
    expect(defined.has('heartbeat')).toBe(true)
    expect(defined.has('registered')).toBe(true)
    expect(defined.has('peers')).toBe(true)
    expect(defined.has('error')).toBe(true)
  })

  /*
   * A message this client sends and the coordinator does not recognise is
   * dropped by `parseMessage` without a word.
   */
  it.each(['register', 'heartbeat'])('sends "%s" by that exact name', (type) => {
    expect(SWIFT).toContain(`"t": "${type}"`)
  })

  /*
   * A message the coordinator sends and this client does not recognise is
   * dropped just as quietly — and `registered` carries the only address this
   * node will ever have.
   */
  it.each(['registered', 'peers', 'error', 'heartbeat'])('answers to "%s"', (type) => {
    expect(SWIFT).toContain(`case "${type}"`)
  })
})

describe('the fields', () => {
  /*
   * `register` is the message that matters most: everything after it depends
   * on the coordinator having understood it, and a misspelled field is not
   * an error, it is a registration that silently never happens.
   */
  it('sends every field register requires', () => {
    for (const field of fieldsOf('RegisterMessage').required)
      expect({ field, sent: mentions(`"${field}"`) }).toEqual({ field, sent: true })
  })

  /*
   * A phone is never an exit. Advertising it as one is a claim the
   * coordinator relays without checking, and it would invite other members
   * to route the whole internet through a device with no IP forwarding, no
   * NAT and a battery. `exitNode` is optional precisely so a client can
   * decline it, and this one does.
   */
  it('never offers this device as an exit node', () => {
    expect(fieldsOf('RegisterMessage').optional).toContain('exitNode')
    expect(mentions('"exitNode": true')).toBe(false)
    expect(mentions('"t": "register"')).toBe(true)
  })

  // The auth key is optional in the contract and required by any coordinator
  // started with one, so it has to be sent when there is one to send.
  it('sends the auth key when it has one', () => {
    expect(fieldsOf('RegisterMessage').optional).toContain('authKey')
    expect(mentions('"authKey"')).toBe(true)
  })

  it('reads every field registered carries', () => {
    for (const field of fieldsOf('RegisteredMessage').required)
      expect({ field, read: mentions(`"${field}"`) }).toEqual({ field, read: true })
  })

  /*
   * A peer record is decoded by Swift's own property names, so these have to
   * match the JSON exactly — there is no custom CodingKeys to absorb a
   * difference, deliberately, because one would hide exactly this.
   */
  it('decodes a peer record by the contract’s own names', () => {
    const { required, optional } = fieldsOf('PeerRecord')
    for (const field of [...required, ...optional])
      expect({ field, decoded: mentions(`let ${field}`) }).toEqual({ field, decoded: true })
  })

  it('reads an endpoint’s host and port', () => {
    for (const field of fieldsOf('Endpoint').required)
      expect({ field, decoded: mentions(`let ${field}`) }).toEqual({ field, decoded: true })
  })
})

describe('choosing an exit', () => {
  const DESKTOP = readFileSync(
    resolve(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'interface.ts'),
    'utf8',
  )

  /*
   * The rule has to match `interface.ts`, not merely be reasonable. A phone
   * and a desktop on one network that disagree about which peer is "the"
   * exit send their traffic to different places, and nothing anywhere
   * reports a problem.
   */
  it('is the smallest public key among the exits, as the desktop chooses', () => {
    // `records.filter(r => r.exitNode).map(r => r.publicKey).sort()[0]`
    expect(DESKTOP).toMatch(/filter\(\s*r\s*=>\s*r\.exitNode\s*\)[\s\S]{0,60}\.sort\(\)\[0\]/)
    expect(SWIFT).toMatch(/filter\s*\{\s*\$0\.exitNode == true\s*\}/)
    expect(SWIFT).toMatch(/sorted\s*\{\s*\$0\.publicKey < \$1\.publicKey\s*\}/)
  })

  /*
   * And the desktop has a second branch, which is the one that matters.
   *
   * `exitNode` is a claim the coordinator relays without checking, and the
   * auth key every member holds is what lets anybody make it — so "whichever
   * peer advertises" means "whichever peer says so and sorts smallest".
   * `servers.json` can name a key instead, and a phone that cannot be told
   * the same thing routes its traffic through whoever turns up.
   */
  it('can be pinned on the phone, as it can on the desktop', () => {
    // `records.some(r => r.publicKey === want) ? want : null`
    expect(DESKTOP).toMatch(/some\(\s*r\s*=>\s*r\.publicKey === want\s*\)\s*\?\s*want\s*:\s*null/)
    expect(SWIFT).toContain('func exit(pinnedTo wanted: String?)')
    expect(SWIFT).toMatch(/if let wanted \{[\s\S]{0,400}?return first \{ \$0\.publicKey == wanted \}/)
  })

  /*
   * A pin honoured only when the peer also advertises would be no pin at
   * all: naming a key is the decision. The desktop says so in as many words,
   * and the phone has to agree or the two differ exactly when a peer stops
   * advertising.
   */
  it('honours a pin whether or not that peer advertises, as the desktop does', () => {
    expect(DESKTOP).toContain('A pinned key is honoured whenever that peer is present')
    const pinned = /if let wanted \{([\s\S]*?)\n {8}\}/.exec(SWIFT)
    expect(pinned).not.toBeNull()
    // Comments stripped: this branch explains in prose why it does not look
    // at `exitNode`, and the point is that the code does not.
    expect(pinned![1].replace(/\/\/.*$/gm, '')).not.toContain('exitNode')
  })

  /*
   * The regression: falling back to an unpinned exit because the pinned one
   * is absent undoes the decision at the one moment it mattered. `nil` is
   * the answer, and the provider turns it into a refusal a person can read.
   */
  it('refuses rather than substituting when a pinned exit is absent', () => {
    const provider = readFileSync(join(PACKAGE_DIR, 'native', 'ios', 'PacketTunnelProvider.swift'), 'utf8')
    expect(provider).toContain('case pinnedExitAbsent(region: String)')
    expect(provider).toContain('peers.exit(pinnedTo: exitKey)')
    expect(provider).toMatch(/exitKey == nil\s*\n\s*\? TunnelStartFailure\.noExit/)
  })
})

describe('reading the directory', () => {
  /*
   * One record this build cannot read must not cost the rest.
   *
   * Decoding the array in one call is all-or-nothing: a single bad record
   * discards every other record with it, `onPeers` never fires, and the
   * tunnel waits for an exit that was in the frame it threw away — silently,
   * because a nil from `try?` carries no reason. The desktop reads the same
   * frame field by field and tolerates what it does not understand.
   */
  it('keeps the records it can read and counts the ones it cannot', () => {
    expect(SWIFT).not.toMatch(/decode\(\[CoordinatorPeer\]\.self/)
    expect(SWIFT).toMatch(/for record in raw \{[\s\S]{0,400}?decode\(CoordinatorPeer\.self/)
    expect(SWIFT).toContain('undecodable += 1')
  })

  // Dropped quietly is how this was invisible in the first place.
  it('says when it has dropped one', () => {
    expect(SWIFT).toMatch(/if undecodable > 0 \{[\s\S]{0,200}?log\.error/)
  })
})

describe('staying registered', () => {
  /*
   * The failure this exists for: a node that stops heart-beating is dropped,
   * the exit withdraws its route, and the socket stays open throughout. The
   * TypeScript client answers that with an acked heartbeat and a silence
   * timer; this one has to do the same or a phone is dropped without ever
   * being told.
   */
  it('treats silence as a symptom, as the TypeScript client does', () => {
    const client = readFileSync(
      resolve(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'client.ts'),
      'utf8',
    )
    expect(client).toContain('staleAfter')
    expect(SWIFT).toContain('staleAfter')
    expect(SWIFT).toContain('lastFrameAt')
  })

  // Three heartbeats, inside the coordinator's two minutes, in both.
  it('allows the same silence before saying so', () => {
    expect(SWIFT).toContain('heartbeatInterval * 3')
  })
})

/*
 * Coming back, by the same rules on both platforms.
 *
 * A node that stops heart-beating is dropped and the exit withdraws the
 * route to its address, so a connection that is not re-established is a
 * tunnel that is dead rather than one that reports an error. A phone loses
 * this connection constantly, which makes it the platform where the policy
 * matters most and the one that cannot be tested here.
 *
 * Two numbers and one judgement have to match `vpn/client.ts`, and the
 * judgement is the one worth guarding: which refusals are worth retrying. A
 * phone that retried a rejected auth key forever would loop while hiding
 * the only thing anybody could fix; one that gave up on a key still held by
 * the connection it just lost would refuse to reconnect in precisely the
 * ordinary case.
 */
describe('reconnecting', () => {
  const CLIENT = readFileSync(
    resolve(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'client.ts'),
    'utf8',
  )

  it('is what both halves do at all', () => {
    expect(CLIENT).toContain('private scheduleReconnect(')
    expect(SWIFT).toContain('private func scheduleReconnect()')
  })

  // Doubling from a second to fifteen. Different numbers would mean a phone
  // and a desktop disagreeing about how long a coordinator has to come back.
  it('waits the same way', () => {
    expect(CLIENT).toContain('options.reconnectBaseMs ?? 1000')
    expect(CLIENT).toContain('options.reconnectMaxMs ?? 15_000')
    expect(SWIFT).toContain('reconnectBase: TimeInterval = 1')
    expect(SWIFT).toContain('reconnectMax: TimeInterval = 15')
  })

  /*
   * Jitter, in both. Every node on one network loses a coordinator at the
   * same instant; without it they come back in step and keep colliding.
   */
  it('jitters by the same quarter', () => {
    expect(CLIENT).toMatch(/doubled \* 0\.25/)
    expect(SWIFT).toMatch(/doubled \* 0\.25/)
  })

  /*
   * The judgement. `protocol.ts` names both refusals so the two halves
   * cannot drift on the wording — a message reworded on the server would
   * otherwise turn a fatal error into an infinite retry with nothing
   * failing anywhere.
   */
  it('agrees on which refusal is fatal', () => {
    const protocol = readFileSync(
      resolve(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'protocol.ts'),
      'utf8',
    )
    const unauthorized = /ERROR_UNAUTHORIZED = '(.*?)'/.exec(protocol)
    const duplicate = /ERROR_DUPLICATE_KEY = '(.*?)'/.exec(protocol)
    expect(unauthorized).not.toBeNull()
    expect(duplicate).not.toBeNull()
    // Spelled identically in the Swift, which has no way to import it.
    expect(SWIFT).toContain(`static let unauthorized = "${unauthorized![1]}"`)
    expect(SWIFT).toContain(`static let duplicateKey = "${duplicate![1]}"`)
    // And it is the auth key, in both, that stops the retrying.
    expect(CLIENT).toContain('this.lastServerError === ERROR_UNAUTHORIZED')
    expect(SWIFT).toContain('lastServerError == CoordinatorError.unauthorized')
  })

  /*
   * A duplicate key is *not* fatal. It is what the coordinator says while it
   * still believes in the connection this phone just lost, and it clears
   * itself once that connection has been silent long enough to be displaced.
   */
  it('retries a key the coordinator has not released yet', () => {
    for (const source of [CLIENT, SWIFT])
      expect(source).not.toMatch(/ERROR_DUPLICATE_KEY|CoordinatorError\.duplicateKey/)
  })

  // A client told to stop is stopped, or it is a client that cannot be
  // turned off. Both guard the retry on it.
  it('stays stopped when it was stopped on purpose', () => {
    expect(CLIENT).toContain('this.closedByUs')
    expect(SWIFT).toContain('closedByUs')
    expect(CLIENT).toMatch(/if \(this\.closedByUs \|\| !this\.reconnectEnabled/)
    expect(SWIFT).toMatch(/guard !closedByUs, retry == nil else \{ return \}/)
  })

  /*
   * And the backoff resets on success, or a session that dropped once an
   * hour would eventually be waiting the maximum every time, having last
   * succeeded immediately.
   */
  it('starts over after a registration that worked', () => {
    expect(CLIENT).toMatch(/this\.attempt = 0/)
    expect(SWIFT).toMatch(/attempt = 0\n {12}startHeartbeat\(\)/)
  })
})

/*
 * The one word that crosses from the extension to the app.
 *
 * The coordinator lives in the provider's process; the status the screens
 * read is written by the container app. `NEVPNConnection` has no push to the
 * app and no property that could carry this, so the app asks and the
 * provider answers — `sendProviderMessage` into `handleAppMessage`, which is
 * Apple's channel for exactly this and the only one here that does not cost
 * an App Group entitlement.
 *
 * Three spellings have to match across two processes and a language. A word
 * the app does not recognise reads as no banner, which is the right failure
 * and also a silent one: the screens would simply never mention a network
 * they had lost.
 */
describe('the coordinator phase', () => {
  const PROVIDER = readFileSync(join(PACKAGE_DIR, 'native', 'ios', 'PacketTunnelProvider.swift'), 'utf8')
  const CONTROL = readFileSync(join(PACKAGE_DIR, 'native', 'ios', 'TunnelControl.swift'), 'utf8')
  const TUNNEL = readFileSync(join(PACKAGE_DIR, 'src', 'tunnel.ts'), 'utf8')

  /** The words `CoordinatorPhase` admits, read out of the type. */
  function phases(): string[] {
    const union = /export type CoordinatorPhase = (.*)/.exec(TUNNEL)
    if (!union)
      throw new Error('src/tunnel.ts has no CoordinatorPhase')
    return [...union[1].matchAll(/'([a-z]+)'/g)].map(match => match[1])
  }

  it('is spelled the same in the provider as in the screens', () => {
    const defined = phases()
    expect(defined).toEqual(['joined', 'retrying', 'refused'])
    for (const phase of defined)
      expect({ phase, written: PROVIDER.includes(`coordinatorPhase = "${phase}"`) }).toEqual({ phase, written: true })
  })

  // And read back by the same name on the way into the frame.
  it('reaches the frame under the name the screens parse', () => {
    expect(CONTROL).toContain('"coordinator": coordinatorPhase ?? NSNull()')
    expect(readFileSync(join(PACKAGE_DIR, 'src', 'tunnel-bridge.ts'), 'utf8')).toContain('frame.coordinator')
  })

  /*
   * The channel itself, in both halves. A provider that answered nil would
   * leave the app with no phase and the screens with no banner, which is
   * indistinguishable from a coordinator that is fine.
   */
  it('is asked for by the app and answered by the provider', () => {
    expect(CONTROL).toContain('session.sendProviderMessage(')
    expect(PROVIDER).toContain('override func handleAppMessage(')
    expect(PROVIDER).toContain('completionHandler?(Data(coordinatorPhase.utf8))')
  })

  /*
   * Asked only while the tunnel is up, and forgotten when it is not. A phase
   * held across a disconnect would be published beside an idle tunnel —
   * "lost touch with Germany" under a screen that says Not connected.
   */
  it('is polled only while there is a provider to answer', () => {
    const connected = /case \.connected:([\s\S]*?)\n {8}(?:case|default)/.exec(CONTROL)
    expect(connected).not.toBeNull()
    expect(connected![1]).toContain('startCoordinatorPoll()')
    expect(CONTROL).toMatch(/private func stopCoordinatorPoll\(\)[\s\S]{0,600}?coordinatorPhase = nil/)
  })

  /*
   * Both ends of the retry report the same word. `onStale` is a coordinator
   * that has gone quiet on an open socket and `onReconnecting` is one this
   * phone is between sockets with — two states, nothing a person would do
   * differently about either, so one word and the distinction in the log.
   */
  it('collapses silence and retrying, as the screens expect', () => {
    for (const callback of ['onStale', 'onReconnecting']) {
      const block = new RegExp(`client\\.${callback} = \\{([\\s\\S]*?)\\n {8}\\}`).exec(PROVIDER)
      expect({ callback, found: block !== null }).toEqual({ callback, found: true })
      expect({ callback, says: block![1].includes('"retrying"') }).toEqual({ callback, says: true })
    }
  })
})

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
  /*
   * The rule has to match `interface.ts`, not merely be reasonable. A phone
   * and a desktop on one network that disagree about which peer is "the"
   * exit send their traffic to different places, and nothing anywhere
   * reports a problem.
   */
  it('is the smallest public key among the exits, as the desktop chooses', () => {
    const desktop = readFileSync(
      resolve(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'interface.ts'),
      'utf8',
    )
    // `records.filter(r => r.exitNode).map(r => r.publicKey).sort()[0]`
    expect(desktop).toMatch(/filter\(\s*r\s*=>\s*r\.exitNode\s*\)[\s\S]{0,60}\.sort\(\)\[0\]/)
    expect(SWIFT).toMatch(/filter\s*\{\s*\$0\.exitNode == true\s*\}/)
    expect(SWIFT).toMatch(/sorted\s*\{\s*\$0\.publicKey < \$1\.publicKey\s*\}/)
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

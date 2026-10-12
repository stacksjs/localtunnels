import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  coordinatorUrlFor,
  mergeServerEntry,
  readServerMap,
  writeServerEntry,
} from '../../../deploy/servers-json'
import { parseServers } from '../../buddyvpn/src/vpn/control'

const scratch = () => mkdtempSync(join(tmpdir(), 'lt-servers-json-'))

describe('mergeServerEntry', () => {
  const entry = { coordinatorUrl: 'ws://203.0.113.9:51821', authKey: 'k', useExit: 'pub' }

  it('adds a region to an empty file', () => {
    expect(mergeServerEntry({}, 'us-west', entry)).toEqual({ 'us-west': entry })
  })

  /*
   * The file describes every region at once. Deploying one must not forget a
   * server in another that is still running and still being billed for.
   */
  it('keeps the regions it is not touching', () => {
    const existing = { 'eu-central': { coordinatorUrl: 'ws://198.51.100.4:51821' } }
    const merged = mergeServerEntry(existing, 'us-west', entry)
    expect(Object.keys(merged).sort()).toEqual(['eu-central', 'us-west'])
    expect(merged['eu-central'].coordinatorUrl).toBe('ws://198.51.100.4:51821')
  })

  it('replaces a region that is redeployed', () => {
    const existing = { 'us-west': { coordinatorUrl: 'ws://old.example:51821', authKey: 'stale' } }
    expect(mergeServerEntry(existing, 'us-west', entry)['us-west']).toEqual(entry)
  })

  it('does not mutate what it was given', () => {
    const existing = { 'eu-central': { coordinatorUrl: 'ws://198.51.100.4:51821' } }
    mergeServerEntry(existing, 'us-west', entry)
    expect(Object.keys(existing)).toEqual(['eu-central'])
  })

  // Refusing to record a server that now exists, over a file nobody can read
  // anyway, leaves the app pointing at nothing.
  it('starts fresh when the existing content is not a map', () => {
    for (const junk of [null, undefined, 'text', 42, ['a'], true])
      expect(mergeServerEntry(junk, 'us-west', entry)).toEqual({ 'us-west': entry })
  })
})

describe('writeServerEntry', () => {
  const entry = { coordinatorUrl: 'ws://203.0.113.9:51821', authKey: 'secret', useExit: 'pub' }

  it('writes a file the app can parse back', () => {
    const path = join(scratch(), 'servers.json')
    writeServerEntry('us-west', entry, path)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'us-west': entry })
  })

  it('creates the directory when the app has never run', () => {
    const path = join(scratch(), 'BuddyVPN', 'servers.json')
    expect(() => writeServerEntry('us-west', entry, path)).not.toThrow()
    expect(readServerMap(path)).toEqual({ 'us-west': entry })
  })

  // The auth key in here is the credential that admits a client to the
  // network: anyone who can read this file can join it.
  it('writes it 0600', () => {
    const path = join(scratch(), 'servers.json')
    writeServerEntry('us-west', entry, path)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('merges into a file that is already there', () => {
    const path = join(scratch(), 'servers.json')
    writeFileSync(path, JSON.stringify({ 'eu-central': { coordinatorUrl: 'ws://198.51.100.4:51821' } }))
    writeServerEntry('us-west', entry, path)
    expect(Object.keys(readServerMap(path) as object).sort()).toEqual(['eu-central', 'us-west'])
  })

  it('survives a file that is not JSON at all', () => {
    const path = join(scratch(), 'servers.json')
    writeFileSync(path, 'not json {{{')
    writeServerEntry('us-west', entry, path)
    expect(readServerMap(path)).toEqual({ 'us-west': entry })
  })
})

describe('coordinatorUrlFor', () => {
  it('builds a scheme, host and port with no path', () => {
    expect(coordinatorUrlFor('203.0.113.9', 51821)).toBe('ws://203.0.113.9:51821')
  })

  /*
   * The app refuses a coordinator URL carrying a path, query or credentials,
   * so this has to produce the narrow shape rather than something that merely
   * looks like a URL.
   */
  it('produces a URL the app will accept', () => {
    const pattern = /^wss?:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i
    expect(coordinatorUrlFor('203.0.113.9', 51821)).toMatch(pattern)
  })
})

/*
 * The two halves of the handoff, checked against each other.
 *
 * The deploy writes this file and the app validates it independently, which
 * means a drift between them is a server that exists, is paid for, and is
 * silently ignored — the app would report "no server" with no indication that
 * one had ever been written. Asserting against a copy of the app's regex would
 * only prove the copy agrees with itself, so this runs the real validator.
 */
describe('what the deploy writes is what the app accepts', () => {
  const entry = {
    coordinatorUrl: coordinatorUrlFor('203.0.113.9', 51821),
    authKey: 'EJtL9oQmXrK2sVbN4pZcW7fHyT3dG6aUxR1iO0eM5nY',
    useExit: 'SqaUeBaVgl3FMs4LCSTujr8X2h5vYY4uFlqxuUvUr2A=',
  }

  it('round-trips a deployed region through the app parser intact', () => {
    const path = join(scratch(), 'servers.json')
    writeServerEntry('us-west', entry, path)

    const parsed = parseServers(JSON.parse(readFileSync(path, 'utf8')))
    expect(parsed['us-west']).toEqual(entry)
  })

  it('keeps the auth key, which the app drops if it is not key-shaped', () => {
    const path = join(scratch(), 'servers.json')
    writeServerEntry('us-west', entry, path)
    // A dropped key is the quiet failure: the entry survives, the credential
    // does not, and enrolment fails against a coordinator that requires one.
    expect(parseServers(JSON.parse(readFileSync(path, 'utf8')))['us-west'].authKey).toBe(entry.authKey)
  })

  it('keeps the pinned exit, which the app drops unless it is a public key', () => {
    const path = join(scratch(), 'servers.json')
    writeServerEntry('us-west', entry, path)
    expect(parseServers(JSON.parse(readFileSync(path, 'utf8')))['us-west'].useExit).toBe(entry.useExit)
  })

  it('writes a region the app actually offers', () => {
    // parseServers drops an unknown region outright, so a deploy naming one
    // the app does not list would write a file with nothing in it.
    const path = join(scratch(), 'servers.json')
    writeServerEntry('us-west', entry, path)
    expect(Object.keys(parseServers(JSON.parse(readFileSync(path, 'utf8'))))).toEqual(['us-west'])
  })
})

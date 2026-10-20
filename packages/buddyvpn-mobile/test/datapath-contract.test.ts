/**
 * Where a packet's length comes from, checked in all three places that
 * believe they know.
 *
 * The transport pads: `ltvpn_session_decrypt` returns a length rounded up to
 * a 16-byte boundary, so the plaintext is an IP packet followed by as many
 * as fifteen zeroes. Every receiver has to put that back, and the rule is
 * the IP header's own length field.
 *
 * This is worth a test rather than a comment because getting it wrong is
 * invisible from the places anyone would look. iOS accepts a padded packet
 * from `writePackets`, the IP stack reads the header's length and routes it,
 * TCP is unaffected because it reads its own lengths too — and then a UDP
 * datagram is delivered fifteen bytes longer than it was sent. DNS answers
 * become malformed, QUIC rejects frames, and `ping` says the tunnel is fine.
 *
 * None of this can be executed here: the receiver is Swift in an extension
 * that only exists on a phone. So the three implementations are read and
 * compared, which cannot prove they mean the same thing but does prove they
 * are all doing the same arithmetic on the same bytes.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts: string[]): string => readFileSync(join(...parts), 'utf8')

const SWIFT = read(PACKAGE_DIR, 'native', 'ios', 'TunnelSession.swift')
const CORE = read(PACKAGE_DIR, '..', 'vpn-core', 'src', 'transport.zig')
const ROUTING = read(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'routing.ts')
const PEER = read(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'peer.ts')

describe('the premise', () => {
  /*
   * If the core ever stopped padding, trimming would still be correct and
   * this whole contract would merely be unnecessary. It is the other
   * direction that has to fail loudly: a core that pads differently, or
   * starts reporting the unpadded length, changes what every receiver has
   * to do.
   */
  it('is that the transport pads a plaintext to 16 bytes', () => {
    expect(CORE).toMatch(/fn paddedLen\(len: usize\) usize \{\s*return \(len \+ 15\) & ~@as\(usize, 15\);/)
  })

  it('and that decrypt reports the padded length, not the packet’s', () => {
    expect(CORE).toContain('Returns the padded plaintext length written to')
  })

  /*
   * And that the payload is a bare IP packet in the first place. In framed
   * mode the length is in a two-byte prefix instead, and reading an IP
   * header would be reading the wrong bytes entirely — the tunnel runs raw.
   */
  it('and that this tunnel carries bare IP packets', () => {
    expect(read(PACKAGE_DIR, '..', 'localtunnels', 'src', 'vpn', 'interface.ts')).toContain('raw: true')
  })
})

describe('the desktop', () => {
  it('recovers the length from the IP header', () => {
    expect(ROUTING).toMatch(/export function ipPacketLength/)
    // IPv4 total length: bytes 2..4, big-endian.
    expect(ROUTING).toMatch(/\(packet\[2\] << 8\) \| packet\[3\]/)
    // IPv6: a fixed 40-byte header plus what it says follows.
    expect(ROUTING).toMatch(/40 \+ \(\(packet\[4\] << 8\) \| packet\[5\]\)/)
  })

  it('drops a plaintext that declares no length', () => {
    expect(PEER).toMatch(/const len = ipPacketLength\(plain\)[\s\S]{0,80}len === 0 \|\| len > plain\.length/)
  })
})

describe('the phone', () => {
  it('recovers the length from the same two header reads', () => {
    expect(SWIFT).toContain('static func packetLength(')
    expect(SWIFT).toMatch(/case 4 where bytes\.count >= 20:/)
    expect(SWIFT).toMatch(/Int\(bytes\[2\]\) << 8 \| Int\(bytes\[3\]\)/)
    expect(SWIFT).toMatch(/case 6 where bytes\.count >= 40:/)
    expect(SWIFT).toMatch(/40 \+ \(Int\(bytes\[4\]\) << 8 \| Int\(bytes\[5\]\)\)/)
  })

  it('drops a plaintext that declares no length, as the desktop does', () => {
    expect(SWIFT).toMatch(/let length = Self\.packetLength\(padded\)\s*\n\s*guard length > 0, length <= padded\.count else \{/)
  })

  /*
   * The regression itself: `written` is the padded length, and handing that
   * many bytes to the system is the bug. What reaches `writePackets` has to
   * be cut to the length the header declared.
   */
  it('hands the system the packet, not the padding', () => {
    expect(SWIFT).toContain('let packet = Data(padded.prefix(length))')
    // Scoped to `deliver`, because the send path legitimately writes every
    // byte `ltvpn_session_encrypt` produced — padding is the transport's to
    // add, and only the receiver has to take it off again.
    const deliver = /private func deliver\(_ datagram: Data\) \{([\s\S]*?)\n {4}\}/.exec(SWIFT)
    expect(deliver).not.toBeNull()
    expect(deliver![1]).not.toContain('Int(written)))')
  })

  /*
   * The other direction needs no trimming and must not acquire any: the
   * core pads on the way out, and a packet read from the flow is already
   * exactly as long as it says it is.
   */
  it('sends what the system gave it, unaltered', () => {
    expect(SWIFT).toMatch(/ltvpn_session_encrypt\([\s\S]{0,200}packet\.count,/)
  })
})

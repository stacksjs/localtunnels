import { describe, expect, it } from 'bun:test'
import {
  authKeyFile,
  buildConnectCommand,
  buildElevatedScript,
  looksLikeTunnel,
  parseElapsed,
  parseServers,
} from '../src/vpn/control'

/**
 * These cover the boundary between a file someone hand-edited and a command
 * that runs as root. Everything that reaches `buildConnectCommand` has been
 * through `parseServers` first, so the two are tested as the pair they are.
 */
describe('parseServers', () => {
  it('keeps an entry that is entirely well formed', () => {
    const servers = parseServers({
      'us-west': { coordinatorUrl: 'wss://vpn.example.com:51821', authKey: 'a-secret-1', useExit: 'auto' },
    })
    expect(servers['us-west']).toEqual({
      coordinatorUrl: 'wss://vpn.example.com:51821',
      authKey: 'a-secret-1',
      useExit: 'auto',
    })
  })

  it('accepts a bare host with no port', () => {
    expect(parseServers({ 'us-west': { coordinatorUrl: 'ws://coordinator' } })['us-west'].coordinatorUrl)
      .toBe('ws://coordinator')
  })

  it('drops a region the app does not offer', () => {
    expect(parseServers({ 'mars-north': { coordinatorUrl: 'ws://host' } })).toEqual({})
  })

  // Each of these is a shape that would end up inside a root shell if the
  // allowlist were a denylist instead.
  const refused: Array<[string, string]> = [
    ['a shell metacharacter', 'ws://host;touch /tmp/pwned'],
    ['a command substitution', 'ws://host$(id)'],
    ['a backtick', 'ws://host`id`'],
    ['a quote that would close the AppleScript literal', 'ws://host"'],
    ['a path, which the coordinator flag does not take', 'ws://host/../../etc'],
    ['a query string', 'ws://host?x=1'],
    ['credentials in the authority', 'ws://user:pass@host'],
    ['a scheme that is not websocket', 'http://host'],
    ['no scheme at all', 'host:51821'],
    ['a newline', 'ws://host\nmalicious'],
    ['a space', 'ws://host other'],
  ]

  for (const [why, coordinatorUrl] of refused) {
    it(`refuses a coordinator with ${why}`, () => {
      expect(parseServers({ 'us-west': { coordinatorUrl } })).toEqual({})
    })
  }

  it('refuses an entry with no coordinator', () => {
    expect(parseServers({ 'us-west': { authKey: 'nope' } })).toEqual({})
  })

  it('keeps the entry but drops an auth key that is not key-shaped', () => {
    const servers = parseServers({
      'us-west': { coordinatorUrl: 'ws://host', authKey: 'a"b;id' },
    })
    expect(servers['us-west']).toEqual({ coordinatorUrl: 'ws://host' })
  })

  it('drops an exit that is neither auto nor a public key', () => {
    const servers = parseServers({
      'us-west': { coordinatorUrl: 'ws://host', useExit: 'whatever' },
    })
    expect(servers['us-west'].useExit).toBeUndefined()
  })

  it('keeps a base64 public key as the exit', () => {
    const key = 'SqaUeBaVgl3FMs4LCSTujr8X2h5vYY4uFlqxuUvUr2A='
    expect(parseServers({ 'us-west': { coordinatorUrl: 'ws://host', useExit: key } })['us-west'].useExit)
      .toBe(key)
  })

  it('survives input that is not an object at all', () => {
    for (const value of [null, undefined, 42, 'text', [], true])
      expect(parseServers(value)).toEqual({})
  })
})

describe('buildConnectCommand', () => {
  it('quotes every argument and records the pid', () => {
    const command = buildConnectCommand('/Applications/BuddyVPN.app/Contents/MacOS/localtunnels', {
      coordinatorUrl: 'wss://vpn.example.com:51821',
    })
    expect(command).toContain(`'/Applications/BuddyVPN.app/Contents/MacOS/localtunnels'`)
    expect(command).toContain(`'vpn:up'`)
    expect(command).toContain(`'wss://vpn.example.com:51821'`)
    // The tunnel has to outlive the osascript that authorized it, by being
    // orphaned from a subshell rather than by nohup — which fails outright
    // under `do shell script`, where there is no console to detach from.
    expect(command).toStartWith('(')
    expect(command).toEndWith(')')
    expect(command).not.toContain('nohup')
    expect(command).toContain('< /dev/null')
    expect(command).toContain('echo $! >')
  })

  it('omits the auth key when the coordinator is open', () => {
    const command = buildConnectCommand('/bin/lt', { coordinatorUrl: 'ws://host' })
    expect(command).not.toContain('--auth-key')
    expect(command).not.toContain('LOCALTUNNELS_AUTH_KEY')
  })

  /*
   * `ps` shows every process's full argv to every user on the Mac, so a
   * secret passed as an argument is a secret handed to anything that can run
   * `ps aux`. The shell reads it out of a 0600 file instead.
   */
  it('never puts the secret in the command line', () => {
    const command = buildConnectCommand('/bin/lt', {
      coordinatorUrl: 'ws://host',
      authKey: 'THE-SHARED-SECRET',
    })
    expect(command).not.toContain('THE-SHARED-SECRET')
    expect(command).not.toContain('--auth-key')
  })

  it('reads the secret from the staged file instead', () => {
    const command = buildConnectCommand('/bin/lt', {
      coordinatorUrl: 'ws://host',
      authKey: 'THE-SHARED-SECRET',
    })
    expect(command).toContain(`LOCALTUNNELS_AUTH_KEY=$(cat '${authKeyFile()}')`)
    // The assignment has to precede the command it applies to, or it is just
    // a variable nothing reads.
    expect(command.indexOf('LOCALTUNNELS_AUTH_KEY')).toBeLessThan(command.indexOf('vpn:up'))
  })

  // These are what make it a VPN rather than a private link to one machine.
  // Without --full-tunnel the browser ignores the tunnel entirely; without
  // the kill switch a dropped tunnel is a silent downgrade. Neither is a
  // setting, so neither may be dropped by accident.
  it('always asks for the full tunnel and the kill switch', () => {
    for (const entry of [
      { coordinatorUrl: 'ws://host' },
      { coordinatorUrl: 'ws://host', authKey: 'secret' },
      { coordinatorUrl: 'ws://host', useExit: 'auto' },
    ]) {
      const command = buildConnectCommand('/bin/lt', entry)
      expect(command).toContain('--full-tunnel')
      expect(command).toContain('--kill-switch')
    }
  })

  it('falls back to an automatic exit, since --full-tunnel refuses without one', () => {
    expect(buildConnectCommand('/bin/lt', { coordinatorUrl: 'ws://host' })).toContain(`'--use-exit' 'auto'`)
  })

  it('uses a pinned exit when the server entry names one', () => {
    const key = 'SqaUeBaVgl3FMs4LCSTujr8X2h5vYY4uFlqxuUvUr2A='
    expect(buildConnectCommand('/bin/lt', { coordinatorUrl: 'ws://host', useExit: key }))
      .toContain(`'--use-exit' '${key}'`)
  })

  it('quotes a CLI path containing a space', () => {
    // Which is the normal case: the app is called "BuddyVPN.app" but lives
    // under a folder a user may well have put a space in.
    const command = buildConnectCommand('/Users/a b/BuddyVPN.app/Contents/MacOS/localtunnels', {
      coordinatorUrl: 'ws://host',
    })
    expect(command).toContain(`'/Users/a b/BuddyVPN.app/Contents/MacOS/localtunnels'`)
  })
})

describe('buildElevatedScript', () => {
  it('escapes the quotes that would end the AppleScript literal', () => {
    expect(buildElevatedScript('echo "hi"')).toBe(
      `do shell script "echo \\"hi\\"" with administrator privileges`,
    )
  })

  it('escapes backslashes before quotes, so an escape cannot be escaped away', () => {
    expect(buildElevatedScript('a\\b')).toContain('a\\\\b')
  })

  /*
   * The regression that shipped. This returned a whole `osascript -e '...'`
   * command for `/bin/sh`, so the single quotes `shellEscape` puts around
   * every path closed the wrapper early and AppleScript got a truncated
   * script. It is script text now, passed to osascript as an argument, so a
   * single quote is an ordinary character — and the test says so, because the
   * old one asserted the broken shape and passed.
   */
  it('leaves single quotes alone, because nothing wraps this in a shell string', () => {
    const script = buildElevatedScript(buildConnectCommand('/Applications/B.app/x/localtunnels', {
      coordinatorUrl: 'ws://host',
      authKey: 'secret',
    }))
    expect(script.startsWith('do shell script "')).toBe(true)
    expect(script.endsWith('" with administrator privileges')).toBe(true)
    expect(script).toContain(`'/Applications/B.app/x/localtunnels'`)
    // Exactly two unescaped double quotes: the ones delimiting the literal.
    expect(script.replace(/\\"/g, '').match(/"/g)).toHaveLength(2)
  })
})

describe('looksLikeTunnel', () => {
  const cli = '/Applications/BuddyVPN.app/Contents/MacOS/localtunnels'

  it('matches our own CLI running vpn:up', () => {
    expect(looksLikeTunnel(`${cli} vpn:up --coordinator ws://host`, cli)).toBe(true)
  })

  it('refuses another binary running vpn:up', () => {
    expect(looksLikeTunnel('/usr/bin/someone-else vpn:up', cli)).toBe(false)
  })

  it('refuses our CLI running something else', () => {
    expect(looksLikeTunnel(`${cli} vpn:status`, cli)).toBe(false)
  })

  // A recorded pid can be reused by anything. Without the command check,
  // disconnect would kill whatever inherited the number.
  it('refuses an unrelated process that happens to hold the pid', () => {
    expect(looksLikeTunnel('/usr/sbin/cupsd -l', cli)).toBe(false)
  })

  it('does not treat vpn:up as a prefix', () => {
    expect(looksLikeTunnel('vim lt vpn:upgrade-notes')).toBe(false)
  })

  it('falls back to the CLI name when no path is known', () => {
    expect(looksLikeTunnel('/opt/homebrew/bin/localtunnels vpn:up')).toBe(true)
    expect(looksLikeTunnel('lt vpn:up')).toBe(true)
  })
})

describe('parseElapsed', () => {
  it('reads the three shapes ps prints', () => {
    expect(parseElapsed('05:09')).toBe(309)
    expect(parseElapsed('01:05:09')).toBe(3909)
    expect(parseElapsed('2-01:05:09')).toBe(176_709)
  })

  it('tolerates the leading whitespace ps pads with', () => {
    expect(parseElapsed('   00:07')).toBe(7)
    expect(parseElapsed('\n  12:34:56  \n')).toBe(45_296)
  })

  it('returns null rather than a wrong number', () => {
    // A misparse here would show a tunnel as days old, so anything
    // unrecognised has to be nothing at all.
    for (const value of ['', 'nonsense', '1', ':', '1:2:3:4', 'ps: no such process'])
      expect(parseElapsed(value)).toBeNull()
  })
})

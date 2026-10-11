/**
 * The small shell helpers this app needs, and nothing else.
 *
 * SystemCleaner keeps these in a `@system-cleaner/core` package shared by a
 * dozen subsystems. This app has one screen and two commands, so they live
 * here rather than becoming a package in their own right — but the escaping
 * is copied exactly, because that part is not a convenience, it is the
 * boundary that keeps a text field out of a root shell.
 */
import { spawnSync } from 'node:child_process'

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

/**
 * Run a command and return what it said, never throwing.
 *
 * `cwd` matters more than it looks: the localtunnels CLI is a compiled Bun
 * binary, and Bun reads `bunfig.toml` from the working directory — probing it
 * from inside a project makes it inherit that project's preload and fail for
 * reasons that have nothing to do with the CLI. Callers pass a neutral
 * directory.
 */
export function exec(command: string, options: { cwd?: string, timeout?: number } = {}): ExecResult {
  try {
    const result = spawnSync('/bin/sh', ['-c', command], {
      encoding: 'utf8',
      timeout: options.timeout ?? 10_000,
      cwd: options.cwd,
    })
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      code: result.status,
    }
  }
  catch {
    return { ok: false, stdout: '', stderr: '', code: null }
  }
}

/**
 * Single-quote a value for `/bin/sh`.
 *
 * Everything inside `'...'` is literal to the shell except `'` itself, which
 * is closed, escaped and reopened. This is a backstop, not the defence —
 * values reaching it have already been matched against an allowlist, because
 * an escape that has to be perfect twice is an escape that will eventually be
 * wrong once.
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Escape a value for an AppleScript double-quoted literal.
 *
 * `osascript -e 'do shell script "..."'` nests a shell command inside an
 * AppleScript string, so a `"` or a `\` in the command ends the literal early
 * and whatever follows is script. Both are escaped here; `shellEscape` runs
 * first, for the inner shell.
 */
export function appleScriptEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Cache a value for a while. The CLI probe costs a process and a second of crypto. */
export class TtlCache<T> {
  private entry: { value: T, expires: number } | null = null

  constructor(private readonly ttlMs: number) {}

  get(): T | null {
    if (!this.entry || Date.now() > this.entry.expires)
      return null
    return this.entry.value
  }

  set(value: T): void {
    this.entry = { value, expires: Date.now() + this.ttlMs }
  }

  clear(): void {
    this.entry = null
  }
}

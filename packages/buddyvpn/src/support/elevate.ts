/**
 * Running one command as root, through the system's own password dialog.
 *
 * Its own module because two callers need it — the tunnel and the helper
 * installer — and the second importing it from the first would make a cycle
 * out of what is really a shared primitive.
 */
import { appleScriptEscape, type ExecResult, execFile } from './shell'

/**
 * The AppleScript that runs a shell command as root, as script text.
 *
 * Only the AppleScript layer is escaped here, and that is the whole point.
 * This used to return a complete `osascript -e '...'` shell command, which
 * added a second layer: the script was wrapped in single quotes and then
 * handed to `/bin/sh`, while the command inside it was full of the single
 * quotes `shellEscape` puts around every path. The first of those closed the
 * wrapper, so `osascript` received a sentence ending mid-string and failed to
 * parse before it could ever ask for a password.
 *
 * Run it with {@link runElevated}, which passes this to `osascript` as an
 * argument rather than as shell source. The escaping that is left is for the
 * shell AppleScript itself invokes, which is what `shellEscape` is for.
 */
export function buildElevatedScript(shellCommand: string): string {
  return `do shell script "${appleScriptEscape(shellCommand)}" with administrator privileges`
}

/** Run a shell command as root, prompting through the system dialog. */
export function runElevated(shellCommand: string): ExecResult {
  return execFile('osascript', ['-e', buildElevatedScript(shellCommand)], { timeout: 180_000 })
}

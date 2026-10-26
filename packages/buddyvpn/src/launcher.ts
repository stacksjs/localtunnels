/* eslint-disable no-console */
/**
 * `Contents/MacOS/BuddyVPN` — the executable macOS launches.
 *
 * The shape is SystemCleaner's, because the problem is the same one: the
 * window has to be backed by a server running on *this* Mac, not a remote URL.
 * So this owns the whole lifecycle:
 *
 *   1. start the agent on a loopback port,
 *   2. wait until it answers,
 *   3. open the Craft window on it,
 *   4. shut the agent down when the window closes.
 *
 * Step 4 is the one to be careful about. Without it, quitting leaves a process
 * holding a port, and the next launch inherits it.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

/**
 * One executable, two jobs.
 *
 * `bun build --compile` writes ~60 MB whatever you compile, nearly all of it
 * the Bun runtime. Shipping the launcher and the agent as separate binaries
 * would put two copies of that runtime in the bundle for no benefit, so the
 * agent is a subcommand of this binary. This has to come before anything else
 * at module scope, because the launcher's body starts a server and opens a
 * window as a side effect of loading.
 */
if (process.argv[2] === 'agent') {
  const { runAgent } = await import('./server')
  await runAgent()
  // `Bun.serve` keeps the process alive from here. Parking suspends module
  // evaluation for good — falling through would have the agent spawn a second
  // agent and open a window.
  await new Promise(() => {})
}

const APP_NAME = 'BuddyVPN'

/** How long the agent gets to bind and answer before the launcher gives up. */
const STARTUP_TIMEOUT_MS = 20_000
/** How long it gets to bring the tunnel down on the way out. */
const AGENT_SHUTDOWN_MS = 5000
const POLL_INTERVAL_MS = 100

const macosDir = path.dirname(process.execPath)
const contentsDir = path.dirname(macosDir)

const craftBinary = path.join(macosDir, 'craft-runtime')
const webRoot = path.join(contentsDir, 'Resources/web')

/**
 * Application data lives in `~/Library/Application Support`, not next to the
 * binary: a `.app` is not writable by the user and is replaced wholesale on
 * update, so a server list stored inside it would be both unwritable and
 * disposable.
 */
const dataDir = path.join(os.homedir(), 'Library/Application Support', APP_NAME)

function fail(message: string): never {
  console.error(`[vpn] ${message}`)
  process.exit(1)
}

for (const [label, target] of [
  ['Craft runtime', craftBinary],
  ['web payload', webRoot],
] as const) {
  if (!fs.existsSync(target))
    fail(`${label} missing from the app bundle: ${target}`)
}

fs.mkdirSync(dataDir, { recursive: true })

const agent = Bun.spawn([process.execPath, 'agent'], {
  stdout: 'pipe',
  stderr: 'inherit',
  env: {
    ...process.env,
    BUDDYVPN_WEB_ROOT: webRoot,
    // The CLI and the native core ship beside this binary. `findCli()` looks
    // there first, and the CLI's own library resolver looks next to its
    // execPath — which is the same directory.
    LTVPN_BUNDLED: '1',
  },
})

let shuttingDown = false

function stopAgent(): void {
  if (shuttingDown)
    return
  shuttingDown = true
  try {
    agent.kill()
  }
  catch {
    // Already gone.
  }
}

process.on('exit', stopAgent)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    stopAgent()
    process.exit(0)
  })
}

/**
 * Read the port off the agent's first line of output.
 *
 * Asking the OS for a free port and reading back what it gave us beats
 * picking a fixed one, which collides with whatever else is running and with
 * a second copy of this app.
 */
async function readPort(): Promise<number> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  const decoder = new TextDecoder()
  let buffered = ''

  for await (const chunk of agent.stdout as ReadableStream<Uint8Array>) {
    buffered += decoder.decode(chunk, { stream: true })
    const match = buffered.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
    if (match)
      return Number(match[1])
    if (Date.now() > deadline)
      break
  }

  fail('the agent did not report a port')
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__health`)
      if (response.ok)
        return
    }
    catch {
      // Not up yet.
    }
    await Bun.sleep(POLL_INTERVAL_MS)
  }

  fail('the agent never became healthy')
}

const port = await readPort()
await waitForHealth(port)

/**
 * Whether the bundled runtime takes a given flag.
 *
 * Asked of the binary's own argument table rather than of its version,
 * because an unsigned or locally built runtime answers `--version` with
 * nothing useful — macOS kills an unsigned Mach-O on exec, so a version probe
 * reads empty and the runtime is judged incapable of everything. `grep -qa`
 * on the binary needs no exec at all. A runtime that cannot be read is
 * treated as incapable, which is the safe answer for every flag below.
 */
function runtimeSupports(flag: string): boolean {
  try {
    return Bun.spawnSync(['grep', '-qa', '--', flag, craftBinary]).exitCode === 0
  }
  catch {
    return false
  }
}

/**
 * Hiding the titlebar puts the window's own buttons over the page's top-left
 * corner, which is where this window wants them — but only if the runtime
 * publishes where it drew them, so the page can keep its content clear, and
 * serves `window.startDrag`, which is the only way a page can move a window
 * that has no titlebar. WebKit discards `-webkit-app-region: drag`. Both
 * arrived with `--titlebar-hidden`, so the flag stands for all three.
 */
const canHostChrome = runtimeSupports('--titlebar-hidden')
const material = runtimeSupports('--web-window-material') ? ['--web-window-material'] : []

/**
 * Craft draws a sidebar toggle and two history arrows beside the window
 * buttons. Neither belongs here: this window has no sidebar and never
 * navigates, so they sat in the title strip offering to go back to a page
 * that does not exist.
 */
const chromeControls = runtimeSupports('--no-web-chrome-controls') ? ['--no-web-chrome-controls'] : []

/**
 * Let the page keep what it stores.
 *
 * Craft gives a window a non-persistent data store by default — no disk I/O
 * at startup, and right for a window that only renders. It is wrong for this
 * one: the chosen location lives in `localStorage`, and in an ephemeral store
 * it is forgotten on quit, so the app would reopen on the default location
 * every time no matter what you picked.
 */
const persistentStorage = runtimeSupports('--persistent-storage') ? ['--persistent-storage'] : []

/**
 * Reopen where it was left.
 *
 * A small window you keep in a corner of the screen is one you put somewhere
 * deliberately, and having it jump back to the centre on every launch undoes
 * that each time. AppKit does the remembering, keyed by this name.
 */
const frameAutosave = runtimeSupports('--frame-autosave') ? ['--frame-autosave', 'buddyvpn-main'] : []

/**
 * What the application menu calls this app.
 *
 * The window is drawn by `craft-runtime`, which is a child process, and
 * AppKit names About/Hide/Quit after the running executable rather than after
 * the bundle around it. The menu's title came from `CFBundleName` and was
 * right; everything under it read "Quit craft-runtime", which names an
 * implementation detail the person using this has no reason to have heard of.
 */
const appName = runtimeSupports('--app-name') ? ['--app-name', APP_NAME] : []

const craft = Bun.spawn([
  craftBinary,
  `http://127.0.0.1:${port}/`,
  '--title',
  APP_NAME,
  ...(canHostChrome ? ['--titlebar-hidden', ...material] : []),
  ...chromeControls,
  ...persistentStorage,
  ...frameAutosave,
  ...appName,
  // A consumer VPN window: narrow enough to leave in a corner of the screen,
  // tall enough that the button sits in the middle rather than crowding the
  // location row under it.
  '--width',
  '380',
  '--height',
  '620',
  ...(process.env.BUDDYVPN_DEVTOOLS === '1' ? [] : ['--no-devtools']),
], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

const code = await craft.exited
stopAgent()
/*
 * Waited for, not just signalled.
 *
 * The agent brings the tunnel down on its way out, and that means shelling
 * out to lift the kill switch and put the routes back. Exiting the moment
 * after `kill()` took the agent's parent with it mid-teardown, which is the
 * one outcome worse than not trying: a machine left part-restored.
 *
 * Capped, because quitting an app has to finish. An agent still going after
 * this long is wedged, and the tunnel it did not stop is recovered by
 * launching again — the same place a crash leaves it.
 */
await Promise.race([agent.exited, Bun.sleep(AGENT_SHUTDOWN_MS)])
process.exit(code)

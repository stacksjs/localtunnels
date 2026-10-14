/**
 * Dependency updates for this repository.
 *
 * The one setting here exists because of a GitHub rule rather than a
 * preference: the default `GITHUB_TOKEN` is forbidden from writing anything
 * under `.github/workflows`. Without `BUDDY_BOT_TOKEN` — a personal access
 * token carrying the `repo` and `workflow` scopes — buddy-bot would find the
 * action updates, build a branch containing them, and fail when it tried to
 * push, every day, on a schedule.
 *
 * So the workflow files are left alone for now. Everything in `package.json`
 * and `deps.yaml` is still updated, which is most of what there is.
 *
 * To turn action updates on: add `BUDDY_BOT_TOKEN` as a repository secret
 * and delete the `ignorePaths` entry below. Nothing else needs to change —
 * the workflow already reads that secret and already says which token it is
 * using, so the first run after will report the difference.
 */
/*
 * Untyped on purpose. `buddy-bot` is run with `bunx` and is not a dependency
 * of this repository, so importing `BuddyBotConfig` from it would be an
 * import that resolves to nothing — invisible today, because Bun erases type
 * imports before anything tries, and a broken import in an editor and in any
 * future tsconfig that reaches this file.
 */
const config = {
  packages: {
    // `patch` is also the workflow's default; set here so a local
    // `bunx buddy-bot update` behaves the way CI does rather than defaulting
    // to `all` and proposing majors nobody asked for.
    strategy: 'patch',
    ignorePaths: [
      '.github/workflows/**',
    ],
  },
}

export default config

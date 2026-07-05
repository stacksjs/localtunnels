# Claude Code Guidelines

## About

localtunnels is a zero-config local tunnel that exposes your localhost to the internet over HTTPS. It features smart subdomain resolution (explicit, APP_NAME-based, or random memorable names with auto-collision handling), automatic DNS resolution for macOS `.dev` TLD issues, and self-hosting with IaC deploys via ts-cloud (AWS + Hetzner). Available as both a CLI (`localtunnels start`) and a library (`startLocalTunnel()` / `TunnelClient`).

## Repository layout

This is a bun-workspaces monorepo:

- `packages/localtunnels` — the published npm package (TypeScript source, CLI, tests)
- `packages/vpn-core` — the native WireGuard v1 core (`libltvpn`) in Zig; build with `bun run build:native`
- `deploy/` — VPN deployment scripts (`bun run deploy:vpn` / `verify:vpn` / `destroy:vpn`), provisioning via `@stacksjs/ts-cloud`
- `docs/`, `benchmarks/` — bunpress docs and mitata benchmark suites at the root

## Linting

- Use **pickier** for linting — never use eslint directly
- Run `bunx --bun pickier .` to lint, `bunx --bun pickier . --fix` to auto-fix
- When fixing unused variable warnings, prefer `// eslint-disable-next-line` comments over prefixing with `_`

## Frontend

- Use **stx** for templating — never write vanilla JS (`var`, `document._`, `window._`) in stx templates
- Use **crosswind** as the default CSS framework which enables standard Tailwind-like utility classes
- stx `<script>` tags should only contain stx-compatible code (signals, composables, directives)

## Dependencies

- **buddy-bot** handles dependency updates — not renovatebot
- **better-dx** provides shared dev tooling as peer dependencies — do not install its peers (e.g., `typescript`, `pickier`, `bun-plugin-dtsx`) separately if `better-dx` is already in `package.json`
- If `better-dx` is in `package.json`, ensure `bunfig.toml` includes `linker = "hoisted"`

## Commits

- Use conventional commit messages (e.g., `fix:`, `feat:`, `chore:`)

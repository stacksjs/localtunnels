# Changelog

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.9...v0.2.10)

## 🐛 Bug Fixes

- **test**: scope the test run to this repo's packages ([7fe130a](https://github.com/stacksjs/localtunnels/commit/7fe130a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **pkg**: drop bun→src export condition, stop shipping src ([abf4fa8](https://github.com/stacksjs/localtunnels/commit/abf4fa8)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📚 Documentation

- link the community as stacksjs.com/discord ([b6de7f7](https://github.com/stacksjs/localtunnels/commit/b6de7f7)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.2.10 ([d0fe6a9](https://github.com/stacksjs/localtunnels/commit/d0fe6a9)) _(by Chris <chrisbreuer93@gmail.com>)_
- release v0.2.9 ([2c899f5](https://github.com/stacksjs/localtunnels/commit/2c899f5)) _(by Chris <chrisbreuer93@gmail.com>)_
- **release**: add a non-interactive release:patch script ([b76c3c3](https://github.com/stacksjs/localtunnels/commit/b76c3c3)) _(by Chris <chrisbreuer93@gmail.com>)_
- **pkg**: add sideEffects:false to localtunnels (publint) ([d3567c2](https://github.com/stacksjs/localtunnels/commit/d3567c2)) _(by Chris <chrisbreuer93@gmail.com>)_
- release v0.2.8 ([849a4ec](https://github.com/stacksjs/localtunnels/commit/849a4ec)) _(by Chris <chrisbreuer93@gmail.com>)_
- upgrade to TypeScript 7 ([f649f10](https://github.com/stacksjs/localtunnels/commit/f649f10)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.37 ([b8e7814](https://github.com/stacksjs/localtunnels/commit/b8e7814)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.8...v0.2.9)

## 🐛 Bug Fixes

- **pkg**: drop bun→src export condition, stop shipping src ([bee5808](https://github.com/stacksjs/localtunnels/commit/bee5808)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📚 Documentation

- link the community as stacksjs.com/discord ([b22163a](https://github.com/stacksjs/localtunnels/commit/b22163a)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧹 Chores

- release v0.2.9 ([9c4e83f](https://github.com/stacksjs/localtunnels/commit/9c4e83f)) _(by Chris <chrisbreuer93@gmail.com>)_
- **release**: add a non-interactive release:patch script ([474cf2f](https://github.com/stacksjs/localtunnels/commit/474cf2f)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: bump @stacksjs/ts-cloud to ^0.7.26 ([cff1b35](https://github.com/stacksjs/localtunnels/commit/cff1b35)) _(by Chris <chrisbreuer93@gmail.com>)_
- **pkg**: add sideEffects:false to localtunnels (publint) ([957933c](https://github.com/stacksjs/localtunnels/commit/957933c)) _(by Chris <chrisbreuer93@gmail.com>)_
- upgrade to TypeScript 7 ([bed975a](https://github.com/stacksjs/localtunnels/commit/bed975a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.37 ([7d43438](https://github.com/stacksjs/localtunnels/commit/7d43438)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- release v0.2.8 ([462fff0](https://github.com/stacksjs/localtunnels/commit/462fff0)) _(by Chris <chrisbreuer93@gmail.com>)_
- upgrade to TypeScript 7 ([5e4ba88](https://github.com/stacksjs/localtunnels/commit/5e4ba88)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _glennmichael123 <gtorregosa@gmail.com>_

[Compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.7...v0.2.8)

## 💥 Breaking Changes

- refactor!: convert to a bun-workspaces monorepo; provision deploys via ts-cloud ([35449b6](https://github.com/stacksjs/localtunnels/commit/35449b6)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🚀 Features

- **vpn-core**: ABI v4 — null-safe FFI surface and send-counter export ([806eac9](https://github.com/stacksjs/localtunnels/commit/806eac9)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: make transport sessions and handshake state thread-safe ([2786130](https://github.com/stacksjs/localtunnels/commit/2786130)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: VPN deploy takes --provider hetzner ([0bdd9ab](https://github.com/stacksjs/localtunnels/commit/0bdd9ab)) _(by aws <Chris>)_
- **cloud**: deploy the tunnel server to Hetzner with --provider hetzner ([29faae2](https://github.com/stacksjs/localtunnels/commit/29faae2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **tunnel**: binary-safe transport, fail-fast errors, and forwarded headers ([8830d1d](https://github.com/stacksjs/localtunnels/commit/8830d1d)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: run the localtunnels VPN (not stock WireGuard) on Hetzner ([7698fe8](https://github.com/stacksjs/localtunnels/commit/7698fe8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: self-hosted WireGuard VPN on Hetzner via ts-cloud ([e0ebc51](https://github.com/stacksjs/localtunnels/commit/e0ebc51)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: M10 — IPv6, exit-node routing, raw WireGuard transport, Windows ([80724e6](https://github.com/stacksjs/localtunnels/commit/80724e6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: wire-correctness KATs and relay fallback for symmetric NAT ([c30e4d8](https://github.com/stacksjs/localtunnels/commit/c30e4d8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: NAT traversal via UDP hole punching ([3fd9c25](https://github.com/stacksjs/localtunnels/commit/3fd9c25)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: session lifecycle (rekey, cookie/mac2, allowed-ips) and native pump ([c1cffd8](https://github.com/stacksjs/localtunnels/commit/c1cffd8)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: peer coordination and auto-discovered encrypted mesh ([6bc0d8d](https://github.com/stacksjs/localtunnels/commit/6bc0d8d)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: native TUN device support and `lt vpn up` bridge ([d633bea](https://github.com/stacksjs/localtunnels/commit/d633bea)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: userspace UDP datapath with end-to-end encrypted transport ([5f8fe62](https://github.com/stacksjs/localtunnels/commit/5f8fe62)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: WireGuard-style encrypted core with a Zig native datapath ([d8d8d83](https://github.com/stacksjs/localtunnels/commit/d8d8d83)) _(by Chris <chrisbreuer93@gmail.com>)_
- on-demand TLS check endpoint + typed event emitters ([1794767](https://github.com/stacksjs/localtunnels/commit/1794767)) _(by Chris <chrisbreuer93@gmail.com>)_
- add deploy-site CI workflow for auto-deploying marketing site ([8450dd3](https://github.com/stacksjs/localtunnels/commit/8450dd3)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🐛 Bug Fixes

- **pkg**: drop bun→src export condition, stop shipping src ([bee5808](https://github.com/stacksjs/localtunnels/commit/bee5808)) _(by Chris <chrisbreuer93@gmail.com>)_
- **client**: verify server TLS cert on the DNS-bypass path instead of skipping it ([4f26121](https://github.com/stacksjs/localtunnels/commit/4f26121)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deploy**: scope SSH, harden cloud-init installers, keep secrets out of the unit ([dfc3163](https://github.com/stacksjs/localtunnels/commit/dfc3163)) _(by Chris <chrisbreuer93@gmail.com>)_
- **cli**: don't let a failed disconnect hang shutdown as an unhandled rejection ([6dc89e6](https://github.com/stacksjs/localtunnels/commit/6dc89e6)) _(by Chris <chrisbreuer93@gmail.com>)_
- **tunnel**: build websocket control frames with JSON.stringify ([4cf563a](https://github.com/stacksjs/localtunnels/commit/4cf563a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: bound datagram DataViews so short packets can't read out of bounds ([05f8720](https://github.com/stacksjs/localtunnels/commit/05f8720)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: TUN reads no longer silently drop or truncate packets ([5d92472](https://github.com/stacksjs/localtunnels/commit/5d92472)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: one-shot key derivation and fail-closed session lifecycle ([27b76ef](https://github.com/stacksjs/localtunnels/commit/27b76ef)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: REJECT_AFTER_MESSAGES off-by-one and FFI-input hardening ([cc6c16a](https://github.com/stacksjs/localtunnels/commit/cc6c16a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: handle macOS utun AF framing in the packet pump ([4fab5fe](https://github.com/stacksjs/localtunnels/commit/4fab5fe)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: mint DoS cookies from a private rotating secret, not public data ([c6babdb](https://github.com/stacksjs/localtunnels/commit/c6babdb)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: stage handshake state and commit only after full authentication ([1e28995](https://github.com/stacksjs/localtunnels/commit/1e28995)) _(by Chris <chrisbreuer93@gmail.com>)_
- **ci**: deploy docs from dist/.bunpress (bunpress build output) ([6654754](https://github.com/stacksjs/localtunnels/commit/6654754)) _(by Chris <chrisbreuer93@gmail.com>)_
- **build**: emit declarations and JS for every exports subpath ([7ff2671](https://github.com/stacksjs/localtunnels/commit/7ff2671)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: retry getrandom on EINTR instead of failing key generation ([4d4fff1](https://github.com/stacksjs/localtunnels/commit/4d4fff1)) _(by Chris <chrisbreuer93@gmail.com>)_
- **tls**: approve www host in on-demand TLS check ([65d6019](https://github.com/stacksjs/localtunnels/commit/65d6019)) _(by Chris <chrisbreuer93@gmail.com>)_
- **server**: wire --domain into TunnelServer ([2fcf127](https://github.com/stacksjs/localtunnels/commit/2fcf127)) _(by Chris <chrisbreuer93@gmail.com>)_
- add setup-bun to publish-commit job ([252f831](https://github.com/stacksjs/localtunnels/commit/252f831)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- normalize actions/checkout version tags ([963539b](https://github.com/stacksjs/localtunnels/commit/963539b)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- use correct bunpress output path in deploy-site workflow ([00ecf51](https://github.com/stacksjs/localtunnels/commit/00ecf51)) _(by Chris <chrisbreuer93@gmail.com>)_
- externalize ts-analytics in build and compile scripts ([39be331](https://github.com/stacksjs/localtunnels/commit/39be331)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## ⚡ Performance Improvements

- **vpn-core**: ship the native library as ReleaseFast by default ([c665617](https://github.com/stacksjs/localtunnels/commit/c665617)) _(by Chris <chrisbreuer93@gmail.com>)_

## 📚 Documentation

- document VPN mode, deployment, and the hardened HTTP tunnel ([bd86ce9](https://github.com/stacksjs/localtunnels/commit/bd86ce9)) _(by Chris <chrisbreuer93@gmail.com>)_
- self-hosting is capability-first — tunnel server and VPN on either provider ([cb54c46](https://github.com/stacksjs/localtunnels/commit/cb54c46)) _(by Chris <chrisbreuer93@gmail.com>)_
- reflect multi-provider IaC deploys (AWS + Hetzner via ts-cloud) ([f39250c](https://github.com/stacksjs/localtunnels/commit/f39250c)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: document VPN mode; ship native source and add build scripts ([3f6a533](https://github.com/stacksjs/localtunnels/commit/3f6a533)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧪 Tests

- **vpn-core**: transport data-message known-answer vectors ([30cf3f2](https://github.com/stacksjs/localtunnels/commit/30cf3f2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: fuzz tests, real-socket pump test, root TUN e2e, and CI ([5ce503e](https://github.com/stacksjs/localtunnels/commit/5ce503e)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🤖 Continuous Integration

- **release**: gate npm publish on typecheck and tests ([29f7e48](https://github.com/stacksjs/localtunnels/commit/29f7e48)) _(by Chris <chrisbreuer93@gmail.com>)_
- fix zig 0.17 test build; gate pantry publish-commit on repo variable ([6599f7e](https://github.com/stacksjs/localtunnels/commit/6599f7e)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn**: run the full test suite in the VPN e2e job ([a3e0b6b](https://github.com/stacksjs/localtunnels/commit/a3e0b6b)) _(by Chris <chrisbreuer93@gmail.com>)_
- drop redundant setup-bun (pantry installs bun via deps.yaml) ([3cd082c](https://github.com/stacksjs/localtunnels/commit/3cd082c)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.2.8 ([7715e29](https://github.com/stacksjs/localtunnels/commit/7715e29)) _(by Chris <chrisbreuer93@gmail.com>)_
- upgrade to TypeScript 7 ([5e4ba88](https://github.com/stacksjs/localtunnels/commit/5e4ba88)) _(by Chris <chrisbreuer93@gmail.com>)_
- **vpn-core**: keygen retry, shared protocol constants, boundary test ([ae5610d](https://github.com/stacksjs/localtunnels/commit/ae5610d)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: pin pickier ^0.1.37 (markdown fenced-code autofix fix) ([ef953f2](https://github.com/stacksjs/localtunnels/commit/ef953f2)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: bump @stacksjs/ts-cloud to ^0.7.7 ([769950c](https://github.com/stacksjs/localtunnels/commit/769950c)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.35 ([79f5f67](https://github.com/stacksjs/localtunnels/commit/79f5f67)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.33 ([7432fba](https://github.com/stacksjs/localtunnels/commit/7432fba)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up @stacksjs/logsmith 0.2.3 ([0522a6c](https://github.com/stacksjs/localtunnels/commit/0522a6c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up buddy-bot 0.9.20 ([d62c0e7](https://github.com/stacksjs/localtunnels/commit/d62c0e7)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: bump better-dx to ^0.2.15 ([e63fa66](https://github.com/stacksjs/localtunnels/commit/e63fa66)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock to pick up bun-plugin-dtsx@0.9.18 ([61c5976](https://github.com/stacksjs/localtunnels/commit/61c5976)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock and apply pickier --fix ([3970e32](https://github.com/stacksjs/localtunnels/commit/3970e32)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock ([5efb7a7](https://github.com/stacksjs/localtunnels/commit/5efb7a7)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock to pick up latest pickier ([dc92297](https://github.com/stacksjs/localtunnels/commit/dc92297)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fresh install to pick up dtsx 0.9.14 and bunfig 0.15.9 ([83d15d1](https://github.com/stacksjs/localtunnels/commit/83d15d1)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fix CI errors ([e3efc9e](https://github.com/stacksjs/localtunnels/commit/e3efc9e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fix lint errors ([6af980e](https://github.com/stacksjs/localtunnels/commit/6af980e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fresh install to pick up pickier 0.1.21 ([4dab815](https://github.com/stacksjs/localtunnels/commit/4dab815)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- auto-fix lint errors ([683109f](https://github.com/stacksjs/localtunnels/commit/683109f)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- include md in pickier lint extensions ([c796f57](https://github.com/stacksjs/localtunnels/commit/c796f57)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update vscode config ([c5ca005](https://github.com/stacksjs/localtunnels/commit/c5ca005)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update dependencies ([3d3312c](https://github.com/stacksjs/localtunnels/commit/3d3312c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- repo cleanup and modernization ([0bfc760](https://github.com/stacksjs/localtunnels/commit/0bfc760)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([1f24b1c](https://github.com/stacksjs/localtunnels/commit/1f24b1c)) _(by Chris <chrisbreuer93@gmail.com>)_
- use Pantry action for publish-commit and add job dependencies ([d1b8b86](https://github.com/stacksjs/localtunnels/commit/d1b8b86)) _(by Chris <chrisbreuer93@gmail.com>)_
- remove file ignores from pickier config ([fa55888](https://github.com/stacksjs/localtunnels/commit/fa55888)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add CLAUDE.md and CHANGELOG.md to pickier ignores ([cd23db7](https://github.com/stacksjs/localtunnels/commit/cd23db7)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- remove .pickierignore ([6694f07](https://github.com/stacksjs/localtunnels/commit/6694f07)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update better-dx to ^0.2.7 ([e2cbb29](https://github.com/stacksjs/localtunnels/commit/e2cbb29)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- enrich CLAUDE.md with detailed project context from README ([4990f26](https://github.com/stacksjs/localtunnels/commit/4990f26)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update CLAUDE.md with project context and crosswind details ([0daf0a6](https://github.com/stacksjs/localtunnels/commit/0daf0a6)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add proper claude code guidelines ([9939aeb](https://github.com/stacksjs/localtunnels/commit/9939aeb)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- use pantry monorepo action instead of pantry-setup ([3132a5f](https://github.com/stacksjs/localtunnels/commit/3132a5f)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- ignore claude config in linter ([2b44318](https://github.com/stacksjs/localtunnels/commit/2b44318)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add claude code guidelines ([684cd20](https://github.com/stacksjs/localtunnels/commit/684cd20)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fix ts-analytics dep to github ref and update CI actions ([872b153](https://github.com/stacksjs/localtunnels/commit/872b153)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([efe5c61](https://github.com/stacksjs/localtunnels/commit/efe5c61)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([deb9e50](https://github.com/stacksjs/localtunnels/commit/deb9e50)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([85db325](https://github.com/stacksjs/localtunnels/commit/85db325)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([288b8da](https://github.com/stacksjs/localtunnels/commit/288b8da)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([eaf3dec](https://github.com/stacksjs/localtunnels/commit/eaf3dec)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([67edb0d](https://github.com/stacksjs/localtunnels/commit/67edb0d)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([323c24f](https://github.com/stacksjs/localtunnels/commit/323c24f)) _(by Chris <chrisbreuer93@gmail.com>)_
- wip ([2f5f05e](https://github.com/stacksjs/localtunnels/commit/2f5f05e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([6dd6733](https://github.com/stacksjs/localtunnels/commit/6dd6733)) _(by Chris <chrisbreuer93@gmail.com>)_

## ⏪ Reverts

- keep staged-lint kebab + bunx gitlint shorthand ([255e042](https://github.com/stacksjs/localtunnels/commit/255e042)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_
- _aws <Chris>_
- _glennmichael123 <gtorregosa@gmail.com>_

## v0.2.6...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.6...main)

### 🚀 Enhancements

- Add `manageHosts` ([46ddef0](https://github.com/stacksjs/localtunnels/commit/46ddef0))

### 🏡 Chore

- Update docs ([1d7ca85](https://github.com/stacksjs/localtunnels/commit/1d7ca85))
- Add bun exports ([df53461](https://github.com/stacksjs/localtunnels/commit/df53461))
- Wip ([f6f7d23](https://github.com/stacksjs/localtunnels/commit/f6f7d23))
- Wip ([fac7dcd](https://github.com/stacksjs/localtunnels/commit/fac7dcd))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.5...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.5...main)

### 🏡 Chore

- Wip ([886f095](https://github.com/stacksjs/localtunnels/commit/886f095))
- Wip ([e0fd2c6](https://github.com/stacksjs/localtunnels/commit/e0fd2c6))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.3...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.3...main)

### 🏡 Chore

- Fix unused variable lint errors ([da0a2c0](https://github.com/stacksjs/localtunnels/commit/da0a2c0))
- Wip ([99835af](https://github.com/stacksjs/localtunnels/commit/99835af))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))
- Glennmichael123 ([@glennmichael123](https://github.com/glennmichael123))

## v0.2.2...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.2...main)

### 🏡 Chore

- Wip ([c8ac58c](https://github.com/stacksjs/localtunnels/commit/c8ac58c))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.1...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.1...main)

### 🏡 Chore

- Wip ([cf6ee5c](https://github.com/stacksjs/localtunnels/commit/cf6ee5c))
- Wip ([5f971c9](https://github.com/stacksjs/localtunnels/commit/5f971c9))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.1...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.1...main)

### 🏡 Chore

- Wip ([cf6ee5c](https://github.com/stacksjs/localtunnels/commit/cf6ee5c))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.2.1...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.2.1...main)

### 🏡 Chore

- Wip ([cf6ee5c](https://github.com/stacksjs/localtunnels/commit/cf6ee5c))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))

## v0.1.1...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.1.1...main)

### 🚀 Enhancements

- New release script using pantry ([#23](https://github.com/stacksjs/localtunnels/pull/23))

### 📖 Documentation

- Add analytics ([5b6fbd3](https://github.com/stacksjs/localtunnels/commit/5b6fbd3))
- Added install, usage and intro ([30f980b](https://github.com/stacksjs/localtunnels/commit/30f980b))
- Added unconfig override ([e541aa3](https://github.com/stacksjs/localtunnels/commit/e541aa3))
- Fix typo on dowload version ([7728788](https://github.com/stacksjs/localtunnels/commit/7728788))
- Enhance docs ([3e87a6b](https://github.com/stacksjs/localtunnels/commit/3e87a6b))
- Fix build error ([ec61ff5](https://github.com/stacksjs/localtunnels/commit/ec61ff5))
- Update code theme ([ad6e05d](https://github.com/stacksjs/localtunnels/commit/ad6e05d))
- Improve showcase ([0d1c46a](https://github.com/stacksjs/localtunnels/commit/0d1c46a))
- Improve showcase ([7bc6d33](https://github.com/stacksjs/localtunnels/commit/7bc6d33))
- Improve sponsors ([2c135c0](https://github.com/stacksjs/localtunnels/commit/2c135c0))

### 🏡 Chore

- Improve docs ([903f2db](https://github.com/stacksjs/localtunnels/commit/903f2db))
- Enhance docs ([b82f13c](https://github.com/stacksjs/localtunnels/commit/b82f13c))
- Enhance team member css ([4e4d3a1](https://github.com/stacksjs/localtunnels/commit/4e4d3a1))
- Fix lint issue ([0e0fbb7](https://github.com/stacksjs/localtunnels/commit/0e0fbb7))
- Enhance css ([ce26081](https://github.com/stacksjs/localtunnels/commit/ce26081))
- Enhance team description ([f9de86c](https://github.com/stacksjs/localtunnels/commit/f9de86c))
- Update bunfig & use text lock file ([e965db5](https://github.com/stacksjs/localtunnels/commit/e965db5))
- Pin unconfig ([9c7471b](https://github.com/stacksjs/localtunnels/commit/9c7471b))
- Adjust uno version ([ceb0121](https://github.com/stacksjs/localtunnels/commit/ceb0121))
- Revert unconfig ([c4c9491](https://github.com/stacksjs/localtunnels/commit/c4c9491))
- Several minor adjustments ([b8e2dd9](https://github.com/stacksjs/localtunnels/commit/b8e2dd9))
- Update renovate config ([1ba7a55](https://github.com/stacksjs/localtunnels/commit/1ba7a55))
- Improve sponsor.md ([b1e61d9](https://github.com/stacksjs/localtunnels/commit/b1e61d9))
- Add github funding info ([4a4d343](https://github.com/stacksjs/localtunnels/commit/4a4d343))
- Sponsor changes ([dcbd02f](https://github.com/stacksjs/localtunnels/commit/dcbd02f))
- Enhnace dictionary ([2e3b88d](https://github.com/stacksjs/localtunnels/commit/2e3b88d))
- Enhance funding ([05541a6](https://github.com/stacksjs/localtunnels/commit/05541a6))
- Add stacksjs/docs and cursor rules ([e6a75ac](https://github.com/stacksjs/localtunnels/commit/e6a75ac))
- Sponsors changes and stargazers ([81a3c74](https://github.com/stacksjs/localtunnels/commit/81a3c74))
- Improve docs and add  bun-git-hooks with gitlint ([564f3e7](https://github.com/stacksjs/localtunnels/commit/564f3e7))
- Add clarity and improve logging ([d246389](https://github.com/stacksjs/localtunnels/commit/d246389))
- Wip ([01b18e0](https://github.com/stacksjs/localtunnels/commit/01b18e0))
- Wip ([1f8fe63](https://github.com/stacksjs/localtunnels/commit/1f8fe63))
- Wip ([40f9ec5](https://github.com/stacksjs/localtunnels/commit/40f9ec5))
- Wip ([0c31f98](https://github.com/stacksjs/localtunnels/commit/0c31f98))
- Wip ([f37763b](https://github.com/stacksjs/localtunnels/commit/f37763b))
- Update cover & og-image ([7f40857](https://github.com/stacksjs/localtunnels/commit/7f40857))
- Wip ([fe6627b](https://github.com/stacksjs/localtunnels/commit/fe6627b))
- Wip ([78677b3](https://github.com/stacksjs/localtunnels/commit/78677b3))
- Wip ([603f7d9](https://github.com/stacksjs/localtunnels/commit/603f7d9))
- Wip ([e13fbb3](https://github.com/stacksjs/localtunnels/commit/e13fbb3))
- Wip ([24ff40c](https://github.com/stacksjs/localtunnels/commit/24ff40c))
- Wip ([e4e95af](https://github.com/stacksjs/localtunnels/commit/e4e95af))
- Wip ([54a3f25](https://github.com/stacksjs/localtunnels/commit/54a3f25))
- Wip ([8f04ac8](https://github.com/stacksjs/localtunnels/commit/8f04ac8))
- Wip ([86cda8a](https://github.com/stacksjs/localtunnels/commit/86cda8a))
- Wip ([b7e3ca5](https://github.com/stacksjs/localtunnels/commit/b7e3ca5))
- Wip ([1a6429a](https://github.com/stacksjs/localtunnels/commit/1a6429a))
- Wip ([f946e89](https://github.com/stacksjs/localtunnels/commit/f946e89))
- Wip ([65f8956](https://github.com/stacksjs/localtunnels/commit/65f8956))
- Wip ([213a2aa](https://github.com/stacksjs/localtunnels/commit/213a2aa))
- Wip ([360355c](https://github.com/stacksjs/localtunnels/commit/360355c))
- Wip ([d821e31](https://github.com/stacksjs/localtunnels/commit/d821e31))
- Wip ([7f97109](https://github.com/stacksjs/localtunnels/commit/7f97109))
- Wip ([367eda9](https://github.com/stacksjs/localtunnels/commit/367eda9))
- Wip ([a94f94a](https://github.com/stacksjs/localtunnels/commit/a94f94a))
- Wip ([bcbb8ab](https://github.com/stacksjs/localtunnels/commit/bcbb8ab))

### ❤️ Contributors

- Chris ([@chrisbbreuer](https://github.com/chrisbbreuer))
- Glennmichael123 ([@glennmichael123](https://github.com/glennmichael123))
- Glenn Michael Torregosa ([@glennmichael123](https://github.com/glennmichael123))
- Cab-mikee ([@cab-mikee](https://github.com/cab-mikee))

## v0.1.0...main

[compare changes](https://github.com/stacksjs/localtunnels/compare/v0.1.0...main)

### 🏡 Chore

- Minor adjustments ([980d404](https://github.com/stacksjs/localtunnels/commit/980d404))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## ...main

### 🏡 Chore

- Initial commit ([75da79b](https://github.com/stacksjs/localtunnels/commit/75da79b))
- Wip ([6f98794](https://github.com/stacksjs/localtunnels/commit/6f98794))
- Add initial cloud ([c48fbef](https://github.com/stacksjs/localtunnels/commit/c48fbef))
- Update readme ([6d43613](https://github.com/stacksjs/localtunnels/commit/6d43613))
- Rename to lpx ([4119499](https://github.com/stacksjs/localtunnels/commit/4119499))
- Lint ([594c7cb](https://github.com/stacksjs/localtunnels/commit/594c7cb))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

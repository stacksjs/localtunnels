<p align="center"><img src="https://github.com/stacksjs/localtunnels/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

# A Better Developer Experience

> A zero-config local tunnel that's simple, lightweight, and secure.

## Features

- Simple, lightweight local tunnel
- Security built-in, including HTTPS
- Binary-safe forwarding _(fonts, archives, media & uploads survive byte-for-byte)_
- Standard proxy headers _(`X-Forwarded-For` / `-Host` / `-Proto` for your local app)_
- Smart subdomains _(APP_NAME-aware, memorable random names, auto-collision handling)_
- Auto DNS resolution _(bypasses broken system DNS on macOS `.dev` TLD)_
- Built-in devtools & Prometheus metrics _(per-tunnel request log, `/metrics`, `/status`)_
- WireGuard-style VPN mode _(private layer-3 mesh, powered by a Zig crypto core)_
- Self-hostable anywhere, with IaC deploys via [ts-cloud](https://github.com/stacksjs/ts-cloud) _(AWS & Hetzner today, more providers as ts-cloud grows)_
- CLI & Library

## Quick Start

```bash
# Install
bun install -d localtunnels

# Expose local port 3000
localtunnels start --port 3000
```

```
  Connecting to localtunnel.dev...

  Public:     https://swift-fox.localtunnel.dev
  Forwarding: https://swift-fox.localtunnel.dev -> http://localhost:3000

  Press Ctrl+C to stop sharing
```

## Next Steps

- [Usage](/usage) — the CLI and library in depth
- [Custom Subdomains](/features/custom-subdomains) and [Request Forwarding](/features/forwarding)
- [Self-Hosting](/features/self-hosting) — run your own tunnel server, or deploy to AWS/Hetzner
- [VPN Mode](/features/vpn) — the encrypted layer-3 mesh and exit node
- [API Reference](/api-reference) — full client/server/VPN API

## Changelog

Please see our [releases](https://github.com/stacksjs/localtunnels/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Stargazers

[![Stargazers](https://starchart.cc/stacksjs/localtunnels.svg?variant=adaptive)](https://starchart.cc/stacksjs/localtunnels)

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://stacksjs.com/discord)

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](https://github.com/stacksjs/localtunnels/graphs/contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙

<!-- Badges -->

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/localtunnels/main?style=flat-square -->
<!-- [codecov-href]: https://codecov.io/gh/stacksjs/localtunnels -->

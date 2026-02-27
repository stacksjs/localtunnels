<p align="center"><img src="https://github.com/stacksjs/localtunnels/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

# A Better Developer Experience

> A zero-config local tunnel that's simple, lightweight, and secure.

## Features

- Simple, lightweight local tunnel
- Security built-in, including HTTPS
- Smart subdomains _(APP_NAME-aware, memorable random names, auto-collision handling)_
- Auto DNS resolution _(bypasses broken system DNS on macOS `.dev` TLD)_
- IAC, self-hostable _(via AWS)_
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

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

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

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/localtunnels/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/localtunnels -->

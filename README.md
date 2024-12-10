<p align="center"><img src="https://github.com/stacksjs/localtunnels/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# A Better Developer Experience

> A zero-config local tunnel that's simple, lightweight, and secure.

## Features

- Simple, lightweight local tunnel
- Security built-in, including HTTPS
- IAC, self-hostable _(via AWS)_
- Custom subdomains
- CLI & Library

## Install

```bash
bun install -d localtunnels
```

<!-- _Alternatively, you can install:_

```bash
brew install localtunnels # wip
pkgx install localtunnels # wip
``` -->

## Get Started

There are two ways of using this local tunnel: _as a library or as a CLI._

### Library

Given the npm package is installed:

```ts
import type { LocalTunnelConfig } from 'localtunnels'
import { startLocalTunnel } from 'localtunnels'

const config: LocalTunnelConfig = {
  from: 'localhost:5173',
  domain: 'stacksjs.dev', // optional, defaults to the stacksjs.dev domain
  subdomain: 'test', // optional, uses a random subdomain by default
  verbose: true, // optional, defaults to false
}

startLocalTunnel(config)
```

You may als use a configuration file:

```ts
// tunnel.config.{ts,js}
import type { LocalTunnelConfig } from '@stacksjs/localtunnels'

const config: LocalTunnelConfig = {
  from: 'localhost:5173',
  domain: 'stacksjs.dev', // optional, defaults to the stacksjs.dev domain
  subdomain: 'test', // optional, uses a random subdomain by default
  verbose: true, // optional, defaults to false
}

export default config
```


_Then run:_

```bash
./localtunnels start
```

### CLI

```bash
localtunnels start --from localhost:5173 --subdomain test --verbose
localtunnels --help
localtunnels --version
```

To learn more, head over to the [documentation](https://localtunnels.sh/).

## Testing

```bash
bun test
```

## Changelog

Please see our [releases](https://github.com/stacksjs/localtunnels/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

Two things are true: Stacks OSS will always stay open-source, and we do love to receive postcards from wherever Stacks is used! 🌍 _We also publish them on our website. And thank you, Spatie_

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/localtunnels?style=flat-square
[npm-version-href]: https://npmjs.com/package/localtunnels
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/localtunnels/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/localtunnels/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/localtunnels/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/localtunnels -->

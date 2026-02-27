<p align="center"><img src="https://github.com/stacksjs/localtunnels/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# localtunnels

> A zero-config local tunnel that's simple, lightweight, and secure.

## Features

- Simple, lightweight local tunnel
- Security built-in, including HTTPS
- Smart subdomains _(APP_NAME-aware, memorable random names, auto-collision handling)_
- Auto DNS resolution _(bypasses broken system DNS on macOS `.dev` TLD)_
- IAC, self-hostable _(via AWS)_
- CLI & Library

## Install

```sh
bun install -d localtunnels
```

## Get Started

There are two ways of using this local tunnel: _as a library or as a CLI._

### Library

Given the npm package is installed:

```ts
import { startLocalTunnel } from 'localtunnels'

const client = await startLocalTunnel({
  port: 3000,
  // subdomain: 'myapp', // optional, see Subdomains below
  // verbose: true, // optional
})

console.log(`Tunnel URL: ${client.getTunnelUrl()}`)

// later...
client.disconnect()
```

Or use the `TunnelClient` class directly:

```ts
import { TunnelClient } from 'localtunnels'

const client = new TunnelClient({
  host: 'localtunnel.dev',
  port: 443,
  secure: true,
  localPort: 3000,
})

client.on('connected', (info) => {
  console.log(`Public URL: ${info.url}`)
})

await client.connect()
```

### CLI

```sh
# Expose local port 3000 (default)
localtunnels start

# Expose a specific port
localtunnels start --port 8080

# Request a specific subdomain
localtunnels start --port 3000 --subdomain myapp

# Use a custom tunnel server
localtunnels start --port 3000 --server mytunnel.example.com

# Disable auto DNS resolution
localtunnels start --port 3000 --no-manage-hosts

# Show all requests
localtunnels start --port 3000 --verbose
```

Output:

```
  Connecting to localtunnel.dev...

  Public:     https://swift-fox.localtunnel.dev
  Forwarding: https://swift-fox.localtunnel.dev -> http://localhost:3000

  Press Ctrl+C to stop sharing
```

## Subdomains

localtunnels uses a smart subdomain resolution chain:

1. **Explicit flag**: `--subdomain myapp` or `subdomain: 'myapp'` in code
2. **`APP_NAME` env var**: automatically slugified _(e.g. `My Cool App` becomes `my-cool-app`)_
3. **Random memorable name**: adjective-noun combos like `swift-fox`, `bold-comet`, `lazy-elk`

### Collision Handling

If a subdomain is already in use by another client, localtunnels automatically appends an incrementing suffix:

- `myapp` is taken -> tries `myapp-2`
- `myapp-2` is taken -> tries `myapp-3`
- and so on...

This happens transparently — no crashes, no manual intervention needed.

### Examples

```sh
# Uses APP_NAME env var if set
APP_NAME="My App" localtunnels start --port 3000
# -> https://my-app.localtunnel.dev

# Explicit subdomain
localtunnels start --port 3000 --subdomain demo
# -> https://demo.localtunnel.dev

# Random memorable name (no APP_NAME, no --subdomain)
localtunnels start --port 3000
# -> https://bold-comet.localtunnel.dev
```

## DNS Resolution

On some machines (especially macOS with `.dev` TLD), the system DNS resolver can't reach `localtunnel.dev` even though tools like `dig` and `nslookup` work fine. localtunnels detects this automatically and resolves the server IP via DNS-over-HTTPS (Cloudflare) or `dig @8.8.8.8`, then connects directly to the IP.

This is on by default. Disable with `--no-manage-hosts` or `manageHosts: false`.

## Self-Hosting

Start your own tunnel server:

```sh
localtunnels server --port 8080 --domain mytunnel.example.com
```

Or deploy to AWS:

```sh
localtunnels deploy --domain mytunnel.example.com --key-name my-keypair
```

## Testing

```sh
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

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where `localtunnels` is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States 🌎

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

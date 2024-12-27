# Usage

There are two ways of using this local tunnel: _as a library or as a CLI._

## Library

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

## CLI

```bash
localtunnels start --from localhost:5173 --subdomain test --verbose
localtunnels --help
localtunnels --version
```

# Configuration

`localtunnels` can be configured with the following options:

```ts
// tunnel.config.{ts,js}
import type { LocalTunnelOptions } from 'localtunnels'

const config: LocalTunnelOptions = {
  /**
   * The port to listen on for incoming HTTP requests.
   * We default to 5173 to create a seamless Vite experience.
   * @default 5173
   * @type {number}
   * @example
   * port: 5173
   */
  port: 5173,

  /**
   * The host to listen on for incoming HTTP requests.
   * @default 'localhost'
   * @type {string}
   * @example
   * host: 'localhost'
   */
  host: 'localtunnel.sh',

  /**
   * The subdomain to use for the tunnel.
   * @default null
   * @type {string}
   * @example
   * subdomain: 'my-tunnel'
   */
  subdomain: 'my-tunnel',

  /**
   * Whether to use HTTPS for the tunnel.
   * @default false
   * @type {boolean}
   * @example
   * secure: true
   */
  secure: true,

  /**
   * The port to listen on for incoming HTTPS requests.
   * @default 3443
   * @type {number}
   * @example
   * localPort: 3443
   */
  localPort: 3443,

  /**
   * The host to listen on for incoming HTTPS requests.
   * @default 'localhost'
   * @type {string}
   * @example
   * localHost: 'localhost'
   */
  localHost: 'localhost',

  /**
   * The maximum number of tunnels to allow.
   * @default 4
   * @type {number}
   * @example
   * maxTunnels: 4
   */
  maxTunnels: 4,

  /**
   * The maximum number of requests to allow per tunnel.
   * @default 10
   * @type {number}
   * @example
   * maxRequests: 10
   */
  maxRequests: 10,


  /**
   * SSL private key, certificate, and CA certificate to use for the tunnel.
   * @default null
   * @type {object}
   * @example
   * ssl: {
   *  key: 'path/to/key.pem',
   *  cert: 'path/to/cert.pem',
   *  ca: 'path/to/ca.pem',
   * }
   */
  ssl: {
    key: 'path/to/key.pem',
    cert: 'path/to/cert.pem',
    ca: 'path/to/ca.pem',
  },

  /**
   * Whether to print debug information to the console.
   * @default false
   * @type {boolean}
   * @example
   * verbose: true
   */
  verbose: true,
}

export default config
```

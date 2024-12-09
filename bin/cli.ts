import { CAC } from '@stacksjs/cli'
import { version } from '../package.json'

const cli = new CAC('localtunnels')

interface LocalTunnelOption {
  from: string
  to: string
  keyPath: string
  certPath: string
  caCertPath: string
  etcHostsCleanup: boolean
  verbose: boolean
}

cli
  .command('start', 'Start the Local Tunnel')
  .option('--from <from>', 'The URL to proxy from')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options?: LocalTunnelOption) => {
    console.log('options is', options)
  })

cli.command('version', 'Show the version of the Reverse Proxy CLI').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()

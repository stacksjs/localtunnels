import { log } from '@stacksjs/cli'
import { dts } from 'bun-plugin-dtsx'

log.info('Building...')

await Bun.build({
  entrypoints: ['./src/index.ts', './src/cloud/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  minify: true,
  splitting: true,
  external: ['ts-cloud', '@aws-sdk/*'],
  plugins: [dts()],
})

log.success('Built')

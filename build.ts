import { dts } from 'bun-plugin-dtsx'

console.log('Building...')

await Bun.build({
  entrypoints: ['./src/index.ts', './src/cloud/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  minify: true,
  splitting: true,
  external: ['ts-cloud', '@stacksjs/ts-cloud', '@stacksjs/ts-cloud/*'],
  plugins: [dts()],
})

console.log('Built')

import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dts } from 'bun-plugin-dtsx'

console.log('Building...')

// The npm tarball ships the README and the Zig source of the native VPN core
// (packages/vpn-core in the monorepo) so consumers can `cd native && zig build`
// inside the installed package. Sync both from their in-repo homes; the copies
// are gitignored.
const pkgRoot = import.meta.dir
const vpnCore = join(pkgRoot, '..', 'vpn-core')
rmSync(join(pkgRoot, 'native'), { recursive: true, force: true })
cpSync(join(vpnCore, 'build.zig'), join(pkgRoot, 'native', 'build.zig'))
cpSync(join(vpnCore, 'src'), join(pkgRoot, 'native', 'src'), { recursive: true })
cpSync(join(pkgRoot, '..', '..', 'README.md'), join(pkgRoot, 'README.md'))

await Bun.build({
  entrypoints: ['./src/index.ts', './src/cloud/index.ts', './bin/cli.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  minify: true,
  splitting: true,
  external: ['ts-cloud', '@stacksjs/ts-cloud', '@stacksjs/ts-cloud/*', '@stacksjs/ts-analytics'],
  plugins: [dts()],
})

console.log('Built')

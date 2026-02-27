/**
 * localtunnels benchmark suite
 *
 * Run all benchmarks or pick individual categories:
 *
 *   bun benchmarks/index.ts              # Run all
 *   bun benchmarks/utils.ts              # Utility function microbenchmarks
 *   bun benchmarks/connection.ts         # Connection lifecycle
 *   bun benchmarks/throughput.ts         # Request forwarding throughput
 *   bun benchmarks/latency.ts            # End-to-end latency distribution
 *   bun benchmarks/scalability.ts        # Multi-connection scalability
 *   bun benchmarks/comparison.ts         # Cross-tool comparison
 */
import { $ } from 'bun'

const suites = [
  { name: 'Utility Functions', file: 'utils.ts' },
  { name: 'Connection Lifecycle', file: 'connection.ts' },
  { name: 'Throughput', file: 'throughput.ts' },
  { name: 'Latency', file: 'latency.ts' },
  { name: 'Scalability', file: 'scalability.ts' },
  { name: 'Cross-Tool Comparison', file: 'comparison.ts' },
]

const filter = process.argv[2]
const filtered = filter
  ? suites.filter(s => s.file.includes(filter) || s.name.toLowerCase().includes(filter.toLowerCase()))
  : suites

if (filtered.length === 0) {
  console.error(`No benchmark suite matching "${filter}"`)
  console.error(`Available: ${suites.map(s => s.file).join(', ')}`)
  process.exit(1)
}

console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║              localtunnels benchmark suite                   ║')
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log()
console.log(`Running ${filtered.length} suite(s): ${filtered.map(s => s.name).join(', ')}`)
console.log()

for (const suite of filtered) {
  console.log(`\n${'═'.repeat(64)}`)
  console.log(`  ${suite.name}`)
  console.log(`  bun benchmarks/${suite.file}`)
  console.log(`${'═'.repeat(64)}\n`)

  const result = await $`bun ${import.meta.dir}/${suite.file}`.nothrow()

  if (result.exitCode !== 0) {
    console.error(`\n  Suite "${suite.name}" exited with code ${result.exitCode}\n`)
  }
}

console.log('\nAll benchmarks complete.')

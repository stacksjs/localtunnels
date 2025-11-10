import type { ESLintConfig } from '@stacksjs/eslint-config'
import stacks from '@stacksjs/eslint-config'

const config: ESLintConfig = stacks({
  stylistic: {
    indent: 2,
    quotes: 'single',
  },

  typescript: true,
  jsonc: true,
  yaml: true,
  ignores: [
    'fixtures/**',
    '**/logger.md',
    'CHANGELOG.md',
  ],
  // Temporarily disable due to @stylistic/eslint-plugin crash in tests
  rules: {
    'style/indent': 'off',
    '@stylistic/indent': 'off',
  },
})

export default config
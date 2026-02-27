import type { BunpressConfig } from 'bunpress'

const config: BunpressConfig = {
  name: 'localtunnels',
  description: 'A simple and smart tunneling alternative',
  url: 'https://localtunnels.sh',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'keywords', content: 'local, tunnel, self-hosted, bun, typescript, javascript' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Docs', link: '/intro' },
      { text: 'GitHub', link: 'https://github.com/stacksjs/localtunnels' },
    ],

    sidebar: [
      {
        text: 'Get Started',
        items: [
          { text: 'Introduction', link: '/intro' },
          { text: 'Installation', link: '/install' },
          { text: 'Usage', link: '/usage' },
          { text: 'Configuration', link: '/config' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Local Tunneling', link: '/features/local-tunneling' },
          { text: 'Custom Subdomains', link: '/features/custom-subdomains' },
          { text: 'HTTPS Support', link: '/features/https-support' },
          { text: 'Self-Hosting', link: '/features/self-hosting' },
        ],
      },
      {
        text: 'Advanced',
        items: [
          { text: 'Configuration', link: '/advanced/configuration' },
          { text: 'Server Setup', link: '/advanced/server-setup' },
          { text: 'Performance', link: '/advanced/performance' },
          { text: 'Benchmarks', link: '/benchmarks' },
          { text: 'CI/CD Integration', link: '/advanced/ci-cd-integration' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/stacksjs/localtunnels' },
    ],
  },
}

export default config

import type { BunpressConfig } from 'bunpress'

const config: BunpressConfig = {
  name: 'localtunnels',
  description: 'A simple and smart tunneling alternative',
  url: 'https://localtunnel.dev',

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
          { text: 'Request Forwarding', link: '/features/forwarding' },
          { text: 'HTTPS Support', link: '/features/https-support' },
          { text: 'WebSocket Support', link: '/features/websocket' },
          { text: 'Self-Hosting', link: '/features/self-hosting' },
          { text: 'VPN Mode', link: '/features/vpn' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Reference', link: '/api-reference' },
          { text: 'Configuration', link: '/config' },
        ],
      },
      {
        text: 'Advanced',
        items: [
          { text: 'Configuration', link: '/advanced/configuration' },
          { text: 'Client Config', link: '/advanced/client-config' },
          { text: 'Server Setup', link: '/advanced/server-setup' },
          { text: 'VPN Deployment', link: '/advanced/vpn-deployment' },
          { text: 'Security', link: '/advanced/security' },
          { text: 'Performance', link: '/advanced/performance' },
          { text: 'Benchmarks', link: '/benchmarks' },
          { text: 'Troubleshooting', link: '/advanced/troubleshooting' },
          { text: 'CI/CD Integration', link: '/advanced/ci-cd-integration' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/stacksjs/localtunnels' },
    ],
  },

  analytics: {
    enabled: true,
    siteId: 'localtunnel-dev',
    apiEndpoint: 'https://analytics.stacksjs.com',
    trackOutboundLinks: true,
    honorDNT: true,
  },

  cloud: {
    region: 'us-east-1',
    domain: 'localtunnel.dev',
    dnsProvider: {
      provider: 'porkbun',
    },
  },
}

export default config

import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/OfflineSync/',
  title: 'OfflineSync',
  description: 'Local-first synchronization engine for applications that work offline',
  lang: 'en',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/OfflineSync/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#6366f1' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'OfflineSync' }],
    ['meta', { name: 'og:description', content: 'Local-first synchronization engine for applications that work offline' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'OfflineSync',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/core' },
      {
        text: 'Packages',
        items: [
          { text: '@offlinesync/core', link: '/api/core' },
          { text: '@offlinesync/protocol', link: '/api/protocol' },
          { text: '@offlinesync/storage', link: '/api/storage' },
          { text: '@offlinesync/conflict', link: '/api/conflict' },
          { text: '@offlinesync/transport-http', link: '/api/transport-http' },
          { text: '@offlinesync/transport-websocket', link: '/api/transport-websocket' },
          { text: '@offlinesync/storage-sqlite', link: '/api/storage-sqlite' },
          { text: '@offlinesync/server', link: '/api/server' },
          { text: '@offlinesync/discovery', link: '/api/discovery' },
          { text: '@offlinesync/react', link: '/api/react' },
          { text: '@offlinesync/vue', link: '/api/vue' },
          { text: '@offlinesync/electron', link: '/api/electron' },
        ],
      },
      {
        text: 'GitHub',
        link: 'https://github.com/BgAmine14/OfflineSync',
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Invariants', link: '/guide/invariants' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'Core',
          items: [
            { text: '@offlinesync/core', link: '/api/core' },
            { text: '@offlinesync/protocol', link: '/api/protocol' },
            { text: '@offlinesync/storage', link: '/api/storage' },
            { text: '@offlinesync/conflict', link: '/api/conflict' },
          ],
        },
        {
          text: 'Transports',
          items: [
            { text: 'transport-http', link: '/api/transport-http' },
            { text: 'transport-websocket', link: '/api/transport-websocket' },
          ],
        },
        {
          text: 'Storage & Server',
          items: [
            { text: 'storage-sqlite', link: '/api/storage-sqlite' },
            { text: '@offlinesync/server', link: '/api/server' },
            { text: '@offlinesync/discovery', link: '/api/discovery' },
          ],
        },
        {
          text: 'Integrations',
          items: [
            { text: '@offlinesync/react', link: '/api/react' },
            { text: '@offlinesync/vue', link: '/api/vue' },
            { text: '@offlinesync/electron', link: '/api/electron' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/BgAmine14/OfflineSync' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2025 OfflineSync Contributors',
    },
    search: {
      provider: 'local',
    },
  },
})

import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ra',
  description: 'raw agent. role agent. run-anything agent.',
  base: '/ra/',
  appearance: 'dark',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/getting-started/install' },
      { text: 'Config', link: '/configuration/' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Install', link: '/getting-started/install' },
          { text: 'Quick Start', link: '/getting-started/quick-start' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'What is ra?', link: '/concepts/' },
          { text: 'Layered Config', link: '/concepts/config' },
          { text: 'Providers', link: '/concepts/providers' },
        ],
      },
      {
        text: 'Modes',
        items: [
          { text: 'CLI (one-shot)', link: '/modes/cli' },
          { text: 'REPL', link: '/modes/repl' },
          { text: 'HTTP Server', link: '/modes/http' },
          { text: 'MCP Server', link: '/modes/mcp' },
        ],
      },
      {
        text: 'Configuration',
        items: [
          { text: 'Reference', link: '/configuration/' },
        ],
      },
      {
        text: 'Providers',
        items: [
          { text: 'Anthropic', link: '/providers/anthropic' },
          { text: 'OpenAI', link: '/providers/openai' },
          { text: 'Azure OpenAI', link: '/providers/azure' },
          { text: 'Google Gemini', link: '/providers/google' },
          { text: 'Ollama', link: '/providers/ollama' },
          { text: 'AWS Bedrock', link: '/providers/bedrock' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Skills', link: '/skills/' },
          { text: 'Middleware', link: '/middleware/' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'HTTP API', link: '/api/' },
          { text: 'Recipes', link: '/recipes/' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/chinmaymk/ra' },
    ],
    search: { provider: 'local' },
  },
})

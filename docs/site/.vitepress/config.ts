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
        text: 'Core',
        items: [
          { text: 'What is ra?', link: '/concepts/' },
          { text: 'The Agent Loop', link: '/core/agent-loop' },
          { text: 'Context Control', link: '/core/context-control' },
          { text: 'Sessions', link: '/core/sessions' },
        ],
      },
      {
        text: 'Interfaces',
        items: [
          { text: 'CLI (one-shot)', link: '/modes/cli' },
          { text: 'REPL', link: '/modes/repl' },
          { text: 'HTTP Server', link: '/modes/http' },
          { text: 'MCP', link: '/modes/mcp' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Built-in Tools', link: '/tools/' },
          { text: 'Skills', link: '/skills/' },
          { text: 'Middleware', link: '/middleware/' },
          { text: 'File Attachments', link: '/core/file-attachments' },
        ],
      },
      {
        text: 'Providers',
        items: [
          { text: 'Anthropic', link: '/providers/anthropic' },
          { text: 'OpenAI', link: '/providers/openai' },
          { text: 'Azure OpenAI', link: '/providers/azure' },
          { text: 'Google Gemini', link: '/providers/google' },
          { text: 'AWS Bedrock', link: '/providers/bedrock' },
          { text: 'Ollama', link: '/providers/ollama' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration', link: '/configuration/' },
          { text: 'HTTP API', link: '/api/' },
          { text: 'Recipes', link: '/recipes/' },
          { text: 'Dynamic Prompts', link: '/recipes/dynamic-prompts' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/chinmaymk/ra' },
    ],
    search: { provider: 'local' },
  },
})

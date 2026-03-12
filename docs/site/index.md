---
layout: home

hero:
  name: "ra"
  text: "An agent you can take apart and put back together."
  tagline: One binary. Nothing hidden behind abstractions you can't reach.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/install
    - theme: alt
      text: Quick Start
      link: /getting-started/quick-start

features:
  - title: No System Prompt Included
    details: ra ships empty. Every part of the loop is exposed via config and extended by writing scripts or plain TypeScript. You define the agent, not us.
  - title: Six Providers, Same Code
    details: Anthropic, OpenAI, Google, Ollama, Bedrock, Azure. Switch with a flag — your agent code doesn't change.
  - title: MCP Both Ways
    details: Connect to MCP servers for additional tools, or expose ra itself as an MCP server for Cursor, Claude Desktop, or anything else that speaks the protocol.
  - title: Real Context Control
    details: Deterministic context discovery, pattern resolution, prompt caching, compaction, token tracking, skills. You decide what the model sees.
  - title: Middleware Hooks Everywhere
    details: Intercept model calls, tool execution, streaming chunks, errors — 9 hooks covering every step of the loop. Inline expressions or TypeScript files.
  - title: One Binary, Four Interfaces
    details: CLI, REPL, HTTP server, MCP server. Single self-contained binary. No runtime dependencies.
---

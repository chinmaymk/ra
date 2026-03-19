Documentation site built with VitePress.

**Building:**
```bash
cd docs/site && bun install && bun run build
```

**Structure:**
```
docs/
  site/              # VitePress site source
    index.md         # Landing page
    getting-started/ # Setup and quickstart guides
    core/            # Core concepts (loop, messages, tools)
    providers/       # Provider-specific docs
    tools/           # Built-in tool reference
    skills/          # Skill authoring guide
    middleware/      # Middleware hook reference
    recipes/         # Recipe walkthroughs
    configuration/   # Config file reference
    observability/   # Logging and tracing
    api/             # API reference
    modes/           # Interface modes (CLI, REPL, HTTP, MCP)
    concepts/        # Architecture concepts
    permissions/     # Permission model
    public/          # Static assets
  demo.gif           # Demo animation
  observability.md   # Observability overview
  plans/             # Design documents
```

**Conventions:**
- Use VitePress markdown features (frontmatter, containers, code groups)
- Keep docs in sync with code changes — if you change behavior, update the relevant doc page

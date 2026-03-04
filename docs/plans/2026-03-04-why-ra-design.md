# Why ra? — Content Design

**Date:** 2026-03-04
**Status:** Approved

## Problem

The existing "Why ra?" sections in both README and docs are abstract — they talk about config-driven identity but don't show *why* that matters in practice. The key differentiator (one binary, four interfaces for four different contexts) isn't made tangible.

## Approach

Problem-solution framing with real-world scenarios. Each scenario maps to an interface:

1. **CI caught a flaky test** → CLI (one-shot, scriptable)
2. **You're building a feature** → REPL (interactive, stateful)
3. **Your product needs AI** → HTTP API (streaming server)
4. **Your editor needs a specialist** → MCP server (agent-to-agent)

## Deliverables

### README (`README.md`, lines 46-54)

Short version — problem statement + 4 bullet scenarios with commands. ~10 lines. Replaces existing "Why ra?" section.

### Docs site (`docs/site/concepts/index.md`, lines 14-20)

Expanded version — same 4 scenarios, each with a heading, a code block, and 1-2 sentences of context. Replaces existing "Why ra?" section on the concepts page.

## Design Principle

- Lead with the problem (AI tools are single-purpose)
- Show real scenarios, not abstract capabilities
- Every scenario includes the actual `ra` command
- Close with the punchline: "Same config. Same skills. Same binary. The interface changes, the agent doesn't."

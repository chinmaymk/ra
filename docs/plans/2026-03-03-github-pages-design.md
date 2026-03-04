# GitHub Pages Documentation Site — Design

**Date:** 2026-03-03
**Status:** Approved

## Overview

Add a VitePress-based documentation site to the `ra` repository, deployed to GitHub Pages via GitHub Actions. The site migrates existing README content into structured pages and adds stubs for topics not yet covered.

## Goals

- Comprehensive, navigable documentation that showcases all ra features
- Agent-friendly: a "copy page" button on every page copies raw markdown content to clipboard
- Automatically deployed on push to `main`

## Repository Structure

```
docs/
  site/                          ← VitePress project root
    .vitepress/
      config.ts                  ← Nav, sidebar, theme config
      theme/
        index.ts                 ← Custom theme registration
        CopyPageButton.vue       ← Copy-page component
        style.css                ← Theme overrides
    public/                      ← Static assets (logo, favicon)
    getting-started/
      install.md
      quick-start.md
    concepts/
      index.md                   ← What ra is, philosophy
      config.md                  ← Layered config system
      providers.md               ← Provider overview
    modes/
      cli.md                     ← One-shot CLI
      repl.md                    ← Interactive REPL
      http.md                    ← HTTP server mode
      mcp.md                     ← MCP server mode
    configuration/
      index.md                   ← Full config reference (all fields, env vars, file formats)
    providers/
      anthropic.md
      openai.md
      google.md
      ollama.md
      bedrock.md
    skills/
      index.md
    middleware/
      index.md
    api/
      index.md                   ← HTTP API reference
    recipes/
      index.md
    index.md                     ← Landing page
```

## Copy Page Button

A fixed button (top-right, above table of contents) on every page that copies the page's raw markdown to clipboard — not rendered HTML — so agents can ingest full structured content including code blocks, headings, and links.

**Implementation:** A VitePress plugin inlines each page's raw markdown as a virtual module. `CopyPageButton.vue` reads it via `useData()` and writes it to clipboard on click. Shows a "Copied!" tooltip on success.

## GitHub Actions Deployment

- Workflow: `.github/workflows/docs.yml`
- Trigger: push to `main`, path filter `docs/site/**`
- Steps: `bun install` → `bunx vitepress build docs/site` → deploy `docs/site/.vitepress/dist` to `gh-pages` branch via `peaceiris/actions-gh-pages`
- Served at: `https://chinmaymk.github.io/ra/`

## Content Strategy

Option B: migrate existing README content into the appropriate pages. Pages with good README coverage (install, quick start, HTTP API, MCP, layered config) will be nearly complete. Pages without README coverage (skills, middleware, recipes, per-provider setup) will be stubs with clear outlines.

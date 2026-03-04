# Docs Theme: Solarized Dark Design

**Date:** 2026-03-04
**Status:** Approved

## Goal

Apply Solarized Dark theme to the VitePress docs site with cyan (`#2aa198`) as the brand accent color.

## Changes

### 1. `docs/site/.vitepress/theme/style.css`

Full Solarized Dark CSS variable overrides:

- **Backgrounds:** base03 `#002b36` (main), base02 `#073642` (surfaces/sidebar), base02 slightly lighter for muted
- **Text:** base0 `#839496` (body), base1 `#93a1a1` (emphasis), base01 `#586e75` (secondary/comments)
- **Brand:** cyan `#2aa198` (links, active states, buttons), slightly darker cyan for hover
- **Borders/dividers:** base02 `#073642`
- **Code blocks:** base03 background, base0 text
- **Tip/warning/danger containers:** use Solarized yellow `#b58900`, orange `#cb4b16`, red `#dc322f`

JetBrains Mono loaded via Google Fonts `@import` for `--vp-font-family-mono`.

### 2. `docs/site/.vitepress/config.ts`

- Set `appearance: 'dark'` to default to dark mode
- Add `head` array with Google Fonts preconnect + JetBrains Mono stylesheet link

### 3. `docs/site/public/logo.svg`

Simple `>_` terminal prompt glyph. Cyan `#2aa198` on transparent background. ~32×32px, fits nav bar.

### 4. Copy-page button

Minor tweak to `CopyPageButton.vue` — no change needed, it already uses `--vp-c-brand-1` and `--vp-c-text-2` CSS vars which will automatically pick up the Solarized cyan.

## Solarized Dark Palette Reference

| Name | Hex | Use |
|------|-----|-----|
| base03 | `#002b36` | Main background |
| base02 | `#073642` | Surface, sidebar, code bg |
| base01 | `#586e75` | Secondary text, comments |
| base0 | `#839496` | Body text |
| base1 | `#93a1a1` | Emphasis text |
| cyan | `#2aa198` | Brand, links, active |
| yellow | `#b58900` | Warnings |
| orange | `#cb4b16` | Danger |
| red | `#dc322f` | Errors |
| blue | `#268bd2` | Info |

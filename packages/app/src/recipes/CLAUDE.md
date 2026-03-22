# src/recipes/

Recipe installation, resolution, and management.

## Files

| File | Purpose |
|------|---------|
| `registry.ts` | `installRecipe()`, `removeRecipe()`, `listInstalledRecipes()`, `resolveRecipePath()` |
| `types.ts` | Re-exports `RegistrySource` as `RecipeSource` |

## Recipe Discovery

When installing from a tarball, recipes are found via `findRecipeDirsIn()`:

1. Scan `recipes/<name>/ra.config.*` (multi-recipe repo convention)
2. Fallback: root-level `ra.config.*` (single-recipe repo)

## Installed Layout

```
~/.ra/recipes/
  owner/
    recipe-name/
      ra.config.yaml
      skills/
      .source.json     # install metadata
```

## Usage

Recipes are loaded at config time via `--recipe` flag or `agent.recipe` in config file.
The config loader (`config/index.ts`) resolves installed recipes by name and merges
their config as a base layer: defaults < recipe < file < CLI.

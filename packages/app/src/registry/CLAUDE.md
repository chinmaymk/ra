# src/registry/

Shared helpers for skill and recipe installation from npm, GitHub, or URL sources.

## Files

| File | Purpose |
|------|---------|
| `helpers.ts` | `parseSource()`, `withTempExtract()`, `copyAndWriteSource()`, `resolveNpmTarball()`, shared types |

## Key Types

- `SourceInfo` — parsed source string: `{ registry, identifier, version? }`
- `RegistrySource` — metadata written to `.source.json` after install
- `CONFIG_FILES` — ordered list of config filenames (`ra.config.yaml`, etc.)

## Source String Formats

```
github:owner/repo       → GitHub tarball
npm:package[@version]   → npm registry
https://...             → raw URL
owner/repo              → defaults to GitHub
```

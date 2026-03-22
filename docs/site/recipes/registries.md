# Recipe & Skill Registries

Both recipes and skills can be installed from GitHub, npm, or URL sources. They share the same registry infrastructure.

## Source formats

| Format | Example | Description |
|--------|---------|-------------|
| Bare name | `user/repo` | Defaults to GitHub |
| `github:` | `github:user/repo` | Explicit GitHub |
| `npm:` | `npm:package-name` | npm registry |
| `npm:` with version | `npm:package@1.2.3` | npm with pinned version |
| `npm:` scoped | `npm:@scope/package` | Scoped npm package |
| URL | `https://example.com/archive.tgz` | Direct tarball download |

## Recipe registry

### Install

```bash
ra recipe install chinmaymk/ra              # GitHub repo with recipes/ folder
ra recipe install npm:ra-recipe-review       # npm package
ra recipe install https://example.com/r.tgz  # URL tarball
```

### Multi-recipe repos

GitHub repos and npm packages can contain multiple recipes. The installer looks for:

1. `recipes/<name>/ra.config.{yaml,yml,json,toml}` — each subdirectory becomes a separate recipe
2. Root-level `ra.config.*` — fallback for single-recipe repos

```
my-repo/
  recipes/
    coding-agent/
      ra.config.yaml     → installed as owner/coding-agent
    review-agent/
      ra.config.yaml     → installed as owner/review-agent
```

### List & remove

```bash
ra recipe list
ra recipe remove chinmaymk/coding-agent
```

### Install directory

Recipes are stored in `~/.ra/recipes/` with the structure `owner/name/`.

## Skill registry

### Install

```bash
ra skill install user/repo                   # GitHub (default)
ra skill install npm:ra-skill-lint@1.2.3     # npm with version
ra skill install https://example.com/s.tgz   # URL tarball
```

### Multi-skill repos

Skill repos can contain multiple skills. The installer looks for:

1. `skills/<name>/SKILL.md` — standard convention
2. `<name>/SKILL.md` — top-level subdirectories
3. Root `SKILL.md` — fallback for single-skill repos

### List & remove

```bash
ra skill list
ra skill remove code-review
```

### Install directory

Skills are stored in `~/.ra/skills/` with a flat `name/` structure.

## .source.json

Both registries write a `.source.json` file alongside installed content for tracking:

```json
{
  "registry": "github",
  "repo": "chinmaymk/ra",
  "installedAt": "2026-03-22T12:00:00.000Z"
}
```

This metadata is displayed by `ra recipe list` and `ra skill list`.

## See also

- [Recipes](/recipes/) — creating and using recipes
- [Skills](/skills/) — creating and using skills
- [Configuration](/configuration/) — `skillDirs` and `agent.recipe` settings

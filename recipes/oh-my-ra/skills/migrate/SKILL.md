---
name: migrate
description: Guided migration for version upgrades, framework changes, and API transitions. Creates a step-by-step migration plan with rollback points. Use for major dependency upgrades, framework migrations, or API version transitions.
---

You guide migrations safely — version upgrades, framework changes, API transitions. Every step has a rollback point. Nothing breaks in production.

## When to Use

- Major dependency upgrade (e.g., React 17 → 18, Node 18 → 22, Python 3.9 → 3.12)
- Framework migration (e.g., Express → Hono, Jest → Vitest, Webpack → Vite)
- API version transition (e.g., REST → GraphQL, v1 → v2)
- Language/runtime change (e.g., JavaScript → TypeScript, npm → Bun)
- Database migration (e.g., schema changes, ORM switch)

## Process

### 1. Assess the Migration

Before touching any code:

```
## Migration Assessment

### From → To
[Current state] → [Target state]

### Scope
- Files affected: [estimate]
- Breaking changes: [list from changelog/migration guide]
- Dependencies that need updating: [list]
- Estimated risk: [low / medium / high]

### Breaking Changes Inventory
1. [Breaking change 1] — affects [files/modules]
2. [Breaking change 2] — affects [files/modules]

### Migration Guide
[Link to official migration guide if one exists]
```

Research:
- Read the official migration guide / changelog
- Check for codemods (automated migration scripts)
- Identify all breaking changes
- Find affected files with Grep/Glob

### 2. Create Migration Plan

Break the migration into phases. Each phase must:
- Be independently deployable (or at least independently testable)
- Have a rollback strategy
- Not break existing functionality

**Template:**
```
## Migration Plan: [From] → [To]

### Phase 1: Preparation (no behavior changes)
- [ ] Create migration branch
- [ ] Update dev dependencies (types, tooling)
- [ ] Run existing tests — establish baseline
- Rollback: git revert

### Phase 2: Compatibility Layer
- [ ] Add compatibility shims where needed
- [ ] Update code to work with both old and new API
- [ ] Verify tests still pass
- Rollback: git revert

### Phase 3: Core Migration
- [ ] Update the main dependency
- [ ] Apply codemods if available
- [ ] Fix remaining breaking changes manually
- [ ] Run tests, fix failures
- Rollback: git revert to Phase 2

### Phase 4: Cleanup
- [ ] Remove compatibility shims
- [ ] Remove deprecated API usage
- [ ] Update documentation
- [ ] Full test suite
- Rollback: git revert to Phase 3

### Phase 5: Verification
- [ ] Full test suite passes
- [ ] Build succeeds
- [ ] Manual smoke test
- [ ] Performance check (no regressions)
```

### 3. Execute Phase by Phase

For each phase:
1. Create a checkpoint: `git commit` or `git stash`
2. Make the changes
3. Run tests
4. If tests pass → commit and move to next phase
5. If tests fail → fix or rollback

### 4. Handle Breaking Changes

For each breaking change:
1. Find all usages: `Grep` for the old API
2. Understand the new API from docs
3. Update each usage
4. Verify each file compiles/passes

Use Agent tool to parallelize finding usages across the codebase.

### 5. Final Verification

- Full test suite passes
- Build succeeds
- No deprecation warnings
- Performance is not degraded
- Documentation is updated

## Patterns

### Strangler Fig (gradual migration)
Keep both old and new code running. Route traffic gradually to new code. Remove old code when fully migrated.

### Adapter Pattern
Create an adapter that makes new API look like old API. Migrate callers one by one. Remove adapter when all callers are migrated.

### Codemod First
Check if an automated codemod exists:
```bash
# React codemods
npx @react-codemod/rename-unsafe-lifecycles
# TypeScript codemods  
npx jscodeshift -t transform.ts src/
```

## Rules

- **Never migrate and add features simultaneously** — one concern at a time
- **Phase boundaries are commit points** — every phase ends with a working, committed state
- **Test after every change** — not after every phase, after every change
- **Read the migration guide first** — don't discover breaking changes by trial and error
- **Keep the rollback path clear** — if you can't roll back, you're moving too fast
- **Codemods before manual changes** — automate what you can
- **Update lockfiles** — commit `package-lock.json` / `bun.lock` changes

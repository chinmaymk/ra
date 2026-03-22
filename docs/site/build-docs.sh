#!/usr/bin/env bash
set -euo pipefail

# Build the full versioned documentation site.
# Works locally (bun run preview) and in CI (deploy step).
#
# Usage:
#   ./build-docs.sh          # build everything
#   ./build-docs.sh preview  # build + start preview server

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
SITE_DIR="$SCRIPT_DIR"
DIST_DIR="$SITE_DIR/.vitepress/dist"
MIN_VERSION="0.0.1"

version_gte() {
  [ "$(printf '%s\n%s' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

# ── Collect tags ──────────────────────────────────────────────────────
TAGS=$(git -C "$REPO_ROOT" tag -l 'v*' --sort=-version:refname)
LATEST=""
for tag in $TAGS; do
  v="${tag#v}"
  if version_gte "$MIN_VERSION" "$v"; then
    [ -z "$LATEST" ] && LATEST="$v"
  fi
done

echo "Latest version: ${LATEST:-<none>}"

# ── Install deps ──────────────────────────────────────────────────────
(cd "$SITE_DIR" && bun install --frozen-lockfile 2>/dev/null || bun install)

# ── Build root docs (latest release label, or dev) ────────────────────
echo "Building root docs..."
rm -rf "$DIST_DIR"
DOCS_VERSION="${LATEST:-dev}" bun vitepress build "$SITE_DIR"

# ── Build dev docs ────────────────────────────────────────────────────
echo "Building dev docs..."
DEV_DIST=$(mktemp -d)
DOCS_VERSION="dev" DOCS_BASE="/ra/dev/" bun vitepress build "$SITE_DIR"
cp -r "$DIST_DIR/"* "$DEV_DIST/"
rm -rf "$DIST_DIR"

# Restore root build, then add dev under /dev/
DOCS_VERSION="${LATEST:-dev}" bun vitepress build "$SITE_DIR"
mkdir -p "$DIST_DIR/dev"
cp -r "$DEV_DIST/"* "$DIST_DIR/dev/"
rm -rf "$DEV_DIST"

# ── Build versioned docs from tags ────────────────────────────────────
VERSION_LIST=""

for tag in $TAGS; do
  version="${tag#v}"

  if ! version_gte "$MIN_VERSION" "$version"; then
    echo "Skipping $tag (below $MIN_VERSION)"
    continue
  fi

  echo "Building docs for $tag..."

  TAG_DIR=$(mktemp -d)
  if git -C "$REPO_ROOT" archive "$tag" -- docs/site/ 2>/dev/null \
      | tar -x -C "$TAG_DIR" 2>/dev/null \
      && [ -f "$TAG_DIR/docs/site/package.json" ]; then
    echo "  Using docs/site/ from $tag"
  else
    echo "  Tag $tag has no docs/site/ — using current source"
    rm -rf "$TAG_DIR"
    TAG_DIR=$(mktemp -d)
    git -C "$REPO_ROOT" archive HEAD -- docs/site/ | tar -x -C "$TAG_DIR"
  fi

  # Use current theme so version picker works everywhere
  rm -rf "$TAG_DIR/docs/site/.vitepress/theme"
  cp -r "$SITE_DIR/.vitepress/theme" "$TAG_DIR/docs/site/.vitepress/theme"

  # Ensure the tag's config supports DOCS_BASE and DOCS_VERSION env vars.
  # If it has a hardcoded base, patch it. If it already reads the env var, no-op.
  TAG_CONFIG="$TAG_DIR/docs/site/.vitepress/config.ts"
  if [ -f "$TAG_CONFIG" ]; then
    if ! grep -q 'DOCS_BASE' "$TAG_CONFIG"; then
      sed -i "s|base: '/ra/'|base: process.env.DOCS_BASE || '/ra/'|" "$TAG_CONFIG"
    fi
    if ! grep -q 'DOCS_VERSION' "$TAG_CONFIG"; then
      # Add vite define block if not present
      sed -i "/base:/a\\
  vite: { define: { __DOCS_VERSION__: JSON.stringify(process.env.DOCS_VERSION || 'dev') } }," "$TAG_CONFIG"
    fi
  else
    # Tag has no config — use current one
    cp "$SITE_DIR/.vitepress/config.ts" "$TAG_CONFIG"
  fi

  if (cd "$TAG_DIR/docs/site" && bun install && DOCS_VERSION="$version" DOCS_BASE="/ra/v/${version}/" bun vitepress build); then
    mkdir -p "$DIST_DIR/v/$version"
    cp -r "$TAG_DIR/docs/site/.vitepress/dist/"* "$DIST_DIR/v/$version/"
    echo "  Done: v$version"

    if [ -n "$VERSION_LIST" ]; then
      VERSION_LIST="${VERSION_LIST},\"${version}\""
    else
      VERSION_LIST="\"${version}\""
    fi
  else
    echo "  Warning: build failed for $tag, skipping"
  fi

  rm -rf "$TAG_DIR"
done

# ── Write versions.json ──────────────────────────────────────────────
echo "{\"latest\":\"${LATEST}\",\"versions\":[${VERSION_LIST}]}" > "$DIST_DIR/versions.json"
echo "versions.json: latest=${LATEST} versions=[${VERSION_LIST}]"

echo ""
echo "Build complete: $DIST_DIR"

# ── Optional preview ──────────────────────────────────────────────────
if [ "${1:-}" = "preview" ]; then
  echo "Starting preview server..."
  bun vitepress preview "$SITE_DIR"
fi

#!/usr/bin/env bash
#
# Build the docs site locally with versioned output, matching CI (docs-deploy.yml).
# Usage: ./build-versioned.sh [--skip-tags]
#   --skip-tags  Only build dev + root (skip per-tag versioned builds)
#
# After running:  bun vitepress preview
#
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT=$(git -C . rev-parse --show-toplevel)
SKIP_TAGS=false
[[ "${1:-}" == "--skip-tags" ]] && SKIP_TAGS=true

# --- Determine latest tag ---
LATEST_TAG=$(git -C "$REPO_ROOT" tag -l 'v*' --sort=-version:refname | head -n1 || true)
LATEST_VERSION="${LATEST_TAG#v}"
echo "Latest tag: ${LATEST_TAG:-<none>}  version: ${LATEST_VERSION:-<none>}"

# --- Write versions.json early so config.ts can read it during builds ---
TAGS=$(git -C "$REPO_ROOT" tag -l 'v*' --sort=-version:refname)
first=true
VERSION_LIST=""
for tag in $TAGS; do
  version="${tag#v}"
  if [[ "$first" == true ]]; then
    VERSION_LIST="\"${version}\""
    first=false
  else
    VERSION_LIST="${VERSION_LIST},\"${version}\""
  fi
done

mkdir -p .vitepress/dist
echo "{\"latest\":\"${LATEST_VERSION}\",\"versions\":[${VERSION_LIST}]}" > .vitepress/dist/versions.json
echo "==> versions.json: $(cat .vitepress/dist/versions.json)"

# --- Build dev docs ---
echo ""
echo "==> Building dev docs..."
DOCS_BASE="/ra/dev/" DOCS_VERSION="dev" bun vitepress build
mv .vitepress/dist /tmp/dev-docs-dist

# --- Build root (latest release label) ---
echo ""
echo "==> Building root docs (version label: ${LATEST_VERSION:-dev})..."
mkdir -p .vitepress/dist
cp /tmp/dev-docs-dist/versions.json .vitepress/dist/versions.json 2>/dev/null || true
DOCS_VERSION="${LATEST_VERSION:-dev}" bun vitepress build
mkdir -p /tmp/root-docs-dist
cp -r .vitepress/dist/* /tmp/root-docs-dist/
rm -rf .vitepress/dist

# --- Build versioned docs from tags ---
mkdir -p /tmp/versioned-docs-dist

if [[ "$SKIP_TAGS" == false && -n "$LATEST_TAG" ]]; then
  for tag in $TAGS; do
    version="${tag#v}"

    if [[ -d "/tmp/versioned-docs-dist/$version" ]]; then
      echo "Cache hit for $tag — skipping"
      continue
    fi

    echo ""
    echo "==> Building docs for $tag..."
    TAG_DIR=$(mktemp -d)

    if git -C "$REPO_ROOT" archive "$tag" -- docs/site/ 2>/dev/null \
       | tar -x -C "$TAG_DIR" 2>/dev/null \
       && [[ -f "$TAG_DIR/docs/site/package.json" ]]; then
      echo "  Using docs/site/ from $tag"
    else
      echo "  Tag $tag has no docs/site/ — using current source"
      rm -rf "$TAG_DIR"
      TAG_DIR=$(mktemp -d)
      git -C "$REPO_ROOT" archive HEAD -- docs/site/ | tar -x -C "$TAG_DIR"
    fi

    # Copy current theme + config so version nav works in old docs
    rm -rf "$TAG_DIR/docs/site/.vitepress/theme"
    cp -r .vitepress/theme "$TAG_DIR/docs/site/.vitepress/theme"
    cp .vitepress/config.ts "$TAG_DIR/docs/site/.vitepress/config.ts"
    # Provide versions.json so config can build the nav dropdown
    mkdir -p "$TAG_DIR/docs/site/.vitepress/dist"
    cp /tmp/dev-docs-dist/versions.json "$TAG_DIR/docs/site/.vitepress/dist/versions.json"

    (cd "$TAG_DIR/docs/site" && bun install && \
     DOCS_BASE="/ra/v/${version}/" DOCS_VERSION="$version" bun vitepress build) || {
      echo "  Warning: build failed for $tag, skipping"
      rm -rf "$TAG_DIR"
      continue
    }

    mkdir -p "/tmp/versioned-docs-dist/$version"
    cp -r "$TAG_DIR/docs/site/.vitepress/dist/"* "/tmp/versioned-docs-dist/$version/"
    rm -rf "$TAG_DIR"
    echo "  Done: v$version"
  done
else
  echo ""
  echo "==> Skipping per-tag builds (${SKIP_TAGS:+--skip-tags}${SKIP_TAGS:- no tags found})"
fi

# --- Assemble site ---
echo ""
echo "==> Assembling final site..."
mkdir -p .vitepress/dist
cp -r /tmp/root-docs-dist/* .vitepress/dist/

# Dev docs
mkdir -p .vitepress/dist/dev
cp -r /tmp/dev-docs-dist/* .vitepress/dist/dev/

# Versioned docs
for tag in $TAGS; do
  version="${tag#v}"
  if [[ -d "/tmp/versioned-docs-dist/$version" ]]; then
    mkdir -p ".vitepress/dist/v/$version"
    cp -r "/tmp/versioned-docs-dist/$version/"* ".vitepress/dist/v/$version/"
  fi
done

# Ensure versions.json is in final dist
echo "{\"latest\":\"${LATEST_VERSION}\",\"versions\":[${VERSION_LIST}]}" > .vitepress/dist/versions.json

echo ""
echo "==> Final versions.json:"
cat .vitepress/dist/versions.json
echo ""

# Cleanup tmp
rm -rf /tmp/dev-docs-dist /tmp/root-docs-dist

echo ""
echo "Done! Run:  bun vitepress preview"

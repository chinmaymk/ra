#!/usr/bin/env bash
set -euo pipefail

# Skip download if ra is already on PATH (e.g. built from source in CI)
if command -v ra &>/dev/null; then
  echo "ra already available at $(command -v ra), skipping download"
  exit 0
fi

# Determine platform and architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux)  PLATFORM="linux" ;;
  darwin) PLATFORM="darwin" ;;
  *)      echo "::error::Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)       echo "::error::Unsupported architecture: $ARCH"; exit 1 ;;
esac

ASSET_NAME="ra-${PLATFORM}-${ARCH}"
REPO="chinmaymk/ra"
INSTALL_DIR="${RUNNER_TEMP:-/tmp}/ra-bin"
mkdir -p "$INSTALL_DIR"

# Determine download URL
if [ "$RA_VERSION" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}.gz"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${RA_VERSION}/${ASSET_NAME}.gz"
fi

echo "::group::Downloading ra (${ASSET_NAME})"
echo "URL: $DOWNLOAD_URL"

# Download with retries
MAX_RETRIES=4
RETRY_DELAY=2
for i in $(seq 1 $MAX_RETRIES); do
  if curl -fSL --retry 3 "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${ASSET_NAME}.gz"; then
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "::error::Failed to download ra after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "Download attempt $i failed, retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
  RETRY_DELAY=$((RETRY_DELAY * 2))
done

# Decompress and install
gunzip -f "${INSTALL_DIR}/${ASSET_NAME}.gz"
mv "${INSTALL_DIR}/${ASSET_NAME}" "${INSTALL_DIR}/ra"
chmod +x "${INSTALL_DIR}/ra"

# Add to PATH
echo "${INSTALL_DIR}" >> "$GITHUB_PATH"

echo "ra installed to ${INSTALL_DIR}/ra"
echo "::endgroup::"

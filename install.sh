#!/usr/bin/env sh
set -e

REPO="chinmaymk/ra"
BIN_DIR="${RA_BIN_DIR:-/usr/local/bin}"
BIN_NAME="ra"

# Detect OS and arch
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64)  ASSET="ra-linux-x64" ;;
      aarch64) ASSET="ra-linux-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
    esac
    ;;
  Darwin)
    case "$ARCH" in
      x86_64)  ASSET="ra-darwin-x64" ;;
      arm64)   ASSET="ra-darwin-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
    esac
    ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

# Resolve latest version
VERSION="${RA_VERSION:-latest}"
if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')"
fi

URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"

echo "Installing ra $VERSION ($ASSET) to $BIN_DIR/$BIN_NAME..."

curl -fsSL "$URL" -o "/tmp/$ASSET"
chmod +x "/tmp/$ASSET"

if [ -w "$BIN_DIR" ]; then
  mv "/tmp/$ASSET" "$BIN_DIR/$BIN_NAME"
else
  sudo mv "/tmp/$ASSET" "$BIN_DIR/$BIN_NAME"
fi

echo "Done. Run 'ra --help' to get started."

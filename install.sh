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
    OS_NAME="Linux"
    case "$ARCH" in
      x86_64)  ARCH_NAME="x86_64" ;;
      aarch64) ARCH_NAME="arm64" ;;
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
    esac
    EXT="tar.gz"
    ;;
  Darwin)
    OS_NAME="Darwin"
    ARCH_NAME="all"
    EXT="tar.gz"
    ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

ASSET="ra_${OS_NAME}_${ARCH_NAME}.${EXT}"

# Resolve latest version
VERSION="${RA_VERSION:-latest}"
if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')"
fi

URL="https://github.com/$REPO/releases/download/$VERSION/${ASSET}"

echo "Installing ra $VERSION ($ASSET) to $BIN_DIR/$BIN_NAME..."

curl -fsSL "$URL" -o "/tmp/${ASSET}"
tar -xzf "/tmp/${ASSET}" -C /tmp ra
chmod +x "/tmp/ra"

if [ -w "$BIN_DIR" ]; then
  mv "/tmp/ra" "$BIN_DIR/$BIN_NAME"
else
  sudo mv "/tmp/ra" "$BIN_DIR/$BIN_NAME"
fi

rm -f "/tmp/${ASSET}"

echo "Done. Run 'ra --help' to get started."

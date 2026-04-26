#!/usr/bin/env bash
set -euo pipefail

REPO="${HNS_REPO:-gandazgul/harns}"
INSTALL_DIR="${HNS_INSTALL_DIR:-/usr/local/bin}"
REQUESTED_VERSION="${1:-}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[hns installer] Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd curl
need_cmd tar
need_cmd install

sha_verify() {
  local checksums_file="$1"
  local asset_name="$2"

  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$checksums_file")" && grep "  ${asset_name}$" "$(basename "$checksums_file")" | sha256sum -c -)
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$checksums_file")" && grep "  ${asset_name}$" "$(basename "$checksums_file")" | shasum -a 256 -c -)
    return
  fi

  echo "[hns installer] Missing checksum tool (sha256sum or shasum)." >&2
  exit 1
}

resolve_version() {
  if [[ -n "$REQUESTED_VERSION" ]]; then
    echo "$REQUESTED_VERSION"
    return
  fi

  local api_url="https://api.github.com/repos/${REPO}/releases/latest"
  local tag
  tag="$(curl -fsSL "$api_url" | awk -F '"' '/"tag_name":/ { print $4; exit }')"

  if [[ -z "$tag" ]]; then
    echo "[hns installer] Could not determine latest release tag from ${api_url}" >&2
    exit 1
  fi

  echo "$tag"
}

resolve_asset_suffix() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)
      case "$arch" in
        arm64|aarch64) echo "darwin-arm64" ;;
        x86_64) echo "darwin-x64" ;;
        *)
          echo "[hns installer] Unsupported macOS architecture: ${arch}" >&2
          exit 1
          ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64) echo "linux-x64" ;;
        arm64|aarch64) echo "linux-arm64" ;;
        *)
          echo "[hns installer] Unsupported Linux architecture: ${arch}" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      echo "[hns installer] Unsupported OS: ${os} (installer currently supports macOS/Linux)" >&2
      exit 1
      ;;
  esac
}

VERSION="$(resolve_version)"
SUFFIX="$(resolve_asset_suffix)"
ASSET="hns-${VERSION}-${SUFFIX}.tar.gz"
BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[hns installer] Installing ${ASSET} from ${REPO} ..."

curl -fL "${BASE_URL}/${ASSET}" -o "${TMP_DIR}/${ASSET}"
curl -fL "${BASE_URL}/SHA256SUMS" -o "${TMP_DIR}/SHA256SUMS"

sha_verify "${TMP_DIR}/SHA256SUMS" "$ASSET"

tar -xzf "${TMP_DIR}/${ASSET}" -C "$TMP_DIR"

if [[ ! -x "${TMP_DIR}/hns" ]]; then
  echo "[hns installer] Extracted archive does not contain executable 'hns'." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
if [[ -w "$INSTALL_DIR" ]]; then
  install -m 755 "${TMP_DIR}/hns" "${INSTALL_DIR}/hns"
else
  if command -v sudo >/dev/null 2>&1; then
    sudo install -m 755 "${TMP_DIR}/hns" "${INSTALL_DIR}/hns"
  else
    echo "[hns installer] No write permission to ${INSTALL_DIR} and sudo is unavailable." >&2
    exit 1
  fi
fi

echo "[hns installer] ✅ Installed hns to ${INSTALL_DIR}/hns"
echo "[hns installer] Run: hns --help"

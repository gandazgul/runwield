#!/usr/bin/env bash
set -euo pipefail

REPO="${HNS_REPO:-gandazgul/harns}"
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

expand_path() {
  case "$1" in
    "~")
      if [[ -z "${HOME:-}" ]]; then
        echo "[hns installer] HOME is not set. Set HNS_INSTALL_DIR to an absolute writable bin directory." >&2
        exit 1
      fi
      echo "$HOME"
      ;;
    "~/"*)
      if [[ -z "${HOME:-}" ]]; then
        echo "[hns installer] HOME is not set. Set HNS_INSTALL_DIR to an absolute writable bin directory." >&2
        exit 1
      fi
      echo "${HOME}/${1#~/}"
      ;;
    *) echo "$1" ;;
  esac
}

resolve_install_dir() {
  if [[ -n "${HNS_INSTALL_DIR:-}" ]]; then
    expand_path "$HNS_INSTALL_DIR"
    return
  fi

  if [[ -z "${HOME:-}" ]]; then
    echo "[hns installer] HOME is not set. Set HNS_INSTALL_DIR to a writable bin directory." >&2
    exit 1
  fi

  echo "${HOME}/.local/bin"
}

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

shell_config_file() {
  local current_shell
  current_shell="$(basename "${SHELL:-sh}")"

  case "$current_shell" in
    fish) echo "${HOME}/.config/fish/config.fish" ;;
    zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [[ -f "${HOME}/.bashrc" ]]; then
        echo "${HOME}/.bashrc"
      else
        echo "${HOME}/.profile"
      fi
      ;;
    *) echo "${HOME}/.profile" ;;
  esac
}

path_update_command() {
  local bin_dir="$1"
  local current_shell bin_expr home_dir
  current_shell="$(basename "${SHELL:-sh}")"
  home_dir="${HOME:-}"

  if [[ -n "$home_dir" && "$bin_dir" == "${home_dir}/.local/bin" ]]; then
    bin_expr='$HOME/.local/bin'
  else
    bin_expr="$bin_dir"
  fi

  case "$current_shell" in
    fish) echo "fish_add_path \"${bin_expr}\"" ;;
    *) echo "export PATH=\"${bin_expr}:\$PATH\"" ;;
  esac
}

config_file_mentions_path() {
  local config_file="$1"
  local command="$2"

  [[ -f "$config_file" ]] || return 1
  grep -Fxq "$command" "$config_file"
}

prompt_add_path_to_profile() {
  local bin_dir="$1"
  local config_file command answer

  [[ -n "${HOME:-}" ]] || return 1
  ( : <>/dev/tty ) 2>/dev/null || return 1

  config_file="$(shell_config_file)"
  command="$(path_update_command "$bin_dir")"

  if config_file_mentions_path "$config_file" "$command"; then
    echo "[hns installer] A PATH update for ${bin_dir} already exists in ${config_file}."
    return 0
  fi

  exec 3<>/dev/tty
  printf "[hns installer] Add %s to your PATH in %s now? [Y/n] " "$bin_dir" "$config_file" >&3
  if ! IFS= read -r answer <&3; then
    answer=
  fi
  exec 3>&-

  case "$answer" in
    n|N|no|NO) return 1 ;;
    *) ;;
  esac

  mkdir -p "$(dirname "$config_file")"
  touch "$config_file"
  printf '\n# Harns\n%s\n' "$command" >> "$config_file"
  echo "[hns installer] Added ${bin_dir} to ${config_file}."
}

installed_hns_is_first_on_path() {
  local installed_path active_path
  installed_path="${INSTALL_DIR}/hns"
  active_path="$(command -v hns 2>/dev/null || true)"

  [[ -n "$active_path" ]] && [[ "$active_path" == "$installed_path" ]]
}

print_hns_not_on_path_message() {
  local active_path command
  active_path="$(command -v hns 2>/dev/null || true)"

  echo "[hns installer] hns was installed, but your shell is not using that install yet."
  if [[ -n "$active_path" ]]; then
    echo "[hns installer] Your shell currently resolves hns to: ${active_path}"
  fi

  prompt_add_path_to_profile "$INSTALL_DIR" || true
  command="$(path_update_command "$INSTALL_DIR")"
  echo "[hns installer] Restart your shell or run:"
  echo
  echo "  ${command}"
  echo
  echo "[hns installer] Then run: hns --help"
}

prompt_install_snip_filters() {
  local hns_bin answer
  hns_bin="${INSTALL_DIR}/hns"

  [[ -n "${HOME:-}" ]] || return 0
  [[ -x "$hns_bin" ]] || return 0
  command -v snip >/dev/null 2>&1 || return 0
  ( : <>/dev/tty ) 2>/dev/null || return 0

  exec 3<>/dev/tty
  printf "[hns installer] Install Harns Deno Snip filters into ~/.config/snip/filters for plain snip commands? [Y/n] " >&3
  if ! IFS= read -r answer <&3; then
    answer=
  fi
  exec 3>&-

  case "$answer" in
    n|N|no|NO)
      echo "[hns installer] Skipped Snip filter install. You can run: hns snip-filters install"
      return 0
      ;;
    *) ;;
  esac

  if "$hns_bin" snip-filters install; then
    echo "[hns installer] Harns Deno Snip filters installed."
    echo "[hns installer] To remove them later, run: hns snip-filters cleanup"
  else
    echo "[hns installer] Snip filter install failed. You can retry with: hns snip-filters install" >&2
  fi
}

INSTALL_DIR="$(resolve_install_dir)"
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
if [[ ! -w "$INSTALL_DIR" ]]; then
  echo "[hns installer] No write permission to ${INSTALL_DIR}." >&2
  echo "[hns installer] Choose a user-writable location with HNS_INSTALL_DIR, for example:" >&2
  echo "[hns installer]   HNS_INSTALL_DIR=\"${HOME:-$PWD}/.local/bin\" bash install.sh" >&2
  exit 1
fi

install -m 755 "${TMP_DIR}/hns" "${INSTALL_DIR}/hns"

echo "[hns installer] ✅ Installed hns to ${INSTALL_DIR}/hns"
prompt_install_snip_filters
if installed_hns_is_first_on_path; then
  echo "[hns installer] Run: hns --help"
else
  print_hns_not_on_path_message
fi

#!/usr/bin/env bash
set -euo pipefail

REPO="${WLD_REPO:-gandazgul/runwield}"
MNEMOSYNE_REPO="${WLD_MNEMOSYNE_REPO:-gandazgul/mnemosyne}"
CYMBAL_REPO="${WLD_CYMBAL_REPO:-1broseidon/cymbal}"
SNIP_REPO="${WLD_SNIP_REPO:-edouard-claude/snip}"
REQUESTED_VERSION="${1:-}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[wld installer] Missing required command: $1" >&2
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
        echo "[wld installer] HOME is not set. Set WLD_INSTALL_DIR to an absolute writable bin directory." >&2
        exit 1
      fi
      echo "$HOME"
      ;;
    "~/"*)
      if [[ -z "${HOME:-}" ]]; then
        echo "[wld installer] HOME is not set. Set WLD_INSTALL_DIR to an absolute writable bin directory." >&2
        exit 1
      fi
      echo "${HOME}/${1#~/}"
      ;;
    *) echo "$1" ;;
  esac
}

resolve_install_dir() {
  if [[ -n "${WLD_INSTALL_DIR:-}" ]]; then
    expand_path "$WLD_INSTALL_DIR"
    return
  fi

  if [[ -z "${HOME:-}" ]]; then
    echo "[wld installer] HOME is not set. Set WLD_INSTALL_DIR to a writable bin directory." >&2
    exit 1
  fi

  echo "${HOME}/.local/bin"
}

sha_verify() {
  local checksums_file="$1"
  local asset_name="$2"
  local check_line

  check_line="$(awk -v asset="$asset_name" '$2 == asset { print; exit }' "$checksums_file")"
  if [[ -z "$check_line" ]]; then
    echo "[wld installer] Checksum manifest lacks an entry for ${asset_name}." >&2
    return 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$checksums_file")" && printf '%s\n' "$check_line" | sha256sum -c -)
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$checksums_file")" && printf '%s\n' "$check_line" | shasum -a 256 -c -)
    return
  fi

  echo "[wld installer] Missing checksum tool (sha256sum or shasum)." >&2
  return 1
}

latest_tag_for_repo() {
  local repo="$1"
  local api_url="https://api.github.com/repos/${repo}/releases/latest"
  local tag
  tag="$(curl -fsSL "$api_url" | awk -F '"' '/"tag_name":/ { print $4; exit }')"

  if [[ -z "$tag" ]]; then
    echo "[wld installer] Could not determine latest release tag from ${api_url}" >&2
    return 1
  fi

  echo "$tag"
}

resolve_version() {
  if [[ -n "$REQUESTED_VERSION" ]]; then
    echo "$REQUESTED_VERSION"
    return
  fi

  latest_tag_for_repo "$REPO"
}

resolve_platform() {
  local raw_os raw_arch
  raw_os="${WLD_TEST_UNAME_S:-$(uname -s)}"
  raw_arch="${WLD_TEST_UNAME_M:-$(uname -m)}"

  case "$raw_os" in
    Darwin) WLD_OS="darwin" ;;
    Linux) WLD_OS="linux" ;;
    *)
      echo "[wld installer] Unsupported OS: ${raw_os} (installer currently supports macOS/Linux)" >&2
      exit 1
      ;;
  esac

  case "$raw_arch" in
    x86_64|amd64) WLD_ARCH="amd64" ;;
    arm64|aarch64) WLD_ARCH="arm64" ;;
    *)
      echo "[wld installer] Unsupported ${WLD_OS} architecture: ${raw_arch}" >&2
      exit 1
      ;;
  esac
}

wld_asset_suffix() {
  local wld_arch="$WLD_ARCH"
  [[ "$wld_arch" == "amd64" ]] && wld_arch="x64"
  echo "${WLD_OS}-${wld_arch}"
}

helper_asset_name() {
  local helper="$1"
  local version="$2"
  local version_no_v="${version#v}"
  local arch="$WLD_ARCH"

  case "$helper" in
    mnemosyne) echo "mnemosyne_${version_no_v}_${WLD_OS}_${arch}.tar.gz" ;;
    cymbal)
      [[ "$arch" == "amd64" ]] && arch="x86_64"
      echo "cymbal_${version}_${WLD_OS}_${arch}.tar.gz"
      ;;
    snip) echo "snip_${version_no_v}_${WLD_OS}_${arch}.tar.gz" ;;
    *)
      echo "[wld installer] Unknown helper: ${helper}" >&2
      return 1
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
  [[ "${WLD_NONINTERACTIVE:-}" != "1" ]] || return 1
  ( : <>/dev/tty ) 2>/dev/null || return 1

  config_file="$(shell_config_file)"
  command="$(path_update_command "$bin_dir")"

  if config_file_mentions_path "$config_file" "$command"; then
    echo "[wld installer] A PATH update for ${bin_dir} already exists in ${config_file}."
    return 0
  fi

  exec 3<>/dev/tty
  printf "[wld installer] Add %s to your PATH in %s now? [Y/n] " "$bin_dir" "$config_file" >&3
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
  printf '\n# RunWield\n%s\n' "$command" >> "$config_file"
  echo "[wld installer] Added ${bin_dir} to ${config_file}."
}

installed_wld_is_first_on_path() {
  local installed_path active_path
  installed_path="${INSTALL_DIR}/wld"
  active_path="$(command -v wld 2>/dev/null || true)"

  [[ -n "$active_path" ]] && [[ "$active_path" == "$installed_path" ]]
}

print_path_message() {
  local active_path command
  active_path="$(command -v wld 2>/dev/null || true)"

  echo "[wld installer] RunWield binaries were installed, but your shell may not use that install yet."
  if [[ -n "$active_path" && "$active_path" != "${INSTALL_DIR}/wld" ]]; then
    echo "[wld installer] Your shell currently resolves wld to: ${active_path}"
  fi

  prompt_add_path_to_profile "$INSTALL_DIR" || true
  command="$(path_update_command "$INSTALL_DIR")"
  echo "[wld installer] Restart your shell or run:"
  echo
  echo "  ${command}"
  echo
  echo "[wld installer] Then run: wld --help"
}

helper_existing_path() {
  local name="$1"
  local found
  found="$(command -v "$name" 2>/dev/null || true)"
  if [[ -n "$found" ]]; then
    echo "$found"
    return 0
  fi
  if [[ -x "${INSTALL_DIR}/${name}" ]]; then
    echo "${INSTALL_DIR}/${name}"
    return 0
  fi
  return 1
}

download() {
  local url="$1"
  local output="$2"
  curl -fL "$url" -o "$output"
}

extract_archive() {
  local archive="$1"
  local dest="$2"
  case "$archive" in
    *.tar.gz) tar -xzf "$archive" -C "$dest" ;;
    *.tar.zst) zstd -dc "$archive" | tar -xf - -C "$dest" ;;
    *)
      echo "[wld installer] Unsupported archive format: ${archive}" >&2
      return 1
      ;;
  esac
}

find_executable() {
  local root="$1"
  local exe="$2"
  find "$root" -type f -name "$exe" -perm -u+x | head -n 1
}

install_helper() {
  local name="$1"
  local repo="$2"
  local required="$3"
  local existing version asset base_url work_dir checksums source_path

  if existing="$(helper_existing_path "$name")"; then
    PRESERVED_HELPERS+=("${name}:${existing}")
    echo "[wld installer] Preserving existing ${name}: ${existing}"
    return 0
  fi

  version="$(latest_tag_for_repo "$repo")"
  asset="$(helper_asset_name "$name" "$version")"
  base_url="https://github.com/${repo}/releases/download/${version}"
  work_dir="${TMP_DIR}/${name}"
  mkdir -p "$work_dir"

  echo "[wld installer] Installing ${name} ${version} (${asset}) ..."
  if ! download "${base_url}/checksums.txt" "${work_dir}/checksums.txt"; then
    echo "[wld installer] Failed to download ${name} checksums from ${repo}." >&2
    [[ "$required" == "required" ]] && return 1 || return 2
  fi
  if ! download "${base_url}/${asset}" "${work_dir}/${asset}"; then
    echo "[wld installer] Failed to download ${name} archive ${asset}." >&2
    [[ "$required" == "required" ]] && return 1 || return 2
  fi
  if ! sha_verify "${work_dir}/checksums.txt" "$asset"; then
    echo "[wld installer] Checksum verification failed for ${name} asset ${asset}." >&2
    [[ "$required" == "required" ]] && return 1 || return 2
  fi
  if ! extract_archive "${work_dir}/${asset}" "$work_dir"; then
    echo "[wld installer] Failed to extract ${name} archive ${asset}." >&2
    [[ "$required" == "required" ]] && return 1 || return 2
  fi

  source_path="$(find_executable "$work_dir" "$name")"
  if [[ -z "$source_path" ]]; then
    echo "[wld installer] Extracted ${name} archive does not contain executable '${name}'." >&2
    [[ "$required" == "required" ]] && return 1 || return 2
  fi

  install -m 755 "$source_path" "${INSTALL_DIR}/${name}"
  INSTALLED_HELPERS+=("${name}:${INSTALL_DIR}/${name}")
  echo "[wld installer] Installed ${name} to ${INSTALL_DIR}/${name}"
}

prompt_install_snip_filters() {
  local wld_bin snip_bin answer
  wld_bin="${INSTALL_DIR}/wld"
  snip_bin="$(command -v snip 2>/dev/null || true)"
  [[ -n "$snip_bin" ]] || snip_bin="${INSTALL_DIR}/snip"

  [[ -n "${HOME:-}" ]] || return 0
  [[ -x "$wld_bin" ]] || return 0
  [[ -x "$snip_bin" ]] || return 0
  [[ "${WLD_NONINTERACTIVE:-}" != "1" ]] || return 0
  ( : <>/dev/tty ) 2>/dev/null || return 0

  exec 3<>/dev/tty
  printf "[wld installer] Install RunWield Deno Snip filters into ~/.config/snip/filters for plain snip commands? [Y/n] " >&3
  if ! IFS= read -r answer <&3; then
    answer=
  fi
  exec 3>&-

  case "$answer" in
    n|N|no|NO)
      echo "[wld installer] Skipped Snip filter install. You can run: wld snip-filters install"
      return 0
      ;;
    *) ;;
  esac

  if PATH="${INSTALL_DIR}:$PATH" "$wld_bin" snip-filters install; then
    echo "[wld installer] RunWield Deno Snip filters installed."
    echo "[wld installer] To remove them later, run: wld snip-filters cleanup"
  else
    echo "[wld installer] Snip filter install failed. You can retry with: wld snip-filters install" >&2
  fi
}

INSTALL_DIR="$(resolve_install_dir)"
VERSION="$(resolve_version)"
resolve_platform
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
INSTALLED_HELPERS=()
PRESERVED_HELPERS=()

mkdir -p "$INSTALL_DIR"
if [[ ! -w "$INSTALL_DIR" ]]; then
  echo "[wld installer] No write permission to ${INSTALL_DIR}." >&2
  echo "[wld installer] Choose a user-writable location with WLD_INSTALL_DIR, for example:" >&2
  echo "[wld installer]   WLD_INSTALL_DIR=\"${HOME:-$PWD}/.local/bin\" bash install.sh" >&2
  exit 1
fi

SUFFIX="$(wld_asset_suffix)"
BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
ASSET_BASE="wld-${VERSION}-${SUFFIX}"
ASSET="${ASSET_BASE}.tar.gz"
ARCHIVE_FORMAT="gzip"
if command -v zstd >/dev/null 2>&1; then
  ASSET="${ASSET_BASE}.tar.zst"
  ARCHIVE_FORMAT="zstd"
fi

echo "[wld installer] Installing ${ASSET} from ${REPO} ..."
if ! download "${BASE_URL}/${ASSET}" "${TMP_DIR}/${ASSET}"; then
  if [[ "$ARCHIVE_FORMAT" != "zstd" ]]; then
    exit 1
  fi
  echo "[wld installer] Zstandard archive unavailable; falling back to gzip."
  ASSET="${ASSET_BASE}.tar.gz"
  ARCHIVE_FORMAT="gzip"
  download "${BASE_URL}/${ASSET}" "${TMP_DIR}/${ASSET}"
fi
download "${BASE_URL}/SHA256SUMS" "${TMP_DIR}/SHA256SUMS"
sha_verify "${TMP_DIR}/SHA256SUMS" "$ASSET"
extract_archive "${TMP_DIR}/${ASSET}" "$TMP_DIR"

if [[ ! -x "${TMP_DIR}/wld" ]]; then
  echo "[wld installer] Extracted archive does not contain executable 'wld'." >&2
  exit 1
fi

install -m 755 "${TMP_DIR}/wld" "${INSTALL_DIR}/wld"
echo "[wld installer] Installed wld to ${INSTALL_DIR}/wld"

if ! install_helper mnemosyne "$MNEMOSYNE_REPO" required; then
  echo "[wld installer] Required helper Mnemosyne could not be installed. Rerun this installer after fixing the error above." >&2
  exit 1
fi
if ! install_helper cymbal "$CYMBAL_REPO" required; then
  echo "[wld installer] Required helper Cymbal could not be installed. Rerun this installer after fixing the error above." >&2
  exit 1
fi
if ! install_helper snip "$SNIP_REPO" optional; then
  echo "[wld installer] Warning: optional helper Snip could not be installed. RunWield will work, but command output compression/filter integration may be unavailable." >&2
fi

if ((${#INSTALLED_HELPERS[@]})); then
  echo "[wld installer] Installed helpers: ${INSTALLED_HELPERS[*]}"
fi
if ((${#PRESERVED_HELPERS[@]})); then
  echo "[wld installer] Preserved helpers: ${PRESERVED_HELPERS[*]}"
fi

echo "[wld installer] ✅ RunWield installation complete in ${INSTALL_DIR}"
prompt_install_snip_filters
if installed_wld_is_first_on_path; then
  echo "[wld installer] Run: wld --help"
else
  print_path_message
fi

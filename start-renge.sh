#!/usr/bin/env bash

set -Eeuo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

readonly APP_NAME="Renge Agent Lab"
readonly APP_URL="http://127.0.0.1:${PORT:-5190}"
readonly RUNTIME_DIR="$PWD/.runtime"
readonly PORTABLE_NODE_DIR="$RUNTIME_DIR/node"
readonly NODE_VERSION="22.23.2"
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_SHA256="d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307"

export PORT="${PORT:-5190}"
export npm_config_cache="${npm_config_cache:-$RUNTIME_DIR/npm-cache}"

log() {
  printf '\n[%s] %s\n' "$APP_NAME" "$*"
}

fail() {
  printf '\n[%s] 启动失败：%s\n' "$APP_NAME" "$*" >&2
  printf '按 Enter 键关闭窗口...'
  read -r _ || true
  exit 1
}

node_is_supported() {
  "$1" -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit((major === 20 && minor >= 19) || major >= 22 ? 0 : 1);
  ' >/dev/null 2>&1
}

install_portable_node() {
  local archive_path="$RUNTIME_DIR/$NODE_ARCHIVE"
  local extracted_dir="$RUNTIME_DIR/node-v${NODE_VERSION}-linux-x64"

  [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] ||
    fail "未找到 Node.js 20.19+ 或 22.12+；当前平台无法自动安装，请先手动安装 Node.js 22。"
  command -v curl >/dev/null 2>&1 || fail "自动安装 Node.js 需要 curl。"
  command -v sha256sum >/dev/null 2>&1 || fail "自动安装 Node.js 需要 sha256sum。"
  command -v tar >/dev/null 2>&1 || fail "自动安装 Node.js 需要 tar。"

  mkdir -p "$RUNTIME_DIR"
  log "正在下载便携 Node.js v${NODE_VERSION}（仅首次需要）..."
  curl -fL --retry 3 \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" \
    -o "$archive_path" || fail "Node.js 下载失败，请检查网络后重试。"

  printf '%s  %s\n' "$NODE_SHA256" "$archive_path" | sha256sum -c - >/dev/null ||
    fail "Node.js 安装包校验失败。"

  tar -xJf "$archive_path" -C "$RUNTIME_DIR" || fail "Node.js 解压失败。"
  mv "$extracted_dir" "$PORTABLE_NODE_DIR" || fail "Node.js 安装失败。"
}

select_node() {
  if [[ -x "$PORTABLE_NODE_DIR/bin/node" ]] && node_is_supported "$PORTABLE_NODE_DIR/bin/node"; then
    export PATH="$PORTABLE_NODE_DIR/bin:$PATH"
    return
  fi

  if command -v node >/dev/null 2>&1 && node_is_supported "$(command -v node)"; then
    return
  fi

  install_portable_node
  export PATH="$PORTABLE_NODE_DIR/bin:$PATH"
}

open_browser() {
  [[ "${RENGE_NO_BROWSER:-0}" == "1" ]] && return 0

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 &
  elif command -v gio >/dev/null 2>&1; then
    gio open "$APP_URL" >/dev/null 2>&1 &
  fi
}

url_is_ready() {
  curl -fsS --max-time 1 "$APP_URL" >/dev/null 2>&1
}

select_node
mkdir -p "$RUNTIME_DIR"

log "使用 $(node --version) / npm $(npm --version)"

if command -v curl >/dev/null 2>&1 && url_is_ready; then
  log "服务已在运行，正在打开 $APP_URL"
  open_browser
  exit 0
fi

current_lock_hash="$(sha256sum package-lock.json | awk '{print $1}')"
installed_lock_hash="$(sed -n '1p' "$RUNTIME_DIR/package-lock.sha256" 2>/dev/null || true)"

if [[ ! -d node_modules || "$current_lock_hash" != "$installed_lock_hash" ]] ||
  ! npm ls --depth=0 >/dev/null 2>&1; then
  log "正在安装项目依赖..."
  npm ci || fail "依赖安装失败，请检查网络和上方错误信息。"
  printf '%s\n' "$current_lock_hash" >"$RUNTIME_DIR/package-lock.sha256"
else
  log "项目依赖已就绪。"
fi

log "正在构建项目..."
npm run build || fail "项目构建失败，请查看上方错误信息。"

if command -v curl >/dev/null 2>&1 && [[ "${RENGE_NO_BROWSER:-0}" != "1" ]]; then
  (
    for _ in {1..40}; do
      if url_is_ready; then
        open_browser
        exit 0
      fi
      sleep 0.25
    done
  ) &
fi

log "服务已启动：$APP_URL"
printf '保持此窗口打开；按 Ctrl+C 可停止服务。\n\n'
exec node server.mjs

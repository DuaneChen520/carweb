#!/usr/bin/env bash
#
# verify-scrcpy-server.sh
# 验证项目内置的 public/scrcpy-server.jar 是否与官方 scrcpy v4.0 原版 server 字节级一致。
#
# 用法:
#   bash scripts/verify-scrcpy-server.sh            # 默认比对 v4.0
#   SCRCPY_TAG=v4.1 bash scripts/verify-scrcpy-server.sh   # 比对其它版本
#
# 退出码:
#   0 = 一致（官方原版）   1 = 不一致（被修改过）   2 = 环境/网络错误
#
set -uo errexit

SCRCPY_TAG="${SCRCPY_TAG:-v4.0}"
LOCAL_JAR="${LOCAL_JAR:-public/scrcpy-server.jar}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAR_PATH="$ROOT/$LOCAL_JAR"

# --- 0. 本地文件检查 ---
if [[ ! -f "$JAR_PATH" ]]; then
  echo "❌ 本地 server 文件不存在: $JAR_PATH" >&2
  exit 2
fi

LOCAL_SIZE=$(stat -c%s "$JAR_PATH" 2>/dev/null || wc -c < "$JAR_PATH")

# 跨平台 sha256：优先 sha256sum，回退到 Windows certutil，再回退到 openssl
# 注意：certutil 在 Git Bash 下经管道会丢输出，改为重定向到临时文件再 grep
LOCAL_SHA=""
if command -v sha256sum >/dev/null 2>&1; then
  LOCAL_SHA=$(sha256sum "$JAR_PATH" | awk '{print $1}')
elif command -v certutil >/dev/null 2>&1; then
  _tmp="${TMPDIR:-/tmp}/scrcpy_hash_$$.tmp"
  certutil -hashfile "$JAR_PATH" SHA256 > "$_tmp" 2>/dev/null
  LOCAL_SHA=$(grep -iE '^[0-9a-f]{64}$' "$_tmp" | head -1)
  rm -f "$_tmp"
elif command -v openssl >/dev/null 2>&1; then
  LOCAL_SHA=$(openssl dgst -sha256 "$JAR_PATH" | awk '{print $2}')
fi

if [[ -z "$LOCAL_SHA" ]]; then
  echo "❌ 本地 sha256 计算失败（无 sha256sum / certutil / openssl？）" >&2
  exit 2
fi
echo "本地: $LOCAL_JAR"
echo "  大小 = $LOCAL_SIZE 字节"
echo "  sha256 = $LOCAL_SHA"

# --- 1. 从 GitHub release 拉取官方 asset 元数据（含官方 sha256） ---
# 官方 release 里 server 二进制命名为 scrcpy-server-<tag>（无 .jar 后缀）
ASSET_NAME="scrcpy-server-${SCRCPY_TAG}"
API_URL="https://api.github.com/repos/Genymobile/scrcpy/releases/tags/${SCRCPY_TAG}"

echo
echo "查询官方 release: $SCRCPY_TAG ..."

# 拉取 release 元数据；任意一步失败都给出明确错误，绝不静默 exit 0
META=""
if command -v jq >/dev/null 2>&1; then
  if ! META=$(curl -fsSL "$API_URL" 2>/dev/null); then
    echo "❌ 无法访问 GitHub API（$API_URL）—— 网络受限？可手动比对下方官方值。" >&2
  fi
fi

if [[ -n "$META" ]]; then
  OFFICIAL_SHA=$(echo "$META" | jq -r ".assets[] | select(.name==\"$ASSET_NAME\") | .digest" | sed 's/^sha256://')
  OFFICIAL_SIZE=$(echo "$META" | jq -r ".assets[] | select(.name==\"$ASSET_NAME\") | .size")
  DL_URL=$(echo "$META" | jq -r ".assets[] | select(.name==\"$ASSET_NAME\") | .browser_download_url")
else
  # 无 jq 或无网络时，尝试直接从 SHA256SUMS.txt 取官方值
  SUM_URL="https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_TAG}/SHA256SUMS.txt"
  SUM_LINE=$(curl -fsSL "$SUM_URL" 2>/dev/null | grep -E " ${ASSET_NAME}\$" || true)
  OFFICIAL_SHA=$(echo "$SUM_LINE" | awk '{print $1}')
  OFFICIAL_SIZE=""
  DL_URL="https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_TAG}/${ASSET_NAME}"
fi

if [[ -z "${OFFICIAL_SHA:-}" ]]; then
  # 兜底：硬编码官方 v4.0 已知值（来自 GitHub release asset digest，2026-08-04 经 GitHub MCP 核实）
  if [[ "$SCRCPY_TAG" == "v4.0" ]]; then
    OFFICIAL_SHA="84924bd564a1eb6089c872c7521f968058977f91f5ff02514a8c74aff3210f3a"
    OFFICIAL_SIZE="732226"
    echo "⚠️  网络不可用，使用内置的官方 v4.0 已知 sha256（已核实）。"
  else
    echo "❌ 无法获取官方 $ASSET_NAME 的 sha256（网络错误 / tag 不存在 / 无内置值？）" >&2
    exit 2
  fi
fi

echo "官方: $ASSET_NAME @ $SCRCPY_TAG"
echo "  大小 = ${OFFICIAL_SIZE:-未知} 字节"
echo "  sha256 = $OFFICIAL_SHA"
echo
echo "调试: LOCAL_SHA=$LOCAL_SHA  OFFICIAL_SHA=$OFFICIAL_SHA"

# --- 2. 比对 ---
echo
if [[ "${LOCAL_SHA,,}" == "${OFFICIAL_SHA,,}" ]]; then
  if [[ -n "$OFFICIAL_SIZE" && "$LOCAL_SIZE" != "$OFFICIAL_SIZE" ]]; then
    echo "⚠️  sha256 一致但大小不同（异常，建议人工核查）"
    exit 1
  fi
  echo "✅ 字节级一致：public/scrcpy-server.jar 是官方 scrcpy $SCRCPY_TAG 原版 server，无任何定制/修改。"
  echo "   推论：代码中 '车机定制 server 上报 0x32333034' 的说法不成立（官方 4.0 仅支持 OPUS/AAC/FLAC/RAW 四种音频 codec）。"
  exit 0
else
  echo "❌ 不一致：本地 server 与官方 $SCRCPY_TAG 不同，已被修改过。"
  echo "   本地   sha256 = $LOCAL_SHA"
  echo "   官方   sha256 = $OFFICIAL_SHA"
  exit 1
fi

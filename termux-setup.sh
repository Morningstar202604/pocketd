#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  pocketd (口袋守护) / 本地开发服务器 —— Termux 一键安装
#
#  在 Termux 中运行：
#    bash termux-setup.sh
#
#  前提：
#    - 一部已安装 Termux 的安卓手机/模拟器
#    - 能在 Termux 里装 Node.js
# ============================================================

set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║          pocketd — Termux 一键安装脚本                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ---- 1. 装系统依赖 ----
echo "[1/6] 检查系统依赖..."
pkg update -y -qq 2>/dev/null || true
for pkg in nodejs-lts git python make clang binutils; do
  if ! dpkg -l "$pkg" 2>/dev/null | grep -q ^ii; then
    echo "    安装 $pkg ..."
    pkg install -y -qq "$pkg" 2>/dev/null || echo "    ! 跳过 $pkg（不可用）"
  fi
done

echo "    Node $(node -v) / npm $(npm -v)"

# 项目要求 Node >= 24：node:sqlite 是 24 起的内置模块，低版本直接起不来。
# Termux 的 nodejs-lts 若仍是 22.x，需要手动换成 nodejs。
NODE_MAJOR=$(node -v 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p')
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 24 ]; then
  echo ""
  echo "  ! 需要 Node >= 24，当前是 $(node -v 2>/dev/null || echo '未安装')"
  echo "    会话存储依赖 Node 24 内置的 node:sqlite。"
  echo "    请执行: pkg install -y nodejs   然后重新运行本脚本。"
  exit 1
fi

# ---- 2. 安装 npm 依赖（含 node-pty 原生编译）----
echo "[2/6] 安装 npm 依赖..."
if [ -d node_modules ]; then
    echo "    node_modules 已存在，跳过。需要重装请 rm -rf node_modules"
else
    # node-pty 需要 python/make/clang, Termux 上已装
    npm install
fi

# ---- 3. 构建前端 ----
echo "[3/6] 构建前端 (Vite)..."
if [ ! -d ui/node_modules ]; then
    (cd ui && npm install)
fi
(cd ui && npm run build)
[ -f ui/dist/index.html ] || { echo "    ! 前端构建失败：ui/dist/index.html 不存在"; exit 1; }
echo "    ✓ ui/dist 就绪"

# ---- 4. 创建工作目录 ----
echo "[4/6] 创建工作目录..."
WORKSPACE="$HOME/.pocketd/workspace"
mkdir -p "$WORKSPACE"
if [ ! -d "$WORKSPACE/.git" ]; then
    cd "$WORKSPACE"
    git init -q
    git config user.email "local@pocketd"
    git config user.name "pocketd User"
    cd "$(dirname "$0")"
fi
echo "    📂 工作目录: $WORKSPACE"

# ---- 5. 写环境配置 ----
echo "[5/6] 环境配置..."
ENV_FILE="$HOME/.pocketd/env"
# 旧安装的配置也接受：改名后仍能读到 ZCODE_* 变量
[ -f "$HOME/.zcode/env" ] && ENV_FILE="$HOME/.zcode/env"
mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'EOF'
# pocketd 环境配置
# 旧名前缀 ZCODE_* 仍然兼容，无需改动已有配置
# 修改为你的 API 提供商信息：
export POCKETD_API_KEY=""
export POCKETD_API_BASE="https://api.openai.com/v1"
export POCKETD_API_MODEL="gpt-4o"
export POCKETD_WORKSPACE="$HOME/.pocketd/workspace"
export POCKETD_PORT="3030"
# 启动终端需要（Termux 自带）
export SHELL=/data/data/com.termux/files/usr/bin/bash
EOF
    echo "    📝 已写入 ~/.pocketd/env"
    echo ""
    echo "    ⚠ 请编辑 ~/.pocketd/env 填入你的 API Key，例如："
    echo "       export POCKETD_API_KEY=sk-your-key-here"
    echo ""
else
    echo "    已有 env 文件，保留不动"
fi

# ---- 6. 启动 ----
echo "[6/6] 启动服务器..."

# shellcheck disable=SC1091
source "$ENV_FILE"

if [ -z "${ZCODE_API_KEY:-}" ]; then
  echo ""
  echo "  ⚠ ZCODE_API_KEY 为空 —— 服务器会正常启动，但 AI 对话会失败。"
  echo "    可稍后在浏览器右上角 Settings 里填写。"
  echo ""
fi

PORT="${ZCODE_PORT:-3030}"
echo ""
echo "  访问地址: http://localhost:${PORT}"
echo "  前台运行中，Ctrl+C 停止。"
echo ""
exec npx tsx server.ts

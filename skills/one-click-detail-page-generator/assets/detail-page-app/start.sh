#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="一键详情页生成器"
HOST="${HOST:-127.0.0.1}"
START_PORT="${PORT:-3042}"
PORT="$START_PORT"

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js，请先安装 Node.js 后再启动。"
  exit 1
fi

if [ ! -f ".env.local" ] && [ -f ".env.example" ]; then
  cp ".env.example" ".env.local"
  echo "已创建 .env.local。需要真实 API 时，在里面填写云雾/Gemini key。"
fi

while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt $((START_PORT + 20)) ]; then
    echo "从 $START_PORT 到 $PORT 都没有可用端口，请稍后重试。"
    exit 1
  fi
done

URL="http://$HOST:$PORT"

echo "$APP_NAME"
echo "项目目录：$(pwd)"
echo "启动地址：$URL"
echo

if command -v open >/dev/null 2>&1; then
  (sleep 1.2 && open "$URL") >/dev/null 2>&1 &
fi

PORT="$PORT" node server.js

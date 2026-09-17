#!/usr/bin/env bash
# 組出可部署的檢舉頁：把清單資料與比對程式複製進 site/，
# 讓網站與擴充功能共用同一份來源，不必維護第二份資料。
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p site/data site/lib
cp data/default-list.json site/data/default-list.json
cp src/common/matcher.js site/lib/matcher.js
cp icons/icon128.png site/icon.png

echo "已產生 site/data/default-list.json、site/lib/matcher.js 與 site/icon.png"

if [[ "${1:-}" == "--serve" ]]; then
  PORT="${2:-8080}"
  echo "本機預覽：http://localhost:${PORT}/"
  python3 -m http.server "$PORT" --directory site
fi

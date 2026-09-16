#!/usr/bin/env bash
# 打包成可上傳到 Chrome 線上應用程式商店的 zip。
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
OUT="dist/social-media-alert-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"
zip -r "$OUT" manifest.json src data icons LICENSE README.md -x '*.DS_Store' >/dev/null
echo "已輸出 $OUT"

#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1; xdg-open "http://127.0.0.1:3210" >/dev/null 2>&1) &
fi

exec node src/server.js

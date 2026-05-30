#!/usr/bin/env bash
set -euo pipefail

mkdir -p storage/uploads storage/artifacts storage/samples/synthetic storage/samples/private

uv run --python 3.11 uvicorn paper_hunter.api:app \
  --app-dir apps/api \
  --host 127.0.0.1 \
  --port 8000 &
API_PID=$!

cleanup() {
  kill "$API_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

pnpm --filter @paper-hunter/web start

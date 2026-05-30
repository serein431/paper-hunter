#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p storage/uploads storage/artifacts storage/samples/synthetic storage/samples/private
rm -rf apps/web/.next
export NEXT_TELEMETRY_DISABLED=1

echo "Starting Paper Hunter API on http://127.0.0.1:8000"
PYTHONPATH="$ROOT_DIR/apps/api:$ROOT_DIR" uv run --python 3.11 uvicorn paper_hunter.api:app \
  --app-dir apps/api \
  --host 127.0.0.1 \
  --port 8000 &
API_PID=$!

cleanup() {
  kill "$API_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting Paper Hunter web workbench on http://localhost:3000"
pnpm --filter @paper-hunter/web dev

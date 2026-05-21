#!/usr/bin/env bash
# Run the TTI Cable & Infrastructure Benchmark locally — no deploy, no internet exposure.
# Serves on 127.0.0.1 only (loopback), so other machines on your network cannot reach it.

PORT="${1:-8000}"

if command -v python3 >/dev/null 2>&1; then
  echo "Open http://127.0.0.1:${PORT}/  (Ctrl+C to stop)"
  python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1; then
  echo "Open http://127.0.0.1:${PORT}/  (Ctrl+C to stop)"
  python -m SimpleHTTPServer "$PORT"
elif command -v npx >/dev/null 2>&1; then
  echo "Open http://127.0.0.1:${PORT}/  (Ctrl+C to stop)"
  npx --yes http-server -a 127.0.0.1 -p "$PORT" -c-1
else
  echo "No python3, python, or npx found. Install one to run a local web server."
  exit 1
fi

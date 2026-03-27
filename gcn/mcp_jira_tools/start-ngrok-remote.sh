#!/usr/bin/env bash
# start-ngrok-remote.sh — Run MCP server + expose via supergateway + ngrok
# Usage: ./start-ngrok-remote.sh [port]
# Requires: ngrok CLI (authenticated), Node.js v18+

set -euo pipefail

PORT="${1:-8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPERGATEWAY_VERSION="3.4.3"

# -- Pre-flight checks --
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  echo "ERROR: Invalid port: $PORT (must be 1024-65535)"
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/dist/index.js" ]; then
  echo "ERROR: dist/index.js not found. Run 'npm run build' first."
  exit 1
fi

if lsof -i ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "ERROR: Port $PORT is already in use."
  exit 1
fi

if ! command -v ngrok &>/dev/null; then
  echo "ERROR: ngrok not found. Install: https://ngrok.com/download"
  exit 1
fi

# -- Load .env (optional, for NGROK_AUTHTOKEN etc.) --
if [ -f "$SCRIPT_DIR/.env" ]; then
  set +e
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
  set -e
fi

echo "Starting MCP server on port $PORT..."

# -- Track children --
SG_PID=""
NGROK_PID=""
NGROK_LOG=$(mktemp /tmp/ngrok-mcp-XXXXXX.log)

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$SG_PID" ] && { kill "$SG_PID" 2>/dev/null; pkill -P "$SG_PID" 2>/dev/null; } || true
  [ -n "$NGROK_PID" ] && kill "$NGROK_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -f "$NGROK_LOG"
  echo "Done."
}
trap cleanup EXIT INT TERM

# -- 1. Start supergateway (stdio -> Streamable HTTP bridge) --
# streamableHttp handles multiple connections & reconnection properly (SSE crashes on reconnect)
npx -y "supergateway@$SUPERGATEWAY_VERSION" \
  --stdio "node $SCRIPT_DIR/dist/index.js" \
  --outputTransport streamableHttp \
  --port "$PORT" \
  --healthEndpoint /healthz &
SG_PID=$!

# -- Wait for supergateway --
echo "Waiting for supergateway on port $PORT..."
READY=false
for i in $(seq 1 15); do
  if curl -sf --max-time 2 -o /dev/null "http://localhost:$PORT/healthz" 2>/dev/null; then
    READY=true
    echo "supergateway ready."
    break
  fi
  if ! kill -0 "$SG_PID" 2>/dev/null; then
    echo "ERROR: supergateway exited unexpectedly."
    exit 1
  fi
  sleep 1
done

if [ "$READY" != "true" ]; then
  echo "ERROR: supergateway did not start within 15s."
  exit 1
fi

# -- 2. Start ngrok tunnel --
ngrok http "$PORT" --log=stdout > "$NGROK_LOG" 2>&1 &
NGROK_PID=$!
sleep 3

# -- 3. Get public URL from ngrok API --
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels \
  | grep -o '"public_url":"https://[^"]*"' \
  | head -1 \
  | cut -d'"' -f4)

if [ -z "$NGROK_URL" ]; then
  echo "ERROR: Could not get ngrok URL. Check $NGROK_LOG"
  exit 1
fi

echo ""
echo "========================================================"
echo "  MCP Jira Tools Server is running!"
echo ""
echo "  Streamable HTTP: $NGROK_URL/mcp"
echo "  Local:           http://localhost:$PORT/mcp"
echo "  ngrok UI:        http://localhost:4040"
echo "========================================================"
echo ""
echo "--- Claude Desktop config ---"
echo "{\"mcpServers\":{\"mcp-jira-tools\":{\"url\":\"$NGROK_URL/mcp\"}}}"
echo ""
echo "--- Claude Code config ---"
echo "{\"mcpServers\":{\"mcp-jira-tools\":{\"command\":\"npx\",\"args\":[\"-y\",\"supergateway@$SUPERGATEWAY_VERSION\",\"--streamableHttp\",\"$NGROK_URL/mcp\"]}}}"
echo ""
echo "WARNINGS:"
echo "  - Max 5-10 concurrent clients (memory constraint)"
echo "  - No authentication on tunnel — do NOT share URL outside team"
echo "  - ngrok free tier: URL changes on restart"
echo "  - Each client must open URL in browser first to bypass ngrok warning page"
echo "  - JIRA credentials (PAT) are exposed through this tunnel — use with caution"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# -- Monitor both processes --
while true; do
  SG_ALIVE=true
  NGROK_ALIVE=true
  kill -0 "$SG_PID" 2>/dev/null || SG_ALIVE=false
  kill -0 "$NGROK_PID" 2>/dev/null || NGROK_ALIVE=false

  if [ "$SG_ALIVE" = false ] || [ "$NGROK_ALIVE" = false ]; then
    echo ""
    if [ "$SG_ALIVE" = false ]; then
      wait "$SG_PID" 2>/dev/null; SG_EXIT=$?
      echo "ERROR: supergateway (PID $SG_PID) exited with code $SG_EXIT"
    fi
    if [ "$NGROK_ALIVE" = false ]; then
      wait "$NGROK_PID" 2>/dev/null; NG_EXIT=$?
      echo "ERROR: ngrok (PID $NGROK_PID) exited with code $NG_EXIT"
      echo "--- ngrok log (last 30 lines) ---"
      tail -30 "$NGROK_LOG" 2>/dev/null || echo "(no log file)"
      echo "--- end ngrok log ---"
    fi
    break
  fi
  sleep 2
done

exit 1

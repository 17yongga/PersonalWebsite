#!/bin/bash
# PaperTrade Platform - Start All Services
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/config/.env"

echo "🚀 Starting PaperTrade Platform"
echo "================================"

# Load env
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
    echo "✅ Loaded environment from $ENV_FILE"
else
    echo "⚠️  No .env file found. Run setup.sh first."
    exit 1
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $BACKEND_PID 2>/dev/null
    echo "Done."
}
trap cleanup EXIT

# Start backend server
echo ""
echo "🔧 Starting backend server on port ${PORT:-3002}..."
cd "$PROJECT_DIR/server"
node src/index.js &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo "Waiting for backend..."
for i in {1..15}; do
    if curl -s "http://localhost:${PORT:-3002}/api/v1/health" > /dev/null 2>&1; then
        echo "✅ Backend is ready!"
        break
    fi
    sleep 1
done

echo ""
echo "================================"
echo "✅ PaperTrade Platform Running"
echo ""
echo "  Backend API: http://localhost:${PORT:-3002}/api/v1"
echo "  Frontend:    http://localhost:${PORT:-3002} (if serving static)"
echo "  Health:      http://localhost:${PORT:-3002}/api/v1/health"
echo ""
echo "  Quant Engine: cd quant && source venv/bin/activate && python main.py run"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Wait for background process
wait $BACKEND_PID

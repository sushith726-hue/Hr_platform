#!/bin/bash

# TalentStream HR Platform — One-Command Stop Script
# Usage: ./stop.sh or ./stop.sh --clean

set -e

# Resolve the directory of this script to navigate correctly
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -d "hr-platform" ]; then
    cd "hr-platform"
fi

# --- Detect Docker Compose command ---
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    echo "❌ Docker Compose not found."
    exit 1
fi

echo "=========================================="
echo "  🛑 TalentStream HR Platform Stopping"
echo "=========================================="
echo ""

# Check running
if ! $DOCKER_COMPOSE ps | grep -q "Up"; then
    echo "⚠️  No containers are currently running."
    exit 0
fi

# Stop
echo "🛑 Stopping containers..."
$DOCKER_COMPOSE down
echo ""
echo "=========================================="
echo "  ✅ All services stopped"
echo "=========================================="

# Optional full cleanup
if [ "$1" == "--clean" ]; then
    echo ""
    echo "🧹 Full cleanup requested..."
    $DOCKER_COMPOSE down -v
    docker image prune -f
    echo ""
    echo "=========================================="
    echo "  ✅ Full cleanup complete"
    echo "=========================================="
else
    echo ""
    echo "💡 To remove all data: ./stop.sh --clean"
fi

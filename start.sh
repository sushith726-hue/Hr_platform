#!/bin/bash

# TalentStream HR Platform — One-Command Start Script
# Usage: ./start.sh
# Auto-detects docker-compose (v1) or docker compose (v2)

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
    echo "   Install with: sudo apt install docker-compose"
    echo "   Or: sudo apt install docker-compose-plugin"
    exit 1
fi

echo "=========================================="
echo "  🚀 TalentStream HR Platform Starting"
echo "=========================================="
echo ""
echo "   Using: $DOCKER_COMPOSE"
echo ""

# --- Check .env ---
if [ ! -f .env ]; then
    echo "⚠️  .env not found. Creating from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env and fill in your API keys."
    echo "   Then run: ./start.sh"
    exit 1
fi
echo "✅ .env found"

# --- Check Docker ---
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Start Docker Desktop first."
    exit 1
fi
echo "✅ Docker is running"

# --- Build and start ---
echo ""
echo "🔨 Building and starting containers..."
echo "   (First run may take 2-3 minutes...)"
echo ""
$DOCKER_COMPOSE up --build -d

# --- Wait for services ---
echo ""
echo "⏳ Waiting for services to be healthy..."

# Wait PostgreSQL
until $DOCKER_COMPOSE exec -T db pg_isready -U postgres > /dev/null 2>&1; do
    echo "   Waiting for PostgreSQL..."
    sleep 2
done
echo "✅ PostgreSQL ready"

# Wait Redis
until $DOCKER_COMPOSE exec -T redis redis-cli ping | grep -q PONG; do
    echo "   Waiting for Redis..."
    sleep 1
done
echo "✅ Redis ready"

# Wait FastAPI
until curl -s http://localhost:8000/api/health > /dev/null 2>&1; do
    echo "   Waiting for FastAPI API..."
    sleep 2
done
echo "✅ FastAPI API ready"

# --- Print links ---
echo ""
echo "=========================================="
echo "  ✅ TalentStream is RUNNING!"
echo "=========================================="
echo ""
echo "  🌐 Recruiter Dashboard:  http://localhost:8000"
echo "  📋 API Docs (Swagger):   http://localhost:8000/docs"
echo "  📘 API Docs (ReDoc):     http://localhost:8000/redoc"
echo ""
echo "  🛑 To stop: ./stop.sh"
echo ""
$DOCKER_COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "=========================================="
echo "  🎉 Ready! Open http://localhost:8000"
echo "=========================================="

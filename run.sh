#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  CorteXplorer TDA Demo — Government Aid Edition             ║"
echo "║  http://localhost:8010                                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── Environment ───────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "→ Creating .env from .env.example"
  cp .env.example .env
fi

# ── Virtual environment ───────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
  echo "→ Creating virtual environment"
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "→ Installing dependencies"
pip install -q -r requirements.txt

# ── Start server ──────────────────────────────────────────────────────────────
echo "→ Starting CorteXplorer TDA Demo on http://localhost:8010"
echo "   Dashboard:  http://localhost:8010/dashboard"
echo "   Chat:       http://localhost:8010/chat"
echo "   API Docs:   http://localhost:8010/docs"
echo ""

cd "$REPO_DIR"
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8010 --reload

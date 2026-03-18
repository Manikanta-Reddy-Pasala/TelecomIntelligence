#!/bin/bash
set -e

# TIAC Deployment Script for VM 135.181.93.114
# Usage: ./deploy.sh [setup|start|seed|stop|logs|status|pull-model]

REMOTE_HOST="root@135.181.93.114"
REMOTE_DIR="/opt/tiac"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "${1:-start}" in
  setup)
    echo "=== Setting up TIAC on remote VM ==="

    # Stop existing services on the VM (open5gs, trading system)
    echo "Stopping existing services..."
    ssh $REMOTE_HOST "cd /opt/trading_system && docker compose down 2>/dev/null || true"
    ssh $REMOTE_HOST "docker stop \$(docker ps -q) 2>/dev/null || true"

    # Create remote directory
    ssh $REMOTE_HOST "mkdir -p $REMOTE_DIR"

    # Sync project files
    echo "Syncing project files..."
    rsync -avz --exclude='node_modules' --exclude='__pycache__' --exclude='.git' \
      --exclude='venv' --exclude='.venv' --exclude='dist' \
      "$PROJECT_DIR/" "$REMOTE_HOST:$REMOTE_DIR/"

    # Build and start
    echo "Building containers..."
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose build"

    echo "Starting services..."
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose up -d"

    # Wait for postgres to be ready
    echo "Waiting for PostgreSQL..."
    sleep 10

    # Pull base model and create custom TIAC model
    echo "Pulling tinyllama base model..."
    ssh $REMOTE_HOST "docker exec tiac_ollama ollama pull tinyllama"
    echo "Building custom TIAC analyst model..."
    ssh $REMOTE_HOST "docker cp $REMOTE_DIR/backend/ollama/Modelfile tiac_ollama:/tmp/Modelfile"
    ssh $REMOTE_HOST "docker exec tiac_ollama ollama create tiac-analyst -f /tmp/Modelfile"

    # Run seed data
    echo "Seeding database..."
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose run --rm seed"

    echo ""
    echo "=== TIAC is ready! ==="
    echo "Frontend: http://135.181.93.114:3000"
    echo "Backend API: http://135.181.93.114:8000"
    echo "Login: analyst1/password1 or admin/admin123"
    ;;

  start)
    echo "Starting TIAC..."
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose up -d"
    echo "Frontend: http://135.181.93.114:3000"
    ;;

  seed)
    echo "Seeding database..."
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose run --rm seed"
    ;;

  stop)
    echo "Stopping TIAC..."
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose down"
    ;;

  logs)
    SERVICE="${2:-backend}"
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose logs -f $SERVICE"
    ;;

  status)
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose ps"
    ;;

  pull-model)
    MODEL="${2:-tinyllama}"
    echo "Pulling model: $MODEL"
    ssh $REMOTE_HOST "docker exec tiac_ollama ollama pull $MODEL"
    ;;

  build-model)
    echo "Building custom TIAC analyst model..."
    rsync -avz "$PROJECT_DIR/backend/ollama/" "$REMOTE_HOST:$REMOTE_DIR/backend/ollama/"
    ssh $REMOTE_HOST "docker cp $REMOTE_DIR/backend/ollama/Modelfile tiac_ollama:/tmp/Modelfile"
    ssh $REMOTE_HOST "docker exec tiac_ollama ollama create tiac-analyst -f /tmp/Modelfile"
    echo "Model 'tiac-analyst' created. Set OLLAMA_MODEL=tiac-analyst in docker-compose.yml"
    ;;

  sync)
    echo "Syncing files and rebuilding..."
    rsync -avz --exclude='node_modules' --exclude='__pycache__' --exclude='.git' \
      --exclude='venv' --exclude='.venv' --exclude='dist' \
      "$PROJECT_DIR/" "$REMOTE_HOST:$REMOTE_DIR/"
    ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose build && docker compose up -d"
    ;;

  *)
    echo "Usage: $0 {setup|start|seed|stop|logs|status|pull-model|sync}"
    echo ""
    echo "  setup      - Full setup (stop existing, sync, build, start, seed)"
    echo "  start      - Start services"
    echo "  seed       - Run database seed"
    echo "  stop       - Stop all services"
    echo "  logs [svc] - Tail logs (default: backend)"
    echo "  status     - Show container status"
    echo "  pull-model [name] - Pull Ollama model (default: tinyllama)"
    echo "  sync       - Sync files and rebuild"
    ;;
esac

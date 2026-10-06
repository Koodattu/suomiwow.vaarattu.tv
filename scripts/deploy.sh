#!/bin/bash

# WoW Guild Progress Tracker - Auto Deploy Script
set -e

# Configuration
PROJECT_DIR="${PROJECT_DIR:-$HOME/wow-guild-progress-tracker}"
REPO_URL="https://github.com/Koodattu/suomiwow.vaarattu.tv.git"
# Shared with backup-db.sh. Keep the lock file: flock releases it on process exit.
LOCKFILE="${LOCKFILE:-/tmp/wow-guild-deploy.lock}"
COMPOSE_FILE="docker-compose.prod.yml"
DOCKER_BUILD_CACHE_KEEP_STORAGE="${DOCKER_BUILD_CACHE_KEEP_STORAGE:-10GB}"
DOCKER_IMAGE_PRUNE_UNTIL="${DOCKER_IMAGE_PRUNE_UNTIL:-168h}"
NGINX_CONTAINER_NAME="wow-prog-nginx"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
error() { echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2; }
warn() { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"; }

cleanup_docker() {
    log "Pruning Docker build cache, keeping up to $DOCKER_BUILD_CACHE_KEEP_STORAGE..."
    docker builder prune -af --keep-storage "$DOCKER_BUILD_CACHE_KEEP_STORAGE" || {
        warn "Docker build cache prune failed. Continuing deployment."
    }

    log "Pruning unused Docker images older than $DOCKER_IMAGE_PRUNE_UNTIL..."
    docker image prune -af --filter "until=$DOCKER_IMAGE_PRUNE_UNTIL" || {
        warn "Docker image prune failed. Continuing deployment."
    }
}

deploy() {
    log "Starting deployment check..."

    if [ ! -d "$PROJECT_DIR" ]; then
        error "Project directory not found: $PROJECT_DIR"
        exit 1
    fi

    cd "$PROJECT_DIR"

    # Check if we're on main branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$CURRENT_BRANCH" != "main" ]; then
        log "Not on main branch (current: $CURRENT_BRANCH). Skipping deployment."
        exit 0
    fi

    # Fetch latest changes
    log "Fetching latest changes..."
    git fetch "$REPO_URL" main 2>&1 || { error "Failed to fetch"; exit 1; }

    LOCAL_COMMIT=$(git rev-parse HEAD)
    REMOTE_COMMIT=$(git rev-parse FETCH_HEAD)

    if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
        log "Already up to date. No deployment needed."
        exit 0
    fi

    log "New changes detected! Deploying without a database backup."

    log "Pulling latest changes..."
    git pull "$REPO_URL" main || { error "Failed to pull changes"; exit 1; }

    log "Building and starting containers..."
    COMPOSE_HTTP_TIMEOUT=720 DOCKER_CLIENT_TIMEOUT=720 docker compose -f "$COMPOSE_FILE" up --build -d || {
        error "Failed to build and start containers"
        exit 1
    }

    log "Restarting nginx container..."
    docker restart "$NGINX_CONTAINER_NAME" > /dev/null || {
        error "Failed to restart nginx container '$NGINX_CONTAINER_NAME'"
        exit 1
    }

    sleep 5
    RUNNING_COUNT=$(docker ps -q | wc -l)
    log "Deployment completed. Running containers: $RUNNING_COUNT"

    cleanup_docker
}

main() {
    log "=== WoW Guild Progress Tracker Auto Deploy ==="
    exec 9>"$LOCKFILE"
    if ! flock -n 9; then
        log "A deployment or database backup is in progress. Skipping this check."
        exit 0
    fi
    deploy
}

main

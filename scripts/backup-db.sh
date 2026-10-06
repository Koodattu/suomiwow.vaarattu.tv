#!/bin/bash

# Standalone MongoDB backup. Run without arguments for an immediate backup.
set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-$HOME/wow-backups}"
LOCKFILE="${LOCKFILE:-/tmp/wow-guild-deploy.lock}"
DB_CONTAINER_NAME="wow-prog-db"
MAX_BACKUPS=5
PARTIAL_PATH=""

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$1"; }
error() { log "ERROR: $1" >&2; }

case "$*" in
    "") ;;
    --scheduled)
        # Ubuntu cron uses the server timezone. Check hourly to follow Helsinki DST.
        if [ "$(TZ=Europe/Helsinki date +%H)" != "11" ]; then
            exit 0
        fi
        ;;
    *) error "Usage: bash scripts/backup-db.sh [--scheduled]"; exit 2 ;;
esac

cleanup() {
    if [ -n "$PARTIAL_PATH" ]; then
        rm -f -- "$PARTIAL_PATH"
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

exec 9>"$LOCKFILE"
log "Waiting for the deployment/backup lock (up to one hour)..."
if ! flock -w 3600 9; then
    error "Could not acquire the deployment/backup lock. Backup not started."
    exit 1
fi

if [ "$(docker inspect --format '{{.State.Running}}' "$DB_CONTAINER_NAME")" != "true" ]; then
    error "Database container '$DB_CONTAINER_NAME' is not running."
    exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/wow_db_backup_$TIMESTAMP.gz"
if [ -e "$BACKUP_PATH" ]; then
    error "Backup already exists: $BACKUP_PATH"
    exit 1
fi
PARTIAL_PATH=$(mktemp "$BACKUP_DIR/.wow_db_backup_$TIMESTAMP.XXXXXX")

log "Starting database backup to $BACKUP_PATH..."
# Capture concurrent writes on the replica set; restore with --oplogReplay.
# Lower the dump's CPU priority because application jobs can still be running.
if ! docker exec "$DB_CONTAINER_NAME" nice -n 10 mongodump --archive --gzip --oplog > "$PARTIAL_PATH"; then
    error "Database backup failed. Existing backups have been kept."
    exit 1
fi
if ! nice -n 10 gzip -t "$PARTIAL_PATH"; then
    error "Backup gzip validation failed. Existing backups have been kept."
    exit 1
fi
mv -- "$PARTIAL_PATH" "$BACKUP_PATH"
PARTIAL_PATH=""
log "Backup completed: $BACKUP_PATH"

# Timestamped names sort chronologically. Prune only completed backups after success.
shopt -s nullglob
BACKUPS=("$BACKUP_DIR"/wow_db_backup_*.gz)
REMOVE_COUNT=$((${#BACKUPS[@]} - MAX_BACKUPS))
for ((i = 0; i < REMOVE_COUNT; i++)); do
    rm -- "${BACKUPS[i]}"
done
log "Backup retention complete (keeping the latest $MAX_BACKUPS)."

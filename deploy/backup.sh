#!/bin/bash
set -e
DB_PATH="${DB_PATH:-/var/www/pnl/backend/data/pnl.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/www/pnl/backups}"
mkdir -p "$BACKUP_DIR"
cp "$DB_PATH" "$BACKUP_DIR/pnl-$(date +%F).db"
find "$BACKUP_DIR" -name "pnl-*.db" -mtime +7 -delete
echo "Backup done: $BACKUP_DIR/pnl-$(date +%F).db"

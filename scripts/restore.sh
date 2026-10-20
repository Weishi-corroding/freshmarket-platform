#!/usr/bin/env sh
# 从 backup.sh / backup.ps1 生成的备份恢复数据库：sh scripts/restore.sh backups/freshmarket-YYYYMMDD-HHMMSS.dump
set -eu
cd "$(dirname "$0")/.."
dc() { docker compose --env-file .env.docker "$@"; }
if [ $# -ne 1 ] || [ ! -f "$1" ]; then echo 'Usage: sh scripts/restore.sh <backup.dump>' >&2; exit 2; fi
dc stop api
trap 'dc exec -T postgres rm -f /tmp/restore.dump >/dev/null 2>&1 || true' EXIT
dc cp "$1" postgres:/tmp/restore.dump
if ! dc exec -T postgres pg_restore -U freshmarket -d freshmarket --clean --if-exists --single-transaction /tmp/restore.dump; then
  echo 'Restore failed. API remains stopped; investigate before restarting.' >&2; exit 1
fi
# Redis 只保存可由数据库重建的商品缓存与秒杀令牌；清空后不会继续返回恢复前的数据
dc exec -T redis redis-cli FLUSHDB >/dev/null
dc start api
echo 'Database restored, cache cleared and API restarted. Verify /api/health and a representative order.'

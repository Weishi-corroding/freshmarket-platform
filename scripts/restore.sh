#!/usr/bin/env sh
# 恢复：用 backup.sh / backup.ps1 生成的备份覆盖当前数据库。
# 用法：sh scripts/restore.sh <备份文件> --yes [--no-pre-backup]
# 流程：恢复前自动备份当前库 → 停 API → 单事务 pg_restore → 清空 Redis → 启动 API 并等待健康。
# 任一步失败都不会启动 API，避免在数据不完整时对外服务。
set -eu
cd "$(dirname "$0")/.."
dc() { docker compose --env-file .env.docker "$@"; }
fail() { echo "restore: $*" >&2; exit 1; }
usage() { echo 'Usage: sh scripts/restore.sh <backup.dump> --yes [--no-pre-backup]' >&2; exit 2; }
[ $# -ge 1 ] && [ -f "$1" ] || usage
file=$1; shift; confirmed=''; pre_backup=1
for arg in "$@"; do case $arg in --yes) confirmed=1;; --no-pre-backup) pre_backup='';; *) usage;; esac; done
[ -n "$confirmed" ] || { echo 'restore: this overwrites the current database; re-run with --yes to confirm.' >&2; exit 2; }
[ -f .env.docker ] || fail '.env.docker not found.'

# 安全网：先保留当前数据，恢复结果不对时可再恢复回来；当前库已损坏无法导出时用 --no-pre-backup 跳过
if [ -n "$pre_backup" ]; then sh scripts/backup.sh backups/pre-restore || fail 'pre-restore backup failed; nothing was changed. Use --no-pre-backup if the current database cannot be dumped.'; fi
dc stop api || fail 'failed to stop the API; nothing was restored.'
trap 'dc exec -T postgres rm -f /tmp/restore.dump >/dev/null 2>&1 || true' EXIT
dc cp "$file" postgres:/tmp/restore.dump || fail 'failed to copy the backup into the container. API remains stopped.'
dc exec -T postgres pg_restore -U freshmarket -d freshmarket --clean --if-exists --single-transaction /tmp/restore.dump || fail 'pg_restore failed and was rolled back. API remains stopped; investigate before restarting.'
# Redis 只保存可由数据库重建的商品缓存与秒杀令牌；清空后不会继续返回恢复前的数据
dc exec -T redis redis-cli FLUSHDB >/dev/null || fail 'database restored but Redis could not be cleared. API remains stopped.'
dc up -d --no-deps --wait --wait-timeout 300 api || fail 'database restored but the API did not become healthy.'
echo 'Database restored, cache cleared and API restarted. Verify a representative order.'

#!/usr/bin/env sh
# 备份：pg_dump 自定义格式（-Fc），校验可读后复制到宿主机。
# 用法：sh scripts/backup.sh [输出目录]   （默认 backups/，文件名 freshmarket-YYYYMMDD-HHMMSS.dump）
set -eu
cd "$(dirname "$0")/.."
dc() { docker compose --env-file .env.docker "$@"; }
fail() { echo "backup: $*" >&2; exit 1; }
[ -f .env.docker ] || fail '.env.docker not found.'
out=${1:-backups}; umask 077; mkdir -p "$out"
file="$out/freshmarket-$(date +%Y%m%d-%H%M%S).dump"
# 无论成功与否都删除容器内临时转储，避免含个人信息的副本留在 /tmp
trap 'dc exec -T postgres rm -f /tmp/freshmarket.dump >/dev/null 2>&1 || true' EXIT
dc exec -T postgres pg_dump -U freshmarket -d freshmarket -Fc -f /tmp/freshmarket.dump || fail 'pg_dump failed.'
# 能列出目录说明转储完整可读，避免得到一份无法恢复的备份
dc exec -T postgres pg_restore --list /tmp/freshmarket.dump >/dev/null || fail 'backup verification failed.'
dc cp postgres:/tmp/freshmarket.dump "$file" || fail 'failed to copy the dump out of the container.'
[ -s "$file" ] || fail "backup file $file is empty."
echo "Backup saved: $file"

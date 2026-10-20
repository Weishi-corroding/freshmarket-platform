#!/usr/bin/env sh
# PostgreSQL 备份（pg_dump 自定义格式），与 backup.ps1 等价：sh scripts/backup.sh [输出目录]
set -eu
cd "$(dirname "$0")/.."
dc() { docker compose --env-file .env.docker "$@"; }
out=${1:-backups};umask 077;mkdir -p "$out"
file="$out/freshmarket-$(date +%Y%m%d-%H%M%S).dump"
# 无论成功与否都删除容器内临时转储，避免含个人信息的副本留在 /tmp
trap 'dc exec -T postgres rm -f /tmp/freshmarket.dump >/dev/null 2>&1 || true' EXIT
dc exec -T postgres pg_dump -U freshmarket -d freshmarket -Fc -f /tmp/freshmarket.dump
dc cp postgres:/tmp/freshmarket.dump "$file"
echo "Backup saved: $file"

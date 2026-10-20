#!/usr/bin/env sh
# 回滚 api/web 到已存在的旧镜像：sh scripts/rollback.sh [版本号]，省略时回到 .deploy-history 中的上一个版本
set -eu
cd "$(dirname "$0")/.."
dc() { docker compose --env-file .env.docker "$@"; }
version=${1:-}
if [ -z "$version" ] && [ -f .deploy-history ]; then version=$(tail -n 2 .deploy-history | head -n 1); [ "$(wc -l < .deploy-history)" -ge 2 ] || version=''; fi
if [ -z "$version" ]; then echo 'Usage: sh scripts/rollback.sh <version> (no previous deployment recorded)' >&2; exit 2; fi
case $version in *[!A-Za-z0-9._-]*) echo 'Invalid version.' >&2; exit 2;; esac
docker image inspect "freshmarket-api:$version" >/dev/null 2>&1 || { echo "API image freshmarket-api:$version is not available locally." >&2; exit 1; }
docker image inspect "freshmarket-web:$version" >/dev/null 2>&1 || { echo "Web image freshmarket-web:$version is not available locally." >&2; exit 1; }
APP_VERSION=$version dc up -d --no-build --no-deps api web
if grep -q '^APP_VERSION=' .env.docker; then sed -i.bak "s/^APP_VERSION=.*/APP_VERSION=$version/" .env.docker && rm -f .env.docker.bak; else echo "APP_VERSION=$version" >> .env.docker; fi
echo "$version" >> .deploy-history
echo "Rolled back to $version. Database schema must remain backward compatible; use restore.sh for incompatible changes."

#!/usr/bin/env sh
# 以唯一版本号构建并发布 api/web 镜像，保留旧镜像供 rollback.sh 回滚：sh scripts/deploy.sh [版本号]
set -eu
cd "$(dirname "$0")/.."
dc() { docker compose --env-file .env.docker "$@"; }
version=${1:-$(git rev-parse --short HEAD 2>/dev/null || echo build)-$(date +%Y%m%d%H%M%S)}
case $version in *[!A-Za-z0-9._-]*|'') echo 'Version may only contain letters, digits, dot, underscore and hyphen.' >&2; exit 2;; esac
APP_VERSION=$version dc build api web
APP_VERSION=$version dc up -d
# 写回 .env.docker，之后的 start/restart/备份恢复都使用当前版本
if grep -q '^APP_VERSION=' .env.docker; then sed -i.bak "s/^APP_VERSION=.*/APP_VERSION=$version/" .env.docker && rm -f .env.docker.bak; else echo "APP_VERSION=$version" >> .env.docker; fi
echo "$version" >> .deploy-history
echo "Deployed $version. Previous images are kept; roll back with: sh scripts/rollback.sh"

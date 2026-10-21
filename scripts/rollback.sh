#!/usr/bin/env sh
# 回滚：把 api/web 切换到本机已有的旧版本镜像，不重新构建、不改动数据库与中间件。
# 用法：sh scripts/rollback.sh [版本号]   （省略时回到 .deploy-history 中的上一个版本）
# 数据库结构须保持向后兼容；不兼容的迁移需用 restore.sh 恢复发布前的备份。
set -eu
cd "$(dirname "$0")/.."
dc() { docker compose --env-file .env.docker "$@"; }
fail() { echo "rollback: $*" >&2; exit 1; }
set_version() { if grep -q '^APP_VERSION=' .env.docker; then sed -i.bak "s/^APP_VERSION=.*/APP_VERSION=$1/" .env.docker && rm -f .env.docker.bak; else echo "APP_VERSION=$1" >> .env.docker; fi; }

command -v docker >/dev/null 2>&1 || fail 'docker not found.'
[ -f .env.docker ] || fail '.env.docker not found.'
version=${1:-}
if [ -z "$version" ] && [ -f .deploy-history ] && [ "$(grep -c . .deploy-history)" -ge 2 ]; then version=$(grep . .deploy-history | tail -n 2 | head -n 1); fi
if [ -z "$version" ]; then echo 'Usage: sh scripts/rollback.sh <version>  (no previous deployment recorded)' >&2; exit 2; fi
case $version in *[!A-Za-z0-9._-]*) echo 'rollback: invalid version.' >&2; exit 2;; esac

# 目标镜像必须都在本机，避免回滚到一半
for image in api web; do
  docker image inspect "freshmarket-$image:$version" >/dev/null 2>&1 || fail "image freshmarket-$image:$version is not available locally."
done
echo "==> Rolling back api/web to $version"
APP_VERSION=$version dc up -d --no-build --no-deps --wait --wait-timeout 300 api web || fail "$version did not become healthy; check: docker compose --env-file .env.docker logs api"
set_version "$version"
echo "$version" >> .deploy-history
echo "Rolled back to $version. Verify /api/health and a representative order."

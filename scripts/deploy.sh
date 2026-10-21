#!/usr/bin/env sh
# 发布：以唯一版本号构建 api/web 镜像并启动整套服务，等待健康检查通过后记录版本。
# 用法：sh scripts/deploy.sh [版本号]   （省略时为 <提交号>-<时间>）
# 健康检查失败时自动把 api/web 退回上一次成功发布的版本；首次发布失败则保留现场供排查。
set -eu
cd "$(dirname "$0")/.."
dc() { docker compose --env-file .env.docker "$@"; }
fail() { echo "deploy: $*" >&2; exit 1; }
set_version() { if grep -q '^APP_VERSION=' .env.docker; then sed -i.bak "s/^APP_VERSION=.*/APP_VERSION=$1/" .env.docker && rm -f .env.docker.bak; else echo "APP_VERSION=$1" >> .env.docker; fi; }

# 1. 预检：Docker 可用、配置存在且可解析、版本号合法
command -v docker >/dev/null 2>&1 || fail 'docker not found.'
[ -f .env.docker ] || fail '.env.docker not found; run sh scripts/init-env.sh first.'
version=${1:-$(git rev-parse --short HEAD 2>/dev/null || echo build)-$(date +%Y%m%d%H%M%S)}
case $version in *[!A-Za-z0-9._-]*|'') echo 'deploy: version may only contain letters, digits, dot, underscore and hyphen.' >&2; exit 2;; esac
dc config --quiet || fail 'docker compose config is invalid.'
previous=$( [ -f .deploy-history ] && tail -n 1 .deploy-history || true )

# 2. 构建镜像（旧版本镜像保留，供回滚使用）
echo "==> Building freshmarket-api:$version and freshmarket-web:$version"
APP_VERSION=$version dc build api web || fail 'image build failed; running services were not changed.'

# 3. 启动并等待所有带健康检查的服务就绪（数据库、Redis、MQ → API → 网关）
echo "==> Starting services"
if ! APP_VERSION=$version dc up -d --wait --wait-timeout 300 || ! dc exec -T web wget -q -O /dev/null http://127.0.0.1/api/health; then
  dc logs --tail=50 api >&2 || true
  if [ -n "$previous" ] && [ "$previous" != "$version" ]; then
    echo "deploy: $version is unhealthy; restoring previous version $previous" >&2
    APP_VERSION=$previous dc up -d --no-build --no-deps --wait --wait-timeout 300 api web || echo "deploy: automatic restore of $previous failed; run sh scripts/rollback.sh $previous" >&2
  fi
  fail "$version failed health checks and was not recorded."
fi

# 4. 记录成功版本：写回 .env.docker，后续 start/restart 使用同一版本
set_version "$version"
echo "$version" >> .deploy-history
echo "Deployed $version${previous:+ (previous: $previous)}. Roll back with: sh scripts/rollback.sh"

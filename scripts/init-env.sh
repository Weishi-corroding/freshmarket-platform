#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ -f .env.docker ]; then echo '.env.docker exists; preserve your configuration.' >&2; exit 1; fi
umask 077
secret() { od -vAn -N24 -tx1 /dev/urandom | tr -d ' \n'; }
{
  echo "JWT_SECRET=$(secret)"
  echo "DB_PASSWORD=$(secret)"
  echo "MQ_PASSWORD=$(secret)"
  echo "GRAFANA_PASSWORD=$(secret)"
  echo "DEMO_PASSWORD=FreshDemo$(secret)"
  echo 'CORS_ORIGIN=http://localhost:8080'
  echo 'WEB_BIND=127.0.0.1'
  echo 'APP_VERSION=local'
} > .env.docker
echo 'Created .env.docker. Run docker compose --env-file .env.docker up -d --build. Keep this file private.'

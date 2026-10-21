#!/usr/bin/env sh
# deploy/rollback/backup/restore.sh 的控制流检查：docker 由 PATH 中的替身脚本代替，脚本在临时目录的副本中运行，
# 不会改动任何容器、镜像、数据库或真实的 .env.docker。用法：sh scripts/test-ops.sh
set -eu
src=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mkdir -p "$work/scripts" "$work/bin"
for name in deploy rollback backup restore; do cp "$src/$name.sh" "$work/scripts/"; done
echo dump > "$work/sample.dump"
# 替身：记录调用；参数串匹配 FAIL（扩展正则）时返回 1；docker cp 从容器复制时生成目标文件
cat > "$work/bin/docker" <<'EOF'
#!/usr/bin/env sh
line="$*"; echo "$line" >> "$CALLS"
if [ -n "${FAIL:-}" ] && echo "$line" | grep -Eq -- "$FAIL"; then exit 1; fi
if [ "$4" = cp ]; then case $5 in postgres:*) echo dump > "$6";; esac; fi
exit 0
EOF
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" CALLS="$work/calls"
pass=0
run() { # run <脚本> <失败匹配> <历史，逗号分隔> [参数...]；设置 status
  script=$1 fail=$2 history=$3; shift 3
  printf 'JWT_SECRET=x\nAPP_VERSION=v1\n' > "$work/.env.docker"; rm -f "$work/.deploy-history" "$CALLS"; : > "$CALLS"
  [ -z "$history" ] || echo "$history" | tr ',' '\n' > "$work/.deploy-history"
  status=0; FAIL=$fail sh "$work/scripts/$script.sh" "$@" > "$work/out" 2>&1 || status=$?
}
called() { grep -Eq -- "$1" "$CALLS"; }
version() { grep '^APP_VERSION=' "$work/.env.docker"; }
last() { tail -n 1 "$work/.deploy-history"; }
check() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else echo "FAIL $1"; cat "$work/out"; exit 1; fi; }
api_start='up -d --no-deps --wait --wait-timeout 300 api$'

run deploy '' v1 v2
check 'deploy records a healthy version' '[ $status -eq 0 ] && [ "$(version)" = APP_VERSION=v2 ] && [ "$(last)" = v2 ]'
run deploy ' build ' v1 v2
check 'deploy stops before touching services when the build fails' '[ $status -ne 0 ] && ! called " up " && [ "$(version)" = APP_VERSION=v1 ]'
run deploy 'up -d --wait --wait-timeout 300$' v1 v2
check 'deploy restores the previous version when health checks fail' '[ $status -ne 0 ] && called no-build && [ "$(version)" = APP_VERSION=v1 ] && [ "$(last)" = v1 ]'
run deploy 'wget' v1 v2
check 'deploy treats a failed gateway health probe as unhealthy' '[ $status -ne 0 ] && called no-build && [ "$(last)" = v1 ]'
run deploy 'up -d --wait' '' v1
check 'first deploy failure leaves services for investigation' '[ $status -ne 0 ] && ! called no-build'
run deploy '' v1 'bad/version'
check 'deploy rejects an invalid version' '[ $status -eq 2 ] && [ ! -s "$CALLS" ]'

run rollback '' v1,v2
check 'rollback defaults to the previous recorded version' '[ $status -eq 0 ] && [ "$(version)" = APP_VERSION=v1 ] && [ "$(last)" = v1 ]'
run rollback 'image inspect freshmarket-web' v1,v2
check 'rollback refuses when an image is missing' '[ $status -ne 0 ] && ! called " up "'
run rollback '' v1
check 'rollback without history requires an explicit version' '[ $status -eq 2 ] && [ ! -s "$CALLS" ]'

run backup '' ''
check 'backup verifies the dump and removes the container copy' '[ $status -eq 0 ] && called "pg_restore --list" && tail -n 1 "$CALLS" | grep -q "rm -f"'
run backup 'pg_restore --list' ''
check 'backup fails on an unreadable dump and still cleans up' '[ $status -ne 0 ] && ! called " cp " && tail -n 1 "$CALLS" | grep -q "rm -f"'

run restore '' '' "$work/sample.dump"
check 'restore requires --yes' '[ $status -eq 2 ] && [ ! -s "$CALLS" ]'
run restore '' '' "$work/sample.dump" --yes
check 'restore backs up first and restarts the API' '[ $status -eq 0 ] && called pg_dump && called "$api_start"'
run restore 'pg_dump' '' "$work/sample.dump" --yes
check 'restore changes nothing when the pre-restore backup fails' '[ $status -ne 0 ] && ! called "stop api"'
run restore '' '' "$work/sample.dump" --yes --no-pre-backup
check 'restore --no-pre-backup skips the safety backup' '[ $status -eq 0 ] && ! called pg_dump'
for failure in 'stop api' 'pg_restore -U' 'FLUSHDB'; do
  run restore "$failure" '' "$work/sample.dump" --yes --no-pre-backup
  check "restore keeps the API stopped after failure: $failure" '[ $status -ne 0 ] && ! called "$api_start"'
done
run restore "$api_start" '' "$work/sample.dump" --yes --no-pre-backup
check 'restore reports an unhealthy API as a failure' '[ $status -ne 0 ] && ! grep -q "API restarted" "$work/out"'
echo "$pass checks passed"

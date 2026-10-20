param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$backupPath = (Resolve-Path -LiteralPath $BackupFile).Path
docker compose --env-file .env.docker stop api
if ($LASTEXITCODE -ne 0) { throw 'Failed to stop the API before restoring.' }
try {
  docker compose --env-file .env.docker cp $backupPath postgres:/tmp/restore.dump
  if ($LASTEXITCODE -ne 0) { throw 'Failed to copy backup file.' }
  docker compose --env-file .env.docker exec -T postgres pg_restore -U freshmarket -d freshmarket --clean --if-exists --single-transaction /tmp/restore.dump
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed. API remains stopped; investigate before restarting.' }
} finally {
  docker compose --env-file .env.docker exec -T postgres rm -f /tmp/restore.dump | Out-Null
}
# Redis only holds data rebuilt from the database (catalog cache, flash-sale tokens); clear it so pre-restore data is not served.
docker compose --env-file .env.docker exec -T redis redis-cli FLUSHDB | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Database restored but Redis could not be cleared; API remains stopped.' }
docker compose --env-file .env.docker start api
if ($LASTEXITCODE -ne 0) { throw 'Database restored but API restart failed. Investigate before serving traffic.' }
Write-Output 'Database restored, cache cleared and API restarted. Verify /api/health and a representative order.'

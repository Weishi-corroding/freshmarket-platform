# Restore: overwrite the current database with a dump produced by backup.ps1 / backup.sh.
# Usage: .\scripts\restore.ps1 -BackupFile <file> -Force [-SkipPreBackup]
# Steps: back up the current database -> stop API -> single-transaction pg_restore -> clear Redis -> start API and wait for health.
# The API is never started after a failed step, so incomplete data is not served.
param([Parameter(Mandatory=$true)][string]$BackupFile, [switch]$Force, [switch]$SkipPreBackup)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$backupPath = (Resolve-Path -LiteralPath $BackupFile).Path
if (-not $Force) { throw 'This overwrites the current database; re-run with -Force to confirm.' }
if (-not (Test-Path -LiteralPath '.env.docker')) { throw '.env.docker not found.' }

# Safety net: keep the current data so a wrong restore can itself be undone. Use -SkipPreBackup if the current database cannot be dumped.
if (-not $SkipPreBackup) {
  try { & (Join-Path $PSScriptRoot 'backup.ps1') -OutputDirectory 'backups/pre-restore' }
  catch { throw ('Pre-restore backup failed; nothing was changed. ' + $_.Exception.Message) }
}
docker compose --env-file .env.docker stop api
if ($LASTEXITCODE -ne 0) { throw 'Failed to stop the API; nothing was restored.' }
try {
  docker compose --env-file .env.docker cp $backupPath postgres:/tmp/restore.dump
  if ($LASTEXITCODE -ne 0) { throw 'Failed to copy the backup into the container. API remains stopped.' }
  docker compose --env-file .env.docker exec -T postgres pg_restore -U freshmarket -d freshmarket --clean --if-exists --single-transaction /tmp/restore.dump
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed and was rolled back. API remains stopped; investigate before restarting.' }
} finally {
  docker compose --env-file .env.docker exec -T postgres rm -f /tmp/restore.dump | Out-Null
}
# Redis only holds data rebuilt from the database (catalog cache, flash-sale tokens); clear it so pre-restore data is not served.
docker compose --env-file .env.docker exec -T redis redis-cli FLUSHDB | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Database restored but Redis could not be cleared. API remains stopped.' }
docker compose --env-file .env.docker up -d --no-deps --wait --wait-timeout 300 api
if ($LASTEXITCODE -ne 0) { throw 'Database restored but the API did not become healthy.' }
Write-Output 'Database restored, cache cleared and API restarted. Verify a representative order.'

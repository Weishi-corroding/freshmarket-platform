param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$backupPath = (Resolve-Path -LiteralPath $BackupFile).Path
docker compose --env-file .env.docker stop api
docker compose --env-file .env.docker cp $backupPath postgres:/tmp/restore.dump
if ($LASTEXITCODE -ne 0) { throw 'Failed to copy backup file.' }
docker compose --env-file .env.docker exec -T postgres pg_restore -U freshmarket -d freshmarket --clean --if-exists --single-transaction /tmp/restore.dump
if ($LASTEXITCODE -ne 0) { throw 'Restore failed. API remains stopped; investigate before restarting.' }
docker compose --env-file .env.docker start api
Write-Output 'Database restored and API restarted. Verify /api/health and a representative order.'

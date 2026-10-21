# Backup: pg_dump custom format (-Fc), verified readable, then copied to the host.
# Usage: .\scripts\backup.ps1 [-OutputDirectory backups]   (file name freshmarket-yyyyMMdd-HHmmss.dump)
param([string]$OutputDirectory = 'backups')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath '.env.docker')) { throw '.env.docker not found.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$filename = Join-Path $OutputDirectory ('freshmarket-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump')
try {
  # The dump is written inside the container and copied with docker cp; a PowerShell pipe would corrupt binary data.
  docker compose --env-file .env.docker exec -T postgres pg_dump -U freshmarket -d freshmarket -Fc -f /tmp/freshmarket.dump
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
  # Listing the archive proves it is complete and restorable.
  docker compose --env-file .env.docker exec -T postgres pg_restore --list /tmp/freshmarket.dump | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Backup verification failed.' }
  docker compose --env-file .env.docker cp postgres:/tmp/freshmarket.dump $filename
  if ($LASTEXITCODE -ne 0) { throw 'Failed to copy the dump out of the container.' }
} finally {
  # Never leave a copy of personal data inside the container.
  docker compose --env-file .env.docker exec -T postgres rm -f /tmp/freshmarket.dump | Out-Null
}
if (-not (Test-Path -LiteralPath $filename) -or (Get-Item -LiteralPath $filename).Length -eq 0) { throw ('Backup file ' + $filename + ' is missing or empty.') }
Write-Output ('Backup saved: ' + $filename)

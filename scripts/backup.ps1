param([string]$OutputDirectory = 'backups')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$filename = Join-Path $OutputDirectory ('freshmarket-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump')
try {
  docker compose --env-file .env.docker exec -T postgres pg_dump -U freshmarket -d freshmarket -Fc -f /tmp/freshmarket.dump
  if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
  docker compose --env-file .env.docker cp postgres:/tmp/freshmarket.dump $filename
  if ($LASTEXITCODE -ne 0) { throw 'Failed to copy database backup.' }
} finally {
  # Never leave a copy of personal data inside the container.
  docker compose --env-file .env.docker exec -T postgres rm -f /tmp/freshmarket.dump | Out-Null
}
Write-Output ('Backup saved: ' + $filename)

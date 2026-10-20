param([ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not $Version) {
  $history = @(if (Test-Path -LiteralPath '.deploy-history') { Get-Content -LiteralPath '.deploy-history' | Where-Object { $_ } })
  if ($history.Count -lt 2) { throw 'No previous deployment recorded; pass -Version explicitly.' }
  $Version = $history[$history.Count - 2]
}
docker image inspect ('freshmarket-api:' + $Version) | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Previous API image is not available locally.' }
docker image inspect ('freshmarket-web:' + $Version) | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Previous web image is not available locally.' }
$env:APP_VERSION = $Version
try {
  docker compose --env-file .env.docker up -d --no-build --no-deps api web
  if ($LASTEXITCODE -ne 0) { throw 'Rollback failed.' }
} finally { Remove-Item Env:APP_VERSION -ErrorAction SilentlyContinue }
$lines = @([System.IO.File]::ReadAllLines((Join-Path (Get-Location).Path '.env.docker')) | Where-Object { -not $_.StartsWith('APP_VERSION=') }) + ('APP_VERSION=' + $Version)
[System.IO.File]::WriteAllLines((Join-Path (Get-Location).Path '.env.docker'),$lines,(New-Object System.Text.UTF8Encoding($false)))
Add-Content -LiteralPath '.deploy-history' -Value $Version
Write-Output ('Rolled back to ' + $Version + '. Database schema must remain backward compatible; use backup restore for incompatible changes.')

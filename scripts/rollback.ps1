# Roll back api/web to an image that already exists locally; no rebuild, database and middleware untouched.
# Usage: .\scripts\rollback.ps1 [-Version <tag>]   (default: the previous entry in .deploy-history)
# The database schema must stay backward compatible; restore a pre-release backup for incompatible migrations.
param([ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path (Get-Location).Path '.env.docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker not found.' }
if (-not (Test-Path -LiteralPath $envFile)) { throw '.env.docker not found.' }
if (-not $Version) {
  $history = @(if (Test-Path -LiteralPath '.deploy-history') { Get-Content -LiteralPath '.deploy-history' | Where-Object { $_ } })
  if ($history.Count -lt 2) { throw 'No previous deployment recorded; pass -Version explicitly.' }
  $Version = $history[$history.Count - 2]
}
# Both images must exist, otherwise the rollback would stop half way.
foreach ($image in @('api', 'web')) {
  docker image inspect ('freshmarket-' + $image + ':' + $Version) | Out-Null
  if ($LASTEXITCODE -ne 0) { throw ('Image freshmarket-' + $image + ':' + $Version + ' is not available locally.') }
}
Write-Output ('==> Rolling back api/web to ' + $Version)
$env:APP_VERSION = $Version
try {
  docker compose --env-file .env.docker up -d --no-build --no-deps --wait --wait-timeout 300 api web
  if ($LASTEXITCODE -ne 0) { throw ($Version + ' did not become healthy; check docker compose --env-file .env.docker logs api') }
} finally { Remove-Item Env:APP_VERSION -ErrorAction SilentlyContinue }
$lines = @([System.IO.File]::ReadAllLines($envFile) | Where-Object { -not $_.StartsWith('APP_VERSION=') }) + ('APP_VERSION=' + $Version)
[System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
Add-Content -LiteralPath '.deploy-history' -Value $Version
Write-Output ('Rolled back to ' + $Version + '. Verify /api/health and a representative order.')

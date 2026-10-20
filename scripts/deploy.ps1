param([ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$Version)
# Build and start api/web under a unique image tag so rollback.ps1 has previous images to return to.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not $Version) {
  $commit = git rev-parse --short HEAD 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $commit) { $commit = 'build' }
  $Version = $commit + '-' + (Get-Date -Format 'yyyyMMddHHmmss')
}
$env:APP_VERSION = $Version
try {
  docker compose --env-file .env.docker build api web
  if ($LASTEXITCODE -ne 0) { throw 'Image build failed.' }
  docker compose --env-file .env.docker up -d
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed.' }
} finally { Remove-Item Env:APP_VERSION -ErrorAction SilentlyContinue }
$lines = @([System.IO.File]::ReadAllLines((Join-Path (Get-Location).Path '.env.docker')) | Where-Object { -not $_.StartsWith('APP_VERSION=') }) + ('APP_VERSION=' + $Version)
[System.IO.File]::WriteAllLines((Join-Path (Get-Location).Path '.env.docker'),$lines,(New-Object System.Text.UTF8Encoding($false)))
Add-Content -LiteralPath '.deploy-history' -Value $Version
Write-Output ('Deployed ' + $Version + '. Previous images are kept; roll back with scripts/rollback.ps1')

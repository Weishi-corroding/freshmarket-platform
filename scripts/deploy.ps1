# Deploy: build api/web under a unique version tag, start the stack and wait for health checks.
# Usage: .\scripts\deploy.ps1 [-Version <tag>]   (default: <commit>-<timestamp>)
# If health checks fail, api/web are returned to the last successful version (if any) and the new version is not recorded.
param([ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path (Get-Location).Path '.env.docker'
function Set-AppVersion([string]$value) {
  $lines = @([System.IO.File]::ReadAllLines($envFile) | Where-Object { -not $_.StartsWith('APP_VERSION=') }) + ('APP_VERSION=' + $value)
  [System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
}

# 1. Preflight: docker available, configuration present and valid.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker not found.' }
if (-not (Test-Path -LiteralPath $envFile)) { throw '.env.docker not found; run scripts/init-env.ps1 first.' }
if (-not $Version) {
  $commit = git rev-parse --short HEAD 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $commit) { $commit = 'build' }
  $Version = $commit + '-' + (Get-Date -Format 'yyyyMMddHHmmss')
}
docker compose --env-file .env.docker config --quiet
if ($LASTEXITCODE -ne 0) { throw 'docker compose config is invalid.' }
$history = @(if (Test-Path -LiteralPath '.deploy-history') { Get-Content -LiteralPath '.deploy-history' | Where-Object { $_ } })
$previous = if ($history.Count -gt 0) { $history[$history.Count - 1] } else { '' }

try {
  # 2. Build images; earlier tags stay available for rollback.
  Write-Output ('==> Building freshmarket-api:' + $Version + ' and freshmarket-web:' + $Version)
  $env:APP_VERSION = $Version
  docker compose --env-file .env.docker build api web
  if ($LASTEXITCODE -ne 0) { throw 'Image build failed; running services were not changed.' }

  # 3. Start and wait for every service with a health check (database, Redis, MQ -> API -> gateway).
  Write-Output '==> Starting services'
  docker compose --env-file .env.docker up -d --wait --wait-timeout 300
  $healthy = $LASTEXITCODE -eq 0
  if ($healthy) {
    docker compose --env-file .env.docker exec -T web wget -q -O /dev/null http://127.0.0.1/api/health
    $healthy = $LASTEXITCODE -eq 0
  }
  if (-not $healthy) {
    docker compose --env-file .env.docker logs --tail=50 api
    if ($previous -and $previous -ne $Version) {
      Write-Warning ($Version + ' is unhealthy; restoring previous version ' + $previous)
      $env:APP_VERSION = $previous
      docker compose --env-file .env.docker up -d --no-build --no-deps --wait --wait-timeout 300 api web
      if ($LASTEXITCODE -ne 0) { Write-Warning ('Automatic restore of ' + $previous + ' failed; run scripts/rollback.ps1 -Version ' + $previous) }
    }
    throw ($Version + ' failed health checks and was not recorded.')
  }
} finally { Remove-Item Env:APP_VERSION -ErrorAction SilentlyContinue }

# 4. Record the successful version so later start/restart use the same images.
Set-AppVersion $Version
Add-Content -LiteralPath '.deploy-history' -Value $Version
$suffix = if ($previous) { ' (previous: ' + $previous + ')' } else { '' }
Write-Output ('Deployed ' + $Version + $suffix + '. Roll back with scripts/rollback.ps1')

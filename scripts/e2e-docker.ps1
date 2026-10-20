$ErrorActionPreference = 'Stop'
$npm = if ($env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$passwordLine = [System.IO.File]::ReadAllLines((Join-Path (Get-Location).Path '.env.docker')) | Where-Object { $_.StartsWith('DEMO_PASSWORD=') } | Select-Object -First 1
if (-not $passwordLine) { throw 'DEMO_PASSWORD not found in .env.docker' }
$env:DEMO_PASSWORD = $passwordLine.Substring('DEMO_PASSWORD='.Length)
$env:E2E_BASE_URL = 'http://127.0.0.1:8080'
if ((Test-Path -LiteralPath 'docs/evidence/e2e-results.json') -and -not (Test-Path -LiteralPath 'docs/evidence/e2e-local-results.json')) { Copy-Item -LiteralPath 'docs/evidence/e2e-results.json' -Destination 'docs/evidence/e2e-local-results.json' }
try {
  & $npm run test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Docker E2E verification failed.' }
  Copy-Item -LiteralPath 'docs/evidence/e2e-results.json' -Destination 'docs/evidence/e2e-docker-results.json'
} finally { Remove-Item Env:DEMO_PASSWORD -ErrorAction SilentlyContinue; Remove-Item Env:E2E_BASE_URL -ErrorAction SilentlyContinue }

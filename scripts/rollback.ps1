param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$env:APP_VERSION = $Version
docker image inspect ('freshmarket-api:' + $Version) | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Previous API image is not available locally.' }
docker image inspect ('freshmarket-web:' + $Version) | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Previous web image is not available locally.' }
docker compose --env-file .env.docker up -d --no-build --no-deps api web
if ($LASTEXITCODE -ne 0) { throw 'Rollback failed.' }
Write-Output 'Previous application images started. Database schema must remain backward compatible; use backup restore for incompatible changes.'

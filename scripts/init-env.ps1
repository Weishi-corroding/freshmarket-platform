$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env.docker'
if (Test-Path -LiteralPath $envPath) { throw '.env.docker already exists. Preserve your current configuration; edit it manually if necessary.' }
function New-Secret { $bytes = New-Object byte[] 24; $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create(); try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }; return [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant() }
$configuration = @(
  'JWT_SECRET=' + (New-Secret)
  'DB_PASSWORD=' + (New-Secret)
  'MQ_PASSWORD=' + (New-Secret)
  'GRAFANA_PASSWORD=' + (New-Secret)
  'DEMO_PASSWORD=FreshDemo' + (New-Secret).Substring(0,16)
  'COMPOSE_PROJECT_NAME=freshmarket-' + (New-Secret).Substring(0,8)
  'CORS_ORIGIN=http://localhost:8080'
  'WEB_BIND=127.0.0.1'
  'APP_VERSION=local'
)
[System.IO.File]::WriteAllLines($envPath,$configuration,(New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Created .env.docker with generated secrets. Run docker compose --env-file .env.docker up -d --build. Keep this file private.'

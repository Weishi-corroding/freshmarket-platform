# Control-flow checks for deploy/rollback/backup/restore.ps1. docker is a function double and the scripts run
# from a temporary copy of the project layout, so no containers, images, databases or real .env.docker are touched.
$ErrorActionPreference = 'Stop'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('fm-ops-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $work 'scripts') -Force | Out-Null
foreach ($name in @('deploy.ps1', 'rollback.ps1', 'backup.ps1', 'restore.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $work 'scripts') }
$backup = Join-Path $work 'sample.dump'; Set-Content -LiteralPath $backup -Value 'dump'
$global:opsProbe = $null
function docker {
  $line = $args -join ' '
  $global:opsProbe.Calls.Add($line)
  $global:LASTEXITCODE = 0
  if ($global:opsProbe.Failure -and $line -match $global:opsProbe.Failure) { $global:LASTEXITCODE = 1; return }
  # docker cp from the container: create the destination file like the real command would.
  if ($args[3] -eq 'cp' -and $args[4] -like 'postgres:*') { Set-Content -LiteralPath $args[5] -Value 'dump' }
}
function Invoke-Case([string]$script, [hashtable]$parameters, [string]$failure, [string]$history) {
  Set-Content -LiteralPath (Join-Path $work '.env.docker') -Value @('JWT_SECRET=x', 'APP_VERSION=v1')
  Remove-Item -LiteralPath (Join-Path $work '.deploy-history') -ErrorAction SilentlyContinue
  if ($history) { Set-Content -LiteralPath (Join-Path $work '.deploy-history') -Value ($history -split ',') }
  $global:opsProbe = @{ Calls = [System.Collections.Generic.List[string]]::new(); Failure = $failure }
  $result = @{ Output = @(); Failed = $false }
  try { $result.Output = @(& (Join-Path $work ('scripts/' + $script)) @parameters 2>&1 3>&1) } catch { $result.Failed = $true }
  $result.Calls = $global:opsProbe.Calls
  $result.Version = ([System.IO.File]::ReadAllLines((Join-Path $work '.env.docker')) | Where-Object { $_.StartsWith('APP_VERSION=') })
  $result.History = @(if (Test-Path -LiteralPath (Join-Path $work '.deploy-history')) { Get-Content -LiteralPath (Join-Path $work '.deploy-history') })
  return $result
}
function Assert([bool]$condition, [string]$message) { if (-not $condition) { throw ('FAIL ' + $message) }; Write-Output ('PASS ' + $message) }
$apiStart = 'up -d --no-deps --wait --wait-timeout 300 api$'
try {
  # deploy
  $r = Invoke-Case 'deploy.ps1' @{ Version = 'v2' } '' 'v1'
  Assert (-not $r.Failed -and $r.Version -eq 'APP_VERSION=v2' -and $r.History[-1] -eq 'v2') 'deploy records a healthy version'
  $r = Invoke-Case 'deploy.ps1' @{ Version = 'v2' } ' build ' 'v1'
  Assert ($r.Failed -and -not ($r.Calls -match ' up ') -and $r.Version -eq 'APP_VERSION=v1') 'deploy stops before touching services when the build fails'
  $r = Invoke-Case 'deploy.ps1' @{ Version = 'v2' } 'up -d --wait --wait-timeout 300$' 'v1'
  Assert ($r.Failed -and ($r.Calls -match 'no-build') -and $r.Version -eq 'APP_VERSION=v1' -and $r.History[-1] -eq 'v1') 'deploy restores the previous version when health checks fail'
  $r = Invoke-Case 'deploy.ps1' @{ Version = 'v2' } 'wget' 'v1'
  Assert ($r.Failed -and ($r.Calls -match 'no-build') -and $r.History[-1] -eq 'v1') 'deploy treats a failed gateway health probe as unhealthy'
  $r = Invoke-Case 'deploy.ps1' @{ Version = 'v1' } 'up -d --wait' ''
  Assert ($r.Failed -and -not ($r.Calls -match 'no-build')) 'first deploy failure leaves services for investigation'
  # rollback
  $r = Invoke-Case 'rollback.ps1' @{} '' 'v1,v2'
  Assert (-not $r.Failed -and $r.Version -eq 'APP_VERSION=v1' -and $r.History[-1] -eq 'v1') 'rollback defaults to the previous recorded version'
  $r = Invoke-Case 'rollback.ps1' @{} 'image inspect freshmarket-web' 'v1,v2'
  Assert ($r.Failed -and -not ($r.Calls -match ' up ')) 'rollback refuses when an image is missing'
  $r = Invoke-Case 'rollback.ps1' @{} '' 'v1'
  Assert ($r.Failed -and $r.Calls.Count -eq 0) 'rollback without history requires an explicit version'
  # backup
  $r = Invoke-Case 'backup.ps1' @{} '' ''
  Assert (-not $r.Failed -and ($r.Calls -match 'pg_restore --list') -and ($r.Calls[-1] -match 'rm -f')) 'backup verifies the dump and removes the container copy'
  $r = Invoke-Case 'backup.ps1' @{} 'pg_restore --list' ''
  Assert ($r.Failed -and -not ($r.Calls -match ' cp ') -and ($r.Calls[-1] -match 'rm -f')) 'backup fails on an unreadable dump and still cleans up'
  # restore
  $r = Invoke-Case 'restore.ps1' @{ BackupFile = $backup } '' ''
  Assert ($r.Failed -and $r.Calls.Count -eq 0) 'restore requires -Force'
  $r = Invoke-Case 'restore.ps1' @{ BackupFile = $backup; Force = $true } '' ''
  Assert (-not $r.Failed -and ($r.Calls -match 'pg_dump') -and ($r.Calls -match $apiStart)) 'restore backs up first and restarts the API'
  $r = Invoke-Case 'restore.ps1' @{ BackupFile = $backup; Force = $true } 'pg_dump' ''
  Assert ($r.Failed -and -not ($r.Calls -match 'stop api')) 'restore changes nothing when the pre-restore backup fails'
  $r = Invoke-Case 'restore.ps1' @{ BackupFile = $backup; Force = $true; SkipPreBackup = $true } '' ''
  Assert (-not $r.Failed -and -not ($r.Calls -match 'pg_dump')) 'restore -SkipPreBackup skips the safety backup'
  foreach ($failure in @('stop api', 'pg_restore -U', 'FLUSHDB')) {
    $r = Invoke-Case 'restore.ps1' @{ BackupFile = $backup; Force = $true; SkipPreBackup = $true } $failure ''
    Assert ($r.Failed -and -not ($r.Calls -match $apiStart)) ('restore keeps the API stopped after failure: ' + $failure)
  }
  $r = Invoke-Case 'restore.ps1' @{ BackupFile = $backup; Force = $true; SkipPreBackup = $true } $apiStart ''
  Assert ($r.Failed -and -not ($r.Output -match 'API restarted')) 'restore reports an unhealthy API as a failure'
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item Function:docker -ErrorAction SilentlyContinue
  Remove-Variable opsProbe -Scope Global -ErrorAction SilentlyContinue
}

# Isolated control-flow checks: docker is a function double; no containers or databases are changed.
$ErrorActionPreference = 'Stop'
$backup = [System.IO.Path]::GetTempFileName()
try {
  foreach ($failure in @('stop', 'pg_restore', 'FLUSHDB', 'start', 'none')) {
    $global:restoreProbe = @{ Calls = [System.Collections.Generic.List[string]]::new(); Failure = $failure }
    function docker {
      $global:restoreProbe.Calls.Add(($args -join ' '))
      $global:LASTEXITCODE = 0
      if ($global:restoreProbe.Failure -ne 'none' -and $args -contains $global:restoreProbe.Failure) { $global:LASTEXITCODE = 1 }
    }
    $output = @(); $caught = $false
    try { $output = @(& (Join-Path $PSScriptRoot 'restore.ps1') -BackupFile $backup) } catch { $caught = $true }
    if ($failure -eq 'none') {
      if ($caught -or -not ($output -match 'API restarted')) { throw 'Successful restore was not reported.' }
    } else {
      if (-not $caught -or ($output -match 'API restarted')) { throw ('Failure was reported as success: ' + $failure) }
      if ($failure -in @('stop', 'pg_restore', 'FLUSHDB') -and ($global:restoreProbe.Calls -match 'start api')) { throw ('API restarted after unsafe failure: ' + $failure) }
      if ($failure -eq 'stop' -and $global:restoreProbe.Calls.Count -ne 1) { throw 'Restore continued after stop failed.' }
    }
    Write-Output ('PASS restore control flow: ' + $failure)
  }
} finally { Remove-Item -LiteralPath $backup -ErrorAction SilentlyContinue; Remove-Item Function:docker -ErrorAction SilentlyContinue; Remove-Variable restoreProbe -Scope Global -ErrorAction SilentlyContinue }

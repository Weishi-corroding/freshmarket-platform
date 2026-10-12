$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ([int]((node --version).TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24+ is required.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
Write-Output 'FreshMarket shop: http://localhost:5173 | API docs: http://localhost:3001/api/docs'
Write-Output 'Local demo: member / admin / operator / warehouse / support / finance. Password: Fresh@123456'
npm.cmd run dev

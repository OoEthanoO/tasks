[CmdletBinding()]
param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Release,
    [Parameter(Mandatory)][int]$Port, [Parameter(Mandatory)][string]$Commit)
. (Join-Path $PSScriptRoot 'common.ps1')
$Release = Assert-UnderRoot $Release (Join-Path $Root 'releases')
$config = Read-Json (Join-Path $Root 'server.json')
Import-ProductionEnvironment $Root
$env:PORT = [string]$Port
$env:HOSTNAME = '127.0.0.1'
$env:YANTASKS_COMMIT_SHA = $Commit
$server = Join-Path $Release 'app\server.js'
$log = Join-Path $Root ('logs\web-' + $Port + '.log')
Set-Location (Join-Path $Release 'app')
while ($true) {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 10MB) { Move-Item -LiteralPath $log -Destination ($log + '.previous') -Force }
    try { Invoke-Tool $config.node @($server) $log } catch { Add-Content -LiteralPath $log -Value $_.Exception.Message }
    Start-Sleep -Seconds 5
}

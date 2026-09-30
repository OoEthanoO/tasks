[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanTasks')
$ErrorActionPreference = 'Stop'
$log = Join-Path $Root 'logs\poller.log'
try {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) { Move-Item -LiteralPath $log -Destination ($log+'.previous') -Force }
    & (Join-Path $Root 'ops\deploy.ps1') -Root $Root >> $log 2>&1
} catch {
    Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o')+' '+$_.Exception.Message)
    exit 1
}

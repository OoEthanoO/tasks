[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanTasks')
. (Join-Path $PSScriptRoot 'common.ps1')
$active = Read-Json (Join-Path $Root 'active.json')
[pscustomobject]@{active=$active;prepared=(Read-Json (Join-Path $Root 'prepared.json'));previous=(Read-Json (Join-Path $Root 'previous.json'))} | ConvertTo-Json -Depth 5
Get-ScheduledTask -TaskName 'yantasks-*' -ErrorAction SilentlyContinue | Select-Object TaskName,State | Format-Table
if ($active) {
    Write-Output ('Local health: '+(Test-Release $active 5))
    try {
        $public = Invoke-RestMethod 'https://tasks.ethanyanxu.com/api/health' -TimeoutSec 15
        Write-Output ('Public commit matches: '+($public.commit -eq $active.commit -and $public.hosting -eq 'finprint-host'))
    } catch { Write-Output 'Public health failed or DNS cutover is not complete.' }
}

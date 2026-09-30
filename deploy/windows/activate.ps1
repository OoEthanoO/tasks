[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanTasks', [switch]$Rollback)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
$lock = [IO.File]::Open((Join-Path $Root 'deploy.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $config = Read-Json (Join-Path $Root 'server.json')
    $old = Read-Json (Join-Path $Root 'active.json')
    $targetFile = if ($Rollback) { 'previous.json' } else { 'prepared.json' }
    $target = Read-Json (Join-Path $Root $targetFile)
    if (-not $target) { throw 'No saved release to activate.' }
    $null = Assert-UnderRoot $target.release (Join-Path $Root 'releases')
    if (-not (Test-Release $target 5)) {
        if (Get-NetTCPConnection -State Listen -LocalPort $target.port -ErrorAction SilentlyContinue) { throw 'Target port is occupied by an unexpected process.' }
        Register-WebTask $Root $target
    }
    if (-not (Test-Release $target)) { throw 'Saved release is unhealthy; traffic is unchanged.' }
    Switch-Caddy $Root $config $target.port
    if ($old -and $old.taskName -ne $target.taskName) { Write-Json (Join-Path $Root 'previous.json') $old }
    Write-Json (Join-Path $Root 'active.json') $target
    Copy-Item -Path (Join-Path $target.release 'ops\*.ps1') -Destination (Join-Path $Root 'ops') -Force
    if ($old -and $old.taskName -ne $target.taskName) { Start-Sleep -Seconds 20; Stop-WebTask $Root $old }
    Write-Output ('Activated '+$target.commit)
} finally { $lock.Dispose() }

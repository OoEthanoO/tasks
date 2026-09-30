# Windows PowerShell 5.1. All runtime state lives outside the source checkout.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-Administrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator access is required.' }
}
function Read-Json([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    return $null
}
function Write-Json([string]$Path, $Value) {
    $temporary = $Path + '.new'
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
}
function Assert-UnderRoot([string]$Path, [string]$Root) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside runtime root: $resolved" }
    return $resolved
}
function Import-ProductionEnvironment([string]$Root) {
    $values = Read-Json (Join-Path $Root 'secrets\production.json')
    if (-not $values -or [string]$values.DATABASE_URL -notmatch '^postgres(ql)?://') { throw 'Import the existing Neon DATABASE_URL into secrets\production.json first.' }
    $env:DATABASE_URL = [string]$values.DATABASE_URL
    $env:NODE_ENV = 'production'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:YANTASKS_HOST = 'finprint-host'
}
function Invoke-Tool([string]$File, [string[]]$Arguments, [string]$Log) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $File @Arguments >> $Log 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($code -ne 0) { throw "Tool failed ($code). See $Log" }
}
function Test-Release($State, [int]$Seconds = 45) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $health = Invoke-RestMethod -Uri ('http://127.0.0.1:{0}/api/health' -f $State.port) -TimeoutSec 5
            if ($health.status -eq 'ok' -and $health.commit -eq $State.commit -and $health.hosting -eq 'finprint-host') { return $true }
        } catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return $false
}
function Register-WebTask([string]$Root, $State) {
    $release = Assert-UnderRoot $State.release (Join-Path $Root 'releases')
    if ($State.taskName -notmatch '^yantasks-web-[a-f0-9]{12}-\d{14}$' -or $State.port -notin 3200,3201) { throw 'Invalid release metadata.' }
    $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Root "{1}" -Release "{2}" -Port {3} -Commit {4}' -f (Join-Path $release 'ops\run.ps1'),$Root,$release,$State.port,$State.commit
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $release
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $State.taskName -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
        -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Start-ScheduledTask -TaskName $State.taskName
}
function Stop-WebTask([string]$Root, $State) {
    if (-not $State -or $State.taskName -notmatch '^yantasks-web-[a-f0-9]{12}-\d{14}$') { return }
    $release = Assert-UnderRoot $State.release (Join-Path $Root 'releases')
    Disable-ScheduledTask -TaskName $State.taskName -ErrorAction SilentlyContinue | Out-Null
    Stop-ScheduledTask -TaskName $State.taskName -ErrorAction SilentlyContinue
    $server = Join-Path $release 'app\server.js'
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains('"' + $server + '"')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Switch-Caddy([string]$Root, $Config, [int]$Port) {
    if ($Port -notin 3200,3201) { throw 'Unexpected YanTasks port.' }
    $sitePath = Join-Path $Root 'Caddyfile'
    $oldSite = if (Test-Path -LiteralPath $sitePath) { [IO.File]::ReadAllText($sitePath) } else { $null }
    $oldMain = [IO.File]::ReadAllText($Config.mainCaddyfile)
    $staticPath = (Join-Path $Root 'static') -replace '\\','/'
    $logPath = (Join-Path $Root 'logs\access.log') -replace '\\','/'
    $site = @"
tasks.ethanyanxu.com {
    encode zstd gzip
    header X-YanTasks-Host finprint-host
    request_body {
        max_size 10MB
    }
    handle_path /_next/static/* {
        root * $staticPath
        header Cache-Control "public, max-age=31536000, immutable"
        file_server
    }
    handle {
        reverse_proxy 127.0.0.1:$Port {
            # Do not trust a client-supplied X-Forwarded-For login throttle key.
            header_up X-Forwarded-For {remote_host}
        }
    }
    log {
        output file $logPath {
            roll_size 10MB
            roll_keep 3
        }
    }
}
"@
    $log = Join-Path $Root 'logs\caddy-reload.log'
    $utf8 = New-Object Text.UTF8Encoding $false
    $nextMain = $oldMain
    $marker = '# BEGIN YanTasks (managed)'
    if (-not $oldMain.Contains($marker)) {
        $import = $sitePath -replace '\\','/'
        $nextMain = $oldMain.TrimEnd() + "`r`n`r`n$marker`r`nimport $import`r`n# END YanTasks (managed)`r`n"
    }
    try {
        if ($oldMain -ne $nextMain) {
            Copy-Item -LiteralPath $Config.mainCaddyfile -Destination (Join-Path $Root ('logs\Caddyfile-before-' + (Get-Date -Format 'yyyyMMddHHmmss')))
            [IO.File]::WriteAllText($Config.mainCaddyfile, $nextMain, $utf8)
        }
        [IO.File]::WriteAllText($sitePath, $site, $utf8)
        Invoke-Tool $Config.caddy @('validate','--config',$Config.mainCaddyfile,'--adapter','caddyfile') $log
        Invoke-Tool $Config.caddy @('reload','--config',$Config.mainCaddyfile,'--adapter','caddyfile') $log
    } catch {
        # Do not overwrite another site's concurrent edit when reverting ours.
        if ([IO.File]::ReadAllText($Config.mainCaddyfile) -eq $nextMain) { [IO.File]::WriteAllText($Config.mainCaddyfile, $oldMain, $utf8) }
        if ($null -ne $oldSite) { [IO.File]::WriteAllText($sitePath, $oldSite, $utf8) }
        try { Invoke-Tool $Config.caddy @('reload','--config',$Config.mainCaddyfile,'--adapter','caddyfile') $log } catch {}
        throw
    }
}

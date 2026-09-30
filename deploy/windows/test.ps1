# No server, network, scheduled tasks or production settings are touched.
. (Join-Path $PSScriptRoot 'common.ps1')
$root = 'C:\ProgramData\YanTasks\releases'
if ((Assert-UnderRoot "$root\fixture" $root) -ne "$root\fixture") { throw 'Valid child rejected.' }
foreach ($unsafe in @($root, 'C:\', "$root\..\secrets", 'C:\ProgramData\YanTasks-other\fixture')) {
    $rejected = $false
    try { $null = Assert-UnderRoot $unsafe $root } catch { $rejected = $true }
    if (-not $rejected) { throw "Unsafe path accepted: $unsafe" }
}
$errorsFound = @()
Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' | ForEach-Object {
    $tokens = $null; $parseErrors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors)
    $errorsFound += $parseErrors
}
if ($errorsFound.Count) { throw ($errorsFound | Out-String) }
Write-Output 'Deployment syntax and path-boundary tests passed.'

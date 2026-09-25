$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$siteOutput = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
if ($siteOutput -ne (Join-Path $projectRoot 'dist')) { throw 'Unexpected build directory.' }
if (Test-Path -LiteralPath $siteOutput) {
    $resolvedOutput = (Resolve-Path -LiteralPath $siteOutput).Path
    if ($resolvedOutput -ne $siteOutput -or (Get-Item -LiteralPath $siteOutput).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Build directory must be a regular directory inside this repository.'
    }
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}
New-Item -ItemType Directory -Path $siteOutput | Out-Null
# Explicit public-file list: never upload the repository, backend, tests, or credentials.
foreach ($file in @('index.html', 'dashboard.js', 'support.css')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $siteOutput
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets') -Destination $siteOutput -Recurse
Write-Host 'Built public site in dist/.'

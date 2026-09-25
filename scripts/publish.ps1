$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $projectRoot
try {
    $branch = git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Publish requires the main branch.' }
    $changes = git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Commit the requested changes before publishing; working tree must be clean.' }
    node --check dashboard.js
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript check failed.' }
    node --test tests/rewards.test.mjs tests/offers.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Backend regression checks failed.' }
    python tests/ui_smoke.py
    if ($LASTEXITCODE -ne 0) { throw 'Browser regression checks failed.' }
    & (Join-Path $PSScriptRoot 'build-site.ps1')
    Push-Location backend
    try {
        npx --no-install wrangler deploy --dry-run
        if ($LASTEXITCODE -ne 0) { throw 'Cloudflare build failed.' }
    } finally { Pop-Location }
    git -c credential.https://github.com.helper= -c credential.helper=manager push origin main
    if ($LASTEXITCODE -ne 0) { throw 'Origin push failed; Cloudflare deployment stopped.' }
    Push-Location backend
    try {
        npx --no-install wrangler deploy
        if ($LASTEXITCODE -ne 0) { throw 'Cloudflare deployment failed. Origin was pushed; retry deployment.' }
    } finally { Pop-Location }
    Write-Host 'Pushed origin/main and deployed the site and API to Cloudflare.'
} finally { Pop-Location }

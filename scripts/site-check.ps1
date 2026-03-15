param()

$common = Join-Path $PSScriptRoot '_site-common.ps1'
. $common

$repoRoot = Get-RepoRoot -ScriptPath $PSCommandPath
$siteRoot = Get-SiteRoot -RepoRoot $repoRoot

Write-Step "Repo root: $repoRoot"
Write-Step "Site root: $siteRoot"
Invoke-NpmScript -WorkingDirectory $siteRoot -ScriptName 'check'
Write-Host 'Site check passed.' -ForegroundColor Green

param(
	[switch]$Help
)

if ($args -contains '--help') { $Help = $true }

if ($Help) {
	Write-Host 'Usage: scripts\site-status.bat'
	Write-Host 'Shows the operator-safe status for this repo.'
	Write-Host 'Use this instead of raw git status when you are not sure what to do next.'
	exit 0
}

$common = Join-Path $PSScriptRoot '_site-common.ps1'
. $common

$repoRoot = Get-RepoRoot -ScriptPath $PSCommandPath
$branch = Get-CurrentBranch -RepoRoot $repoRoot
$statusLines = Get-GitStatus -RepoRoot $repoRoot
$summary = Get-ChangeSummary -RepoRoot $repoRoot

Write-Step "Repo root: $repoRoot"
Write-Step "Current branch: $branch"

if ($statusLines.Count -eq 0) {
	Write-Host 'Working tree: clean' -ForegroundColor Green
} else {
	Write-Host 'Working tree: changes detected' -ForegroundColor Yellow
	$statusLines | ForEach-Object { Write-Host "  $_" }
}

Write-Host ''
Write-Host 'Deployment impact:' -ForegroundColor Cyan
if ($summary.NeedsPartyKitDeploy) {
	Write-Host '  - PartyKit deploy will be needed for the changed/unpushed files.' -ForegroundColor Yellow
} else {
	Write-Host '  - No PartyKit deploy detected from the current changed/unpushed files.' -ForegroundColor Green
}

if ($summary.UnpushedFiles.Count -gt 0) {
	Write-Host '  - There are unpushed commits on this branch.' -ForegroundColor Yellow
} else {
	Write-Host '  - No unpushed commits detected.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Recommended commands:' -ForegroundColor Cyan
if ($statusLines.Count -gt 0) {
	Write-Host '  1. scripts\site-save.bat --message "describe your change"'
		Write-Host '  2. scripts\site-ship.bat'
} else {
	Write-Host '  1. scripts\site-ship.bat'
}

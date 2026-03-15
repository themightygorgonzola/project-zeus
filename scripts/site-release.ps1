param(
	[switch]$SkipCheck,
	[switch]$SkipPush,
	[switch]$SkipPartyDeploy,
	[switch]$AllowDirty,
	[switch]$Help
)

if ($args -contains '--skip-check') { $SkipCheck = $true }
if ($args -contains '--skip-push') { $SkipPush = $true }
if ($args -contains '--skip-party-deploy') { $SkipPartyDeploy = $true }
if ($args -contains '--allow-dirty') { $AllowDirty = $true }
if ($args -contains '--help') { $Help = $true }

if ($Help) {
	Write-Host 'Usage: scripts\site-release.bat [--skip-check] [--skip-push] [--skip-party-deploy] [--allow-dirty]'
	Write-Host 'Runs the safe production release flow for the site app.'
	Write-Host '  - validates the app with svelte-check'
	Write-Host '  - optionally pushes the current git branch (Vercel + Trigger auto-deploy on push)'
	Write-Host '  - optionally deploys PartyKit manually'
	exit 0
}

$common = Join-Path $PSScriptRoot '_site-common.ps1'
. $common

$repoRoot = Get-RepoRoot -ScriptPath $PSCommandPath
$siteRoot = Get-SiteRoot -RepoRoot $repoRoot
$branch = Get-CurrentBranch -RepoRoot $repoRoot

Write-Step "Repo root: $repoRoot"
Write-Step "Site root: $siteRoot"
Write-Step "Current branch: $branch"

$status = Get-GitStatus -RepoRoot $repoRoot
if ($status.Count -gt 0 -and -not $AllowDirty) {
	Write-Host 'Working tree is not clean:' -ForegroundColor Yellow
	$status | ForEach-Object { Write-Host "  $_" }
	throw 'Refusing release with uncommitted changes. Commit/stash first or rerun with -AllowDirty.'
}

if (-not $SkipCheck) {
	Invoke-NpmScript -WorkingDirectory $siteRoot -ScriptName 'check'
} else {
	Write-Step 'Skipping site check'
}

if (-not $SkipPush) {
	Invoke-GitPush -RepoRoot $repoRoot
} else {
	Write-Step 'Skipping git push'
}

if (-not $SkipPartyDeploy) {
	Invoke-NpmScript -WorkingDirectory $siteRoot -ScriptName 'party:deploy'
} else {
	Write-Step 'Skipping PartyKit deploy'
}

Write-Host ''
Write-Host 'Release flow completed.' -ForegroundColor Green
Write-Host 'What should be deployed now:' -ForegroundColor Green
if ($SkipPush) {
	Write-Host '  - Vercel: NOT triggered because push was skipped.'
	Write-Host '  - Trigger.dev: NOT triggered because push was skipped.'
} else {
	if ($branch -eq 'main') {
		Write-Host '  - Vercel: production deploy should be running from the git push.'
		Write-Host '  - Trigger.dev: production GitHub Action should be deploying tasks from the git push.'
	} else {
		Write-Host "  - Vercel: pushing '$branch' may create a preview deployment, not a production one."
		Write-Host "  - Trigger.dev: the production workflow only runs on 'main'; '$branch' will not trigger it."
	}
}
if ($SkipPartyDeploy) {
	Write-Host '  - PartyKit: NOT deployed because it was skipped.'
} else {
	Write-Host '  - PartyKit: deployed by this script.'
}

Write-Host ''
Write-Host 'Recommended follow-up checks:' -ForegroundColor Cyan
Write-Host '  1. GitHub Actions: confirm Trigger.dev workflow succeeded.'
Write-Host '  2. Vercel dashboard: confirm the latest deployment is healthy.'
Write-Host '  3. PartyKit: smoke test lobby ready state + /gm in a live adventure.'

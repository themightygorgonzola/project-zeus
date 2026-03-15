param(
	[string]$Message,
	[switch]$SkipCheck,
	[switch]$SkipPartyDeploy,
	[switch]$ForcePartyDeploy,
	[switch]$Help
)

for ($i = 0; $i -lt $args.Count; $i++) {
	if ($args[$i] -eq '--message' -and $i + 1 -lt $args.Count) { $Message = $args[$i + 1] }
	if ($args[$i] -eq '--skip-check') { $SkipCheck = $true }
	if ($args[$i] -eq '--skip-party-deploy') { $SkipPartyDeploy = $true }
	if ($args[$i] -eq '--force-party-deploy') { $ForcePartyDeploy = $true }
	if ($args[$i] -eq '--help') { $Help = $true }
}

if ($Help) {
	Write-Host 'Usage: scripts\site-ship.bat [--message "describe your change"] [--skip-check] [--skip-party-deploy] [--force-party-deploy]'
	Write-Host 'No-brainer operator flow:'
	Write-Host '  - validates the site'
	Write-Host '  - creates a commit if there are uncommitted changes and a message is provided'
	Write-Host '  - pushes to git'
	Write-Host '  - deploys PartyKit only when needed (or when forced)'
	Write-Host 'Use this instead of raw git push / manual release commands.'
	exit 0
}

$common = Join-Path $PSScriptRoot '_site-common.ps1'
. $common

$repoRoot = Get-RepoRoot -ScriptPath $PSCommandPath
$siteRoot = Get-SiteRoot -RepoRoot $repoRoot
$branch = Get-CurrentBranch -RepoRoot $repoRoot
$status = @(Get-GitStatus -RepoRoot $repoRoot)
$preSummary = Get-ChangeSummary -RepoRoot $repoRoot

Write-Step "Repo root: $repoRoot"
Write-Step "Site root: $siteRoot"
Write-Step "Current branch: $branch"

if (-not $SkipCheck) {
	Invoke-NpmScript -WorkingDirectory $siteRoot -ScriptName 'check'
} else {
	Write-Step 'Skipping site check'
}

if ($status.Count -gt 0) {
	if ([string]::IsNullOrWhiteSpace($Message)) {
		throw 'There are uncommitted changes. Re-run with --message "describe your change" so the script can save them first.'
	}

	Invoke-GitAddAll -RepoRoot $repoRoot
	Invoke-GitCommit -RepoRoot $repoRoot -Message $Message
} else {
	Write-Step 'No uncommitted changes detected'
}

$postSummary = Get-ChangeSummary -RepoRoot $repoRoot
Invoke-GitPush -RepoRoot $repoRoot

$needsPartyDeploy = $ForcePartyDeploy -or $postSummary.NeedsPartyKitDeploy
if ($SkipPartyDeploy) {
	Write-Step 'Skipping PartyKit deploy'
} elseif ($needsPartyDeploy) {
	Invoke-NpmScript -WorkingDirectory $siteRoot -ScriptName 'party:deploy'
} else {
	Write-Step 'No PartyKit changes detected; skipping PartyKit deploy'
}

Write-Host ''
Write-Host 'Ship flow completed.' -ForegroundColor Green
if ($branch -eq 'main') {
	Write-Host '  - Vercel: production deploy should now be running.'
	Write-Host '  - Trigger.dev: production GitHub Action should now be running.'
} else {
	Write-Host "  - Vercel: branch '$branch' may create a preview deployment only."
	Write-Host "  - Trigger.dev: production workflow only runs on main."
}
if ($SkipPartyDeploy) {
	Write-Host '  - PartyKit: skipped by operator flag.'
} elseif ($needsPartyDeploy) {
	Write-Host '  - PartyKit: deployed by this script.'
} else {
	Write-Host '  - PartyKit: no deploy was needed.'
}

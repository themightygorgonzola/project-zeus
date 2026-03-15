param(
	[string]$Message,
	[switch]$SkipCheck,
	[switch]$Help
)

for ($i = 0; $i -lt $args.Count; $i++) {
	if ($args[$i] -eq '--message' -and $i + 1 -lt $args.Count) { $Message = $args[$i + 1] }
	if ($args[$i] -eq '--skip-check') { $SkipCheck = $true }
	if ($args[$i] -eq '--help') { $Help = $true }
}

if ($Help) {
	Write-Host 'Usage: scripts\site-save.bat --message "describe your change" [--skip-check]'
	Write-Host 'Stages all changes, optionally validates the site, and creates a git commit.'
	Write-Host 'Use this instead of raw git add/git commit.'
	exit 0
}

if ([string]::IsNullOrWhiteSpace($Message)) {
	throw 'A commit message is required. Example: scripts\site-save.bat --message "fix lobby UI"'
}

$common = Join-Path $PSScriptRoot '_site-common.ps1'
. $common

$repoRoot = Get-RepoRoot -ScriptPath $PSCommandPath
$siteRoot = Get-SiteRoot -RepoRoot $repoRoot
$status = @(Get-GitStatus -RepoRoot $repoRoot)

if ($status.Count -eq 0) {
	Write-Host 'No changes to save.' -ForegroundColor Yellow
	exit 0
}

if (-not $SkipCheck) {
	Invoke-NpmScript -WorkingDirectory $siteRoot -ScriptName 'check'
} else {
	Write-Step 'Skipping site check'
}

Invoke-GitAddAll -RepoRoot $repoRoot
Invoke-GitCommit -RepoRoot $repoRoot -Message $Message
Write-Host 'Changes saved.' -ForegroundColor Green
Write-Host 'Next step: scripts\site-ship.bat' -ForegroundColor Cyan

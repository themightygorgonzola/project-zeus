param(
	[switch]$App,
	[switch]$Party,
	[switch]$Trigger,
	[switch]$Help
)

if ($args -contains '--app') { $App = $true }
if ($args -contains '--party') { $Party = $true }
if ($args -contains '--trigger') { $Trigger = $true }
if ($args -contains '--help') { $Help = $true }

if ($Help) {
	Write-Host 'Usage: scripts\site-dev.bat [--app] [--party] [--trigger]'
	Write-Host 'No flags = launch all three local dev processes in separate cmd.exe windows.'
	Write-Host '  --app     Launch Vite / SvelteKit dev server'
	Write-Host '  --party   Launch PartyKit dev server'
	Write-Host '  --trigger Launch Trigger.dev local dev tunnel'
	exit 0
}

$common = Join-Path $PSScriptRoot '_site-common.ps1'
. $common

$repoRoot = Get-RepoRoot -ScriptPath $PSCommandPath
$siteRoot = Get-SiteRoot -RepoRoot $repoRoot
$npmCmd = Get-NpmCmd

if (-not $App -and -not $Party -and -not $Trigger) {
	$App = $true
	$Party = $true
	$Trigger = $true
}

function Start-DevWindow {
	param(
		[string]$Title,
		[string]$ScriptName
	)

	$cmdLine = ('title {0} && cd /d "{1}" && "{2}" run {3}' -f $Title, $siteRoot, $npmCmd, $ScriptName)
	Write-Step "Launching $Title"
	Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $cmdLine | Out-Null
}

if ($App) { Start-DevWindow -Title 'Project Zeus - App' -ScriptName 'dev' }
if ($Party) { Start-DevWindow -Title 'Project Zeus - PartyKit' -ScriptName 'party:dev' }
if ($Trigger) { Start-DevWindow -Title 'Project Zeus - Trigger' -ScriptName 'trigger:dev' }

Write-Host 'Launched requested dev processes.' -ForegroundColor Green

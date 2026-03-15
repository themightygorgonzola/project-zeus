Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
	param([string]$ScriptPath)
	return (Resolve-Path (Join-Path (Split-Path -Parent $ScriptPath) '..')).Path
}

function Get-SiteRoot {
	param([string]$RepoRoot)
	return (Join-Path $RepoRoot 'site')
}

function Write-Step {
	param([string]$Message)
	Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-NpmCmd {
	$default = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
	if (Test-Path $default) { return $default }

	$cmd = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }

	throw 'Could not find npm.cmd. Install Node.js or add npm.cmd to PATH.'
}

function Ensure-Git {
	$gitCmd = Get-Command 'git' -ErrorAction SilentlyContinue
	if ($gitCmd) { return $gitCmd.Source }

	$commonGitPath = 'C:\Program Files\Git\cmd'
	if (Test-Path $commonGitPath) {
		$env:PATH += ";$commonGitPath"
	}

	$gitCmd = Get-Command 'git' -ErrorAction SilentlyContinue
	if ($gitCmd) { return $gitCmd.Source }

	throw 'Could not find git. Install Git for Windows or add it to PATH.'
}

function Invoke-NpmScript {
	param(
		[string]$WorkingDirectory,
		[string]$ScriptName,
		[string[]]$Arguments = @()
	)

	$npmCmd = Get-NpmCmd
	Push-Location $WorkingDirectory
	try {
		Write-Step "Running npm script '$ScriptName' in $WorkingDirectory"
		& $npmCmd run $ScriptName -- @Arguments
		if ($LASTEXITCODE -ne 0) {
			throw "npm script '$ScriptName' failed with exit code $LASTEXITCODE."
		}
	} finally {
		Pop-Location
	}
}

function Get-GitStatus {
	param([string]$RepoRoot)

	Ensure-Git | Out-Null
	Push-Location $RepoRoot
	try {
		$lines = & git status --short
		if ($LASTEXITCODE -ne 0) {
			throw 'git status failed.'
		}
		return @($lines)
	} finally {
		Pop-Location
	}
}

function Invoke-GitAddAll {
	param([string]$RepoRoot)

	Ensure-Git | Out-Null
	Push-Location $RepoRoot
	try {
		Write-Step 'Staging all changes'
		& git add -A
		if ($LASTEXITCODE -ne 0) {
			throw 'git add -A failed.'
		}
	} finally {
		Pop-Location
	}
}

function Invoke-GitCommit {
	param(
		[string]$RepoRoot,
		[string]$Message
	)

	if ([string]::IsNullOrWhiteSpace($Message)) {
		throw 'Commit message is required.'
	}

	Ensure-Git | Out-Null
	Push-Location $RepoRoot
	try {
		Write-Step "Creating commit: $Message"
		& git commit -m $Message
		if ($LASTEXITCODE -ne 0) {
			throw 'git commit failed.'
		}
	} finally {
		Pop-Location
	}
}

function Invoke-GitPush {
	param([string]$RepoRoot)

	Ensure-Git | Out-Null
	Push-Location $RepoRoot
	try {
		Write-Step 'Pushing current branch to origin'
		& git push
		if ($LASTEXITCODE -ne 0) {
			throw 'git push failed.'
		}
	} finally {
		Pop-Location
	}
}

function Get-CurrentBranch {
	param([string]$RepoRoot)

	Ensure-Git | Out-Null
	Push-Location $RepoRoot
	try {
		$branch = (& git branch --show-current).Trim()
		if ($LASTEXITCODE -ne 0) {
			throw 'Could not determine current git branch.'
		}
		return $branch
	} finally {
		Pop-Location
	}
}

function Get-WorkingTreeFiles {
	param([string]$RepoRoot)

	Ensure-Git | Out-Null
	Push-Location $RepoRoot
	try {
		$modified = @(& git diff --name-only)
		$staged = @(& git diff --cached --name-only)
		$untracked = @(& git ls-files --others --exclude-standard)

		if ($LASTEXITCODE -ne 0) {
			throw 'Could not determine working tree files.'
		}

		return @($modified + $staged + $untracked | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
	} finally {
		Pop-Location
	}
}

function Get-UnpushedFiles {
	param([string]$RepoRoot)

	Ensure-Git | Out-Null
	Push-Location $RepoRoot
	try {
		$hasUpstream = $true
		& git rev-parse --abbrev-ref '@{u}' *> $null
		if ($LASTEXITCODE -ne 0) {
			$hasUpstream = $false
		}

		if (-not $hasUpstream) {
			return @()
		}

		$files = @(& git diff --name-only '@{u}..HEAD')
		if ($LASTEXITCODE -ne 0) {
			throw 'Could not determine unpushed files.'
		}

		return @($files | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
	} finally {
		Pop-Location
	}
}

function Test-PartyKitChangeSet {
	param([string[]]$Files)

	foreach ($file in $Files) {
		if ($file -match '^site/party/' -or $file -eq 'site/partykit.json') {
			return $true
		}
	}

	return $false
}

function Get-ChangeSummary {
	param([string]$RepoRoot)

	$working = @(Get-WorkingTreeFiles -RepoRoot $RepoRoot)
	$unpushed = @(Get-UnpushedFiles -RepoRoot $RepoRoot)
	$combined = @($working + $unpushed | Sort-Object -Unique)

	[pscustomobject]@{
		WorkingTreeFiles = @($working)
		UnpushedFiles = @($unpushed)
		CombinedFiles = @($combined)
		NeedsPartyKitDeploy = (Test-PartyKitChangeSet -Files $combined)
	}
}

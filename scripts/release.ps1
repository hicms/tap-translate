<###
.SYNOPSIS
Creates and publishes a TapTranslate release tag.

.DESCRIPTION
Requires a clean main branch that matches origin/main. The script increments
the extension patch version by default (or uses an explicit SemVer), updates
package.json and package-lock.json through npm, commits the version, creates an
annotated tag, and atomically pushes main plus the tag. GitHub Actions builds
and publishes the GitHub Release from that tag.

.PARAMETER Publish
Perform the version update, commit, tag, and push.

.PARAMETER Version
Explicit major.minor.patch version. Defaults to the current patch plus one.

.PARAMETER NoWait
Do not wait for GitHub Actions or verify the published Release.

.PARAMETER Help
Show usage without changing the repository.

.EXAMPLE
.\scripts\release.ps1 -Publish

.EXAMPLE
.\scripts\release.ps1 -Publish -Version 0.2.0
###>
param(
    [switch] $Publish,
    [string] $Version,
    [switch] $NoWait,
    [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$usage = @'
Usage: .\scripts\release.ps1 -Publish [-Version 0.2.0] [-NoWait]
       .\scripts\release.ps1 -Help

The default version is the current patch version plus one. The script requires
a clean main branch matching origin/main, then updates extension/package.json
and extension/package-lock.json, commits Release vX.Y.Z, creates an annotated
tag, and atomically pushes main and the tag. GitHub Actions creates the Release.
Use -NoWait to return immediately after the push.
'@

if ($Help) {
    Write-Host $usage
    return
}

if (-not $Publish) {
    Write-Host $usage
    exit 1
}

function Resolve-CanonicalPath {
    param([Parameter(Mandatory)][string] $Path)

    $canonical = & node -e "const fs=require('node:fs'); process.stdout.write(fs.realpathSync(process.argv[1]));" -- $Path
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($canonical -join ''))) {
        return ($canonical -join '').Trim()
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Invoke-Git {
    param([Parameter(Mandatory)][string[]] $GitArgs)

    $output = & git @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed (exit $LASTEXITCODE): $($output -join ' ')"
    }
    return @($output)
}

function Get-GitText {
    param([Parameter(Mandatory)][string[]] $GitArgs)
    return ((Invoke-Git $GitArgs) -join "`n").Trim()
}

function Invoke-Gh {
    param([Parameter(Mandatory)][string[]] $GhArgs)

    $output = & gh @GhArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gh $($GhArgs -join ' ') failed (exit $LASTEXITCODE): $($output -join ' ')"
    }
    return @($output)
}

function ConvertTo-ReleaseVersion {
    param([Parameter(Mandatory)][string] $Value)

    if ($Value -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        throw "Invalid version '$Value'. Use major.minor.patch, for example 0.2.0."
    }
    return [version] $Value
}

function Assert-ReleaseAssets {
    param(
        [Parameter(Mandatory)][string] $Repository,
        [Parameter(Mandatory)][string] $Tag
    )

    $releaseJson = ((Invoke-Gh @('release', 'view', $Tag, '--repo', $Repository, '--json', 'url,assets')) -join "`n")
    $release = $releaseJson | ConvertFrom-Json
    $expected = @(
        "tap-translate-chrome-$Tag.zip",
        "tap-translate-chrome-$Tag.sha256",
        "tap-translate-firefox-$Tag.zip",
        "tap-translate-firefox-$Tag.sha256"
    )
    $actual = @($release.assets | ForEach-Object { $_.name })
    foreach ($asset in $expected) {
        if ($asset -cnotin $actual) {
            throw "GitHub Release $Tag is missing $asset."
        }
    }
    Write-Host "Release published and verified: $($release.url)"
}

$root = Resolve-CanonicalPath (Join-Path $PSScriptRoot '..')
$extensionRoot = Join-Path $root 'extension'
$packagePath = Join-Path $extensionRoot 'package.json'
$lockPath = Join-Path $extensionRoot 'package-lock.json'
$packagePaths = @('extension/package.json', 'extension/package-lock.json')

try {
    Push-Location $root
    try {
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            throw 'GitHub CLI (gh) is required. Install it and run gh auth login before publishing.'
        }

        $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
        $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json -AsHashtable
        $lockRoot = $lock['packages']['']['version']
        if ([string]::IsNullOrWhiteSpace($package.version) -or
            $lock['version'] -cne $package.version -or
            $lockRoot -cne $package.version) {
            throw 'extension/package.json and extension/package-lock.json versions must match before releasing.'
        }

        $currentParsed = ConvertTo-ReleaseVersion $package.version
        $targetVersion = if ($PSBoundParameters.ContainsKey('Version')) {
            $Version
        } else {
            '{0}.{1}.{2}' -f $currentParsed.Major, $currentParsed.Minor, ($currentParsed.Build + 1)
        }
        $targetParsed = ConvertTo-ReleaseVersion $targetVersion
        if ($targetParsed -le $currentParsed) {
            throw "Release version $targetVersion must be newer than $($package.version)."
        }
        $tag = "v$targetVersion"

        if (Get-GitText @('status', '--porcelain', '--untracked-files=all')) {
            throw 'The working tree is not clean. Commit source changes before releasing.'
        }
        $branch = Get-GitText @('symbolic-ref', '--quiet', '--short', 'HEAD')
        if ($branch -cne 'main') {
            throw "Release from main, not '$branch'."
        }
        $localHead = Get-GitText @('rev-parse', 'HEAD')
        $remoteMain = Get-GitText @('ls-remote', '--heads', 'origin', 'main')
        $remoteHead = ($remoteMain -split '\s+')[0]
        if ([string]::IsNullOrWhiteSpace($remoteHead) -or $remoteHead -cne $localHead) {
            throw 'Local main must match origin/main. Push the source commit first.'
        }
        if (Get-GitText @('tag', '--list', $tag)) {
            throw "Local tag $tag already exists."
        }
        if (Get-GitText @('ls-remote', '--refs', '--tags', 'origin', "refs/tags/$tag")) {
            throw "Remote tag $tag already exists."
        }

        $repository = ((Invoke-Gh @('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner')) -join "`n").Trim()
        if ([string]::IsNullOrWhiteSpace($repository)) {
            throw 'Could not identify the GitHub repository.'
        }

        Push-Location $extensionRoot
        try {
            & npm.cmd version $targetVersion --no-git-tag-version
            if ($LASTEXITCODE -ne 0) {
                throw "npm version failed with exit code $LASTEXITCODE."
            }
        } finally {
            Pop-Location
        }

        $changed = @(Invoke-Git @('status', '--porcelain', '--untracked-files=all'))
        foreach ($line in $changed) {
            if ($line -notmatch 'extension/(package\.json|package-lock\.json)$') {
                throw "Version update changed an unexpected path: $line"
            }
        }
        Invoke-Git (@('add', '--') + $packagePaths) | Out-Null
        Invoke-Git (@('commit', '-m', "Release $tag", '--') + $packagePaths) | Out-Host
        if (Get-GitText @('status', '--porcelain', '--untracked-files=all')) {
            throw 'The version commit left unexpected working-tree changes.'
        }

        $localHead = Get-GitText @('rev-parse', 'HEAD')
        Invoke-Git @('tag', '-a', $tag, '-m', "Release $tag") | Out-Null
        try {
            Invoke-Git @('push', '--atomic', 'origin', 'main', "refs/tags/$tag") | Out-Host
        } catch {
            throw "Release commit and tag $tag are local; atomic push failed. Retry with: git push --atomic origin main refs/tags/$tag. $($_.Exception.Message)"
        }
        Write-Host "Pushed main and $tag to origin."

        if (-not $NoWait) {
            $runId = $null
            for ($attempt = 0; $attempt -lt 60; $attempt++) {
                $runsJson = ((Invoke-Gh @('run', 'list', '--repo', $repository, '--workflow', 'release.yml', '--event', 'push', '--limit', '20', '--json', 'databaseId,headSha,headBranch')) -join "`n")
                $runs = @($runsJson | ConvertFrom-Json)
                $run = $runs | Where-Object { $_.headSha -ceq $localHead -and $_.headBranch -ceq $tag } | Select-Object -First 1
                if ($run) {
                    $runId = $run.databaseId
                    break
                }
                Start-Sleep -Seconds 3
            }
            if (-not $runId) {
                throw "No GitHub Actions release run appeared for $tag. Check the Actions page."
            }
            & gh run watch $runId --repo $repository --exit-status
            if ($LASTEXITCODE -ne 0) {
                throw "GitHub Actions release workflow failed: https://github.com/$repository/actions/runs/$runId"
            }
            Assert-ReleaseAssets -Repository $repository -Tag $tag
        } else {
            Write-Host "Release workflow: https://github.com/$repository/actions"
            Write-Host "Release URL (after workflow completes): https://github.com/$repository/releases/tag/$tag"
        }
    } finally {
        Pop-Location
    }
} catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

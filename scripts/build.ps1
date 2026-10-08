<###
.SYNOPSIS
Builds the TapTranslate extension and creates browser zip archives.

.PARAMETER SkipQuality
Skip TypeScript, ESLint and unit-test checks. The production builds still run.

.PARAMETER ChromeOnly
Build only the Chrome MV3 package.

.PARAMETER FirefoxOnly
Build only the Firefox MV3 package.

.PARAMETER Help
Show usage without building.

.EXAMPLE
.\scripts\build.ps1

.EXAMPLE
.\scripts\build.ps1 -ChromeOnly -SkipQuality
###>
param(
    [switch] $SkipQuality,
    [switch] $ChromeOnly,
    [switch] $FirefoxOnly,
    [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$usage = @'
Usage: .\scripts\build.ps1 [-SkipQuality] [-ChromeOnly | -FirefoxOnly]
       .\scripts\build.ps1 -Help

The default build runs compile, lint, unit tests, and packages both Chrome and
Firefox under artifacts/extension/. Use -SkipQuality for a faster local build.
'@

if ($Help) {
    Write-Host $usage
    return
}

if ($ChromeOnly -and $FirefoxOnly) {
    throw 'Choose at most one of -ChromeOnly and -FirefoxOnly.'
}

function Resolve-CanonicalPath {
    param([Parameter(Mandatory)][string] $Path)

    $canonical = & node -e "const fs=require('node:fs'); process.stdout.write(fs.realpathSync(process.argv[1]));" -- $Path
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($canonical -join ''))) {
        return ($canonical -join '').Trim()
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Invoke-Npm {
    param([Parameter(Mandatory)][string[]] $NpmArgs)

    Write-Host ("> npm " + ($NpmArgs -join ' '))
    & npm.cmd @NpmArgs
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($NpmArgs -join ' ') failed with exit code $LASTEXITCODE."
    }
}

$root = Resolve-CanonicalPath (Join-Path $PSScriptRoot '..')
$extensionRoot = Join-Path $root 'extension'
$artifactRoot = Join-Path $root 'artifacts\extension'
$debugRoot = Join-Path $root 'dist'

try {
    Push-Location $extensionRoot
    try {
        if (-not (Test-Path -LiteralPath 'node_modules')) {
            Invoke-Npm @('ci')
        }

        if (-not $SkipQuality) {
            Invoke-Npm @('run', 'compile')
            Invoke-Npm @('run', 'lint')
            Invoke-Npm @('test')
        }

        if (-not $FirefoxOnly) {
            Invoke-Npm @('run', 'zip')
        }
        if (-not $ChromeOnly) {
            Invoke-Npm @('run', 'zip:firefox')
        }
    } finally {
        Pop-Location
    }

    $expectedDirectories = @()
    $expectedArchives = @()
    if (-not $FirefoxOnly) {
        $expectedDirectories += (Join-Path $artifactRoot 'chrome-mv3')
        $expectedArchives += (Get-ChildItem -LiteralPath $artifactRoot -Filter '*-chrome.zip' -File | Select-Object -Last 1)
    }
    if (-not $ChromeOnly) {
        $expectedDirectories += (Join-Path $artifactRoot 'firefox-mv3')
        $expectedArchives += (Get-ChildItem -LiteralPath $artifactRoot -Filter '*-firefox.zip' -File | Select-Object -Last 1)
    }
    foreach ($directory in $expectedDirectories) {
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            throw "Missing unpacked build: $directory"
        }
    }
    foreach ($archive in $expectedArchives) {
        if ($null -eq $archive -or $archive.Length -le 0) {
            throw "Missing or empty browser archive under $artifactRoot."
        }
    }

    if (-not $FirefoxOnly) {
        & node -e "const fs=require('node:fs'); fs.rmSync(process.argv[1], { recursive: true, force: true });" -- $debugRoot
        if ($LASTEXITCODE -ne 0) {
            throw "Could not clear Chrome debug directory: $debugRoot"
        }
        New-Item -ItemType Directory -Path $debugRoot -Force | Out-Null
        Copy-Item -Path (Join-Path $artifactRoot 'chrome-mv3\*') -Destination $debugRoot -Recurse -Force
        Write-Host "Chrome debug build: $debugRoot"
    }

    Write-Host "Build complete: $artifactRoot"
} catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

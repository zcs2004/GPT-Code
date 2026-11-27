[CmdletBinding()]
param(
  [ValidateSet("x64", "arm64")]
  [string]$Architecture = "x64",

  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dockerPlatform = if ($Architecture -eq "x64") { "amd64" } else { "arm64" }
$runFullVerification = if ($Architecture -eq "x64") { "1" } else { "0" }
$appImageExtractMode = if ($Architecture -eq "x64") { "self" } else { "unsquashfs" }

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $repositoryRoot "linux-release-$Architecture"
} elseif (-not [IO.Path]::IsPathFullyQualified($OutputDirectory)) {
  $OutputDirectory = Join-Path $repositoryRoot $OutputDirectory
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

if (Test-Path -LiteralPath $OutputDirectory) {
  throw "Refusing to replace an existing Docker release directory: $OutputDirectory"
}

$docker = Get-Command docker.exe -ErrorAction SilentlyContinue
if (-not $docker) {
  $bundledDocker = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
  if (-not (Test-Path -LiteralPath $bundledDocker)) {
    throw "Docker CLI was not found. Install and start Docker Desktop first."
  }
  $dockerExecutable = $bundledDocker
} else {
  $dockerExecutable = $docker.Source
}
$dockerBin = Split-Path -Parent $dockerExecutable
$originalPath = $env:Path
if (-not (($env:Path -split ";") | Where-Object { $_.TrimEnd("\") -ieq $dockerBin.TrimEnd("\") })) {
  $env:Path = "$dockerBin;$env:Path"
}

Push-Location $repositoryRoot
try {
  & $dockerExecutable buildx build `
    --platform "linux/$dockerPlatform" `
    --build-arg "RUN_FULL_VERIFY=$runFullVerification" `
    --build-arg "APPIMAGE_EXTRACT_MODE=$appImageExtractMode" `
    --file Dockerfile.linux-release `
    --target export `
    --output "type=local,dest=$OutputDirectory" `
    --progress plain `
    .
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Linux $Architecture packaging failed with exit code $LASTEXITCODE"
  }
} catch {
  if (Test-Path -LiteralPath $OutputDirectory) {
    Write-Warning "The incomplete output directory remains for inspection: $OutputDirectory"
  }
  throw
} finally {
  Pop-Location
  $env:Path = $originalPath
}

$appImages = @(Get-ChildItem -LiteralPath $OutputDirectory -Filter "*.AppImage" -File)
if ($appImages.Count -ne 1) {
  throw "Expected exactly one Linux $Architecture AppImage in $OutputDirectory; found $($appImages.Count)"
}
$checksumPath = Join-Path $OutputDirectory "SHA256SUMS"
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
  throw "Docker package output is missing SHA256SUMS: $OutputDirectory"
}

$checksumLine = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
if ($checksumLine -notmatch '^([0-9a-fA-F]{64})\s+') {
  throw "Docker package output contains an invalid SHA256SUMS entry: $checksumPath"
}
$expectedHash = $Matches[1].ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $appImages[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
  throw "Docker package SHA256 mismatch for $($appImages[0].FullName)"
}

[pscustomobject]@{
  FullName = $appImages[0].FullName
  Length = $appImages[0].Length
  LastWriteTime = $appImages[0].LastWriteTime
  SHA256 = $actualHash
  Verification = if ($Architecture -eq "x64") { "full package smoke" } else { "AArch64 structure and dynamic dependencies" }
}

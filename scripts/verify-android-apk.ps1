param(
    [Parameter(Mandatory = $true)]
    [string]$ApkPath
)

$ErrorActionPreference = "Stop"

$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedApk)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName })
}
finally {
    $archive.Dispose()
}

$requiredEntries = @(
    "AndroidManifest.xml",
    "resources.arsc",
    "assets/www/index.html"
)
$missingEntries = @($requiredEntries | Where-Object { $_ -notin $entries })
$hasDex = @($entries | Where-Object { $_ -match '^classes(?:\d+)?\.dex$' }).Count -gt 0

if ($missingEntries.Count -gt 0 -or -not $hasDex) {
    $missing = @($missingEntries)
    if (-not $hasDex) { $missing += "classes.dex" }
    throw "Invalid APK. Missing required entries: $($missing -join ', ')"
}

$sdkCandidates = @(@(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

if ($sdkCandidates.Count -eq 0) {
    throw "Android SDK not found; cannot verify the APK signature."
}

$buildToolsRoot = Join-Path $sdkCandidates[0] "build-tools"
$buildTools = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat") } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1

if (-not $buildTools) {
    throw "Android SDK Build Tools with apksigner were not found."
}

$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
& $apksigner verify --verbose $resolvedApk
if ($LASTEXITCODE -ne 0) {
    throw "APK signature verification failed."
}

$apkSize = (Get-Item -LiteralPath $resolvedApk).Length
Write-Host "[OK] APK structure contains manifest, resources, DEX, and web assets."
Write-Host "[OK] APK signature verified."
Write-Host "[OK] APK size: $apkSize bytes"

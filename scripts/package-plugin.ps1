param(
    [Parameter(Mandatory = $true)][string]$PluginDirectory,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$root = (Resolve-Path -LiteralPath $PluginDirectory).Path
$manifestPath = Join-Path $root 'manifest.json'
$manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
if ($null -eq $manifest.fileHashes) { throw 'The manifest must declare fileHashes.' }
$files = @('manifest.json')
foreach ($property in $manifest.fileHashes.PSObject.Properties) {
    $name = $property.Name
    if ($name -eq 'manifest.json' -or $name.Contains('\') -or $name.StartsWith('/') -or $name.Contains(':') -or ($name.Split('/') -contains '..')) {
        throw "Invalid package path: $name"
    }
    $path = [IO.Path]::GetFullPath((Join-Path $root $name))
    if (-not $path.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Package path leaves its directory: $name" }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $property.Value) { throw "Source hash does not match manifest: $name" }
    $files += $name
}
$destination = [IO.Path]::GetFullPath($OutputPath)
$temporary = Join-Path ([IO.Path]::GetDirectoryName($destination)) ([IO.Path]::GetFileName($destination) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
try {
    $zip = [IO.Compression.ZipFile]::Open($temporary, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $files) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $name), $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zip.Dispose() }
    # Validate the bytes actually written before replacing the distribution ZIP.
    $zip = [IO.Compression.ZipFile]::OpenRead($temporary)
    try {
        if ($zip.Entries.Count -ne $files.Count) { throw 'Unexpected ZIP entry count.' }
        foreach ($property in $manifest.fileHashes.PSObject.Properties) {
            $entry = $zip.GetEntry($property.Name)
            if ($null -eq $entry) { throw "Missing ZIP entry: $($property.Name)" }
            $stream = $entry.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $actual = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
            finally { $stream.Dispose(); $sha.Dispose() }
            if ($actual -ne $property.Value) { throw "ZIP hash does not match manifest: $($property.Name)" }
        }
    } finally { $zip.Dispose() }
    Move-Item -LiteralPath $temporary -Destination $destination -Force
    Write-Output "Packaged and verified: $destination"
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}

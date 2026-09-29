param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\secret\office-clipboard-capture')
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ClipboardCapture {
    [DllImport("user32.dll", SetLastError = true)] public static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseClipboard();
    [DllImport("user32.dll", SetLastError = true)] public static extern uint EnumClipboardFormats(uint format);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int GetClipboardFormatName(uint format, System.Text.StringBuilder name, int length);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr GetClipboardData(uint format);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern UIntPtr GlobalSize(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GlobalUnlock(IntPtr handle);
}
'@

$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$formats = [Collections.Generic.List[object]]::new()
$gvml = $null
$opened = $false
for ($attempt = 0; $attempt -lt 10 -and -not $opened; $attempt++) {
    $opened = [ClipboardCapture]::OpenClipboard([IntPtr]::Zero)
    if (-not $opened) { Start-Sleep -Milliseconds 100 }
}
if (-not $opened) { throw 'Could not open the clipboard. Copy the shape and retry.' }
try {
    $format = [uint32]0
    while (($format = [ClipboardCapture]::EnumClipboardFormats($format)) -ne 0) {
        $nameBuilder = [Text.StringBuilder]::new(256)
        $nameLength = [ClipboardCapture]::GetClipboardFormatName($format, $nameBuilder, $nameBuilder.Capacity)
        $name = if ($nameLength -gt 0) { $nameBuilder.ToString() } else { "standard:$format" }
        $formats.Add([pscustomobject]@{ id = $format; name = $name })
        if ($name -ieq 'Art::GVML ClipFormat') {
            $handle = [ClipboardCapture]::GetClipboardData($format)
            if ($handle -eq [IntPtr]::Zero) { throw 'Could not get GVML clipboard data.' }
            $length = [ClipboardCapture]::GlobalSize($handle).ToUInt64()
            if ($length -eq 0 -or $length -gt 33554432) { throw "Invalid GVML size: $length" }
            $pointer = [ClipboardCapture]::GlobalLock($handle)
            if ($pointer -eq [IntPtr]::Zero) { throw 'Could not read GVML clipboard data.' }
            try {
                $gvml = [byte[]]::new([int]$length)
                [Runtime.InteropServices.Marshal]::Copy($pointer, $gvml, 0, [int]$length)
            } finally {
                [ClipboardCapture]::GlobalUnlock($handle) | Out-Null
            }
        }
    }
} finally {
    [ClipboardCapture]::CloseClipboard() | Out-Null
}

$formats | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $outputPath 'formats.json') -Encoding UTF8
if ($null -ne $gvml) {
    [IO.File]::WriteAllBytes((Join-Path $outputPath 'gvml.zip'), $gvml)
    Write-Output "Saved GVML data and format list: $outputPath"
} else {
    Write-Output "Saved format list. No GVML data was available: $outputPath"
}

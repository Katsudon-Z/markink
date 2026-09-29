$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false), $false)
$payload = $reader.ReadToEnd() | ConvertFrom-Json

if ($payload.format -eq 'text') {
    [System.Windows.Forms.Clipboard]::SetText([string]$payload.value)
} elseif ($payload.format -eq 'png') {
    $bytes = [Convert]::FromBase64String([string]$payload.value)
    if ($bytes.Length -lt 8 -or
        $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or
        $bytes[2] -ne 78 -or $bytes[3] -ne 71) {
        throw 'PNG data is invalid.'
    }
    $stream = [System.IO.MemoryStream]::new($bytes)
    try {
        $image = [System.Drawing.Image]::FromStream($stream)
        try {
            $bitmap = New-Object System.Drawing.Bitmap($image)
            [System.Windows.Forms.Clipboard]::SetImage($bitmap)
        } finally {
            $image.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
} else {
    throw 'Unsupported clipboard format.'
}

Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class ClipboardFlush {
    [DllImport("ole32.dll")]
    public static extern int OleFlushClipboard();
}
'@
$result = [ClipboardFlush]::OleFlushClipboard()
if ($result -ne 0) { throw "Could not preserve the clipboard contents: $result" }

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

$reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false), $false)
$drawing = $reader.ReadToEnd() | ConvertFrom-Json
$culture = [Globalization.CultureInfo]::InvariantCulture
function E($value) { return [Security.SecurityElement]::Escape([string]$value) }
function U($value) { return ([long][Math]::Round(([double]$value) * 9525)).ToString($culture) }
function Box($x, $y, $w, $h) {
    $left = U ([double]$x - [double]$drawing.minX)
    $top = U ([double]$y - [double]$drawing.minY)
    $width = U $w
    $height = U $h
    return '<a:xfrm><a:off x="' + $left + '" y="' + $top + '"/><a:ext cx="' + $width + '" cy="' + $height + '"/></a:xfrm>'
}
function TextBody($value) {
    return '<a:txSp><a:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ja-JP" sz="1100"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill></a:rPr><a:t>' + (E $value) + '</a:t></a:r><a:endParaRPr lang="ja-JP"/></a:p></a:txBody><a:useSpRect/></a:txSp>'
}
function ShapeStyle {
    return '<a:style><a:lnRef idx="1"><a:schemeClr val="dk1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="lt1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="dk1"/></a:fontRef></a:style>'
}
$xml = [Text.StringBuilder]::new()
[void]$xml.Append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas">')
[void]$xml.Append('<a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + (U $drawing.width) + '" cy="' + (U $drawing.height) + '"/><a:chOff x="0" y="0"/><a:chExt cx="' + (U $drawing.width) + '" cy="' + (U $drawing.height) + '"/></a:xfrm></a:grpSpPr>')
$id = 2
foreach ($line in $drawing.lines) {
    $start = $line.points[0]
    $end = $line.points[$line.points.Count - 1]
    $dx = [double]$end[0] - [double]$start[0]
    $dy = [double]$end[1] - [double]$start[1]
    $distance = [Math]::Sqrt($dx * $dx + $dy * $dy)
    $straight = $distance -gt 0.01
    if ($straight) {
        foreach ($point in $line.points) {
            $offsetX = [double]$point[0] - [double]$start[0]
            $offsetY = [double]$point[1] - [double]$start[1]
            if ([Math]::Abs($offsetX * $dy - $offsetY * $dx) / $distance -gt 0.75) {
                $straight = $false
                break
            }
        }
    }
    $arrow = if ($line.arrow) { '<a:tailEnd type="triangle"/>' } else { '' }
    $x = [Math]::Min([double]$start[0], [double]$end[0])
    $y = [Math]::Min([double]$start[1], [double]$end[1])
    $w = [Math]::Max(0.01, [Math]::Abs($dx))
    $h = [Math]::Max(0.01, [Math]::Abs($dy))
    $flipH = if ($dx -lt 0) { ' flipH="1"' } else { '' }
    $flipV = if ($dy -lt 0) { ' flipV="1"' } else { '' }
    $box = (Box $x $y $w $h).Replace('<a:xfrm>', '<a:xfrm' + $flipH + $flipV + '>')
    $preset = if ($straight) { 'line' } else { 'curvedConnector3' }
    if (-not $straight -and [Math]::Abs($dy) -gt [Math]::Abs($dx)) {
        $rotatedWidth = [Math]::Max(0.01, [Math]::Abs($dy))
        $rotatedHeight = [Math]::Max(0.01, [Math]::Abs($dx))
        $centerX = ([double]$start[0] + [double]$end[0]) / 2.0
        $centerY = ([double]$start[1] + [double]$end[1]) / 2.0
        $rotatedX = $centerX - $rotatedWidth / 2.0
        $rotatedY = $centerY - $rotatedHeight / 2.0
        $flipH = if ($dy -lt 0) { ' flipH="1"' } else { '' }
        $flipV = if ($dx -gt 0) { ' flipV="1"' } else { '' }
        $box = (Box $rotatedX $rotatedY $rotatedWidth $rotatedHeight).Replace('<a:xfrm>', '<a:xfrm rot="5400000"' + $flipH + $flipV + '>')
    }
    [void]$xml.Append('<a:cxnSp><a:nvCxnSpPr><a:cNvPr id="' + $id + '" name="Connector ' + $id + '"/><a:cNvCxnSpPr/></a:nvCxnSpPr><a:spPr>' + $box + '<a:prstGeom prst="' + $preset + '"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="334155"/></a:solidFill>' + $arrow + '</a:ln></a:spPr></a:cxnSp>')
    $id++
}
foreach ($shape in $drawing.shapes) {
    $kind = switch ($shape.kind) { 'ellipse' { 'ellipse' } 'diamond' { 'diamond' } default { 'rect' } }
    [void]$xml.Append('<a:sp><a:nvSpPr><a:cNvPr id="' + $id + '" name="Shape ' + $id + '"/><a:cNvSpPr/></a:nvSpPr><a:spPr>' + (Box $shape.x $shape.y $shape.w $shape.h) + '<a:prstGeom prst="' + $kind + '"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="334155"/></a:solidFill></a:ln></a:spPr>' + (TextBody $shape.label) + (ShapeStyle) + '</a:sp>')
    $id++
}
foreach ($label in $drawing.texts) {
    [void]$xml.Append('<a:sp><a:nvSpPr><a:cNvPr id="' + $id + '" name="Text ' + $id + '"/><a:cNvSpPr txBox="1"/></a:nvSpPr><a:spPr>' + (Box $label.x $label.y $label.w $label.h) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></a:spPr>' + (TextBody $label.label) + (ShapeStyle) + '</a:sp>')
    $id++
}
[void]$xml.Append('</lc:lockedCanvas></a:graphicData></a:graphic>')

$themeXml = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="markink">
<a:themeElements>
<a:clrScheme name="markink"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="334155"/></a:dk2><a:lt2><a:srgbClr val="F1F5F9"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="EF4444"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="06B6D4"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>
<a:fontScheme name="markink"><a:majorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="markink">
<a:fillStyleLst><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:solidFill><a:schemeClr val="lt2"/></a:solidFill><a:solidFill><a:schemeClr val="dk2"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>
'@

$stream = [IO.MemoryStream]::new()
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
function AddEntry($name, $content) {
    $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write($content) } finally { $writer.Dispose() }
}
try {
    AddEntry '[Content_Types].xml' '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/clipboard/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/clipboard/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>'
    AddEntry '_rels/.rels' '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="clipboard/drawings/drawing1.xml"/></Relationships>'
    AddEntry 'clipboard/drawings/drawing1.xml' $xml.ToString()
    AddEntry 'clipboard/drawings/_rels/drawing1.xml.rels' '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>'
    AddEntry 'clipboard/theme/theme1.xml' $themeXml
} finally { $zip.Dispose() }

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
public static class OfficeClipboard {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool EmptyClipboard();
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetClipboardData(uint format, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool CloseClipboard();
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName,
        uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu,
        IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool DestroyWindow(IntPtr window);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GlobalFree(IntPtr handle);

    public static void Write(byte[] bytes) {
        uint format = RegisterClipboardFormat("Art::GVML ClipFormat");
        if (format == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr handle = GlobalAlloc(0x42, new UIntPtr((uint)bytes.Length));
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            IntPtr pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try { Marshal.Copy(bytes, 0, pointer, bytes.Length); }
            finally { GlobalUnlock(handle); }
            IntPtr owner = CreateWindowEx(0, "STATIC", "markink clipboard", 0,
                0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (owner == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                bool opened = false;
                for (int attempt = 0; attempt < 5 && !opened; attempt++) {
                    opened = OpenClipboard(owner);
                    if (!opened) Thread.Sleep(50);
                }
                if (!opened) throw new Win32Exception(Marshal.GetLastWin32Error());
                try {
                    if (!EmptyClipboard()) throw new Win32Exception(Marshal.GetLastWin32Error());
                    if (SetClipboardData(format, handle) == IntPtr.Zero)
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    handle = IntPtr.Zero;
                } finally { CloseClipboard(); }
            } finally { DestroyWindow(owner); }
        } finally {
            if (handle != IntPtr.Zero) GlobalFree(handle);
        }
    }
}
'@
[OfficeClipboard]::Write($stream.ToArray())

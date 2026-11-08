param(
    [string]$InputPath = (Join-Path $PSScriptRoot '..\secret\office-clipboard-capture\gvml.zip')
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
public static class GvmlReplay {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll", SetLastError = true)] static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll", SetLastError = true)] static extern bool EmptyClipboard();
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetClipboardData(uint format, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseClipboard();
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName,
        uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu,
        IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll", SetLastError = true)] static extern bool DestroyWindow(IntPtr window);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalFree(IntPtr handle);

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
            IntPtr owner = CreateWindowEx(0, "STATIC", "GVML replay", 0,
                0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (owner == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                bool opened = false;
                for (int attempt = 0; attempt < 10 && !opened; attempt++) {
                    opened = OpenClipboard(owner);
                    if (!opened) Thread.Sleep(100);
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

$bytes = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($InputPath))
if ($bytes.Length -eq 0 -or $bytes.Length -gt 33554432) { throw 'Invalid GVML file size.' }
[GvmlReplay]::Write($bytes)
Write-Output 'Copied the captured GVML data to the clipboard. Paste into PowerPoint now.'

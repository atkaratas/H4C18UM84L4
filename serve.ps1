# TTI Cable & Infrastructure Benchmark — Local-only PowerShell server.
# No installation needed. Built on .NET HttpListener (loopback only).
# Usage: Right-click → "Run with PowerShell"  OR  in PS:  .\serve.ps1

$ErrorActionPreference = "Stop"
$Port = 8000
$Root = $PSScriptRoot

if (-not $Root) { $Root = (Get-Location).Path }
Set-Location $Root

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".htm"  = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".mjs"  = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".woff" = "font/woff"
  ".woff2"= "font/woff2"
  ".txt"  = "text/plain; charset=utf-8"
}

# Find a free port if 8000 is taken
while ($true) {
  try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    $listener.Start()
    break
  } catch {
    $Port++
    if ($Port -gt 8100) { throw "No free port in 8000-8100" }
  }
}

$url = "http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "  TTI Benchmark serving at $url" -ForegroundColor Cyan
Write-Host "  Root: $Root" -ForegroundColor DarkGray
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

# Open default browser
Start-Process $url | Out-Null

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = [Uri]::UnescapeDataString($req.Url.LocalPath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($rel)) { $rel = "index.html" }
    $full = Join-Path $Root $rel

    if ((Test-Path -LiteralPath $full -PathType Leaf) -and ($full.StartsWith($Root))) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "  200  $rel" -ForegroundColor DarkGreen
    } else {
      $res.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
      $res.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "  404  $rel" -ForegroundColor DarkYellow
    }
    $res.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
  Write-Host "`nServer stopped." -ForegroundColor Cyan
}

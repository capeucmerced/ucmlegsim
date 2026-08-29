# Mirror the live ucmlegsim.com site into the repo's archive/2025/ folder.
# Same-host crawl: follows href/src in HTML and url() in CSS; externals are listed, not fetched.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root    = "https://ucmlegsim.com/"
$outDir  = "C:\Users\Nickb\Box\ucmlegsim\archive\2025"
$rootUri = [Uri]$root

$queue    = New-Object System.Collections.Queue
$visited  = @{}
$failed   = @()
$external = @{}

# Seeds: homepage plus runtime-fetched assets no tag points at
$queue.Enqueue([Uri]$root)
$queue.Enqueue([Uri]($root + "search.json"))

$wc = New-Object System.Net.WebClient
$wc.Headers.Add("User-Agent", "ucmlegsim-archiver/1.0")

function Get-SavePath([Uri]$u) {
    $p = [Uri]::UnescapeDataString($u.AbsolutePath)
    if ($p.EndsWith("/")) { $p = $p + "index.html" }
    return (Join-Path $outDir ($p -replace "/", "\").TrimStart("\"))
}

function Resolve-Link([Uri]$base, [string]$raw) {
    $r = $raw.Trim()
    if ($r -eq "" -or $r.StartsWith("#") -or $r -match "^(mailto:|javascript:|data:|tel:)") { return $null }
    try { $abs = New-Object System.Uri($base, $r) } catch { return $null }
    if ($abs.Scheme -notin @("http","https")) { return $null }
    return $abs
}

$count = 0
while ($queue.Count -gt 0) {
    $uri = $queue.Dequeue()
    $key = $uri.GetLeftPart([UriPartial]::Path)
    if ($visited.ContainsKey($key)) { continue }
    $visited[$key] = $true

    if ($uri.Host -ne $rootUri.Host) { $external[$uri.Host] = $true; continue }

    $save = Get-SavePath $uri
    $dir  = Split-Path $save -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    $ok = $false
    foreach ($attempt in 1..3) {
        try { $wc.DownloadFile($key, $save); $ok = $true; break }
        catch { Start-Sleep -Milliseconds (300 * $attempt) }
    }
    if (-not $ok) { $failed += $key; continue }
    $count++

    $ext = [IO.Path]::GetExtension($save).ToLower()
    if ($ext -in @(".html", ".htm")) {
        $text = [IO.File]::ReadAllText($save)
        $links = [regex]::Matches($text, '(?:href|src)\s*=\s*"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
        # Links buried in embedded widget/table JSON (reactable cells, iframes-in-JSON, escaped hrefs):
        # match any relative-looking site path with a file extension, wherever it appears in the text.
        $links += [regex]::Matches($text, '((?:\.\./)*/?(?:bills-pages|senator-pages|lobby-pages|files|site_libs)/[A-Za-z0-9_\-./%]+\.[A-Za-z0-9]{2,7})') | ForEach-Object { $_.Groups[1].Value }
        foreach ($l in $links) {
            $abs = Resolve-Link $uri $l
            if ($null -ne $abs) {
                if ($abs.Host -eq $rootUri.Host) {
                    $k2 = $abs.GetLeftPart([UriPartial]::Path)
                    if (-not $visited.ContainsKey($k2)) { $queue.Enqueue($abs) }
                } else { $external[$abs.Host] = $true }
            }
        }
    }
    elseif ($ext -eq ".css") {
        $text = [IO.File]::ReadAllText($save)
        $links = [regex]::Matches($text, 'url\(\s*[''"]?([^''")\s]+)[''"]?\s*\)') | ForEach-Object { $_.Groups[1].Value }
        foreach ($l in $links) {
            $abs = Resolve-Link $uri $l
            if ($null -ne $abs -and $abs.Host -eq $rootUri.Host) {
                $k2 = $abs.GetLeftPart([UriPartial]::Path)
                if (-not $visited.ContainsKey($k2)) { $queue.Enqueue($abs) }
            }
        }
    }

    if ($count % 100 -eq 0) { Write-Output ("fetched {0} files, queue {1}" -f $count, $queue.Count) }
}

Write-Output ("DONE: {0} files saved to {1}" -f $count, $outDir)
Write-Output ("External hosts referenced (left external): " + (($external.Keys | Sort-Object) -join ", "))
if ($failed.Count -gt 0) {
    Write-Output ("FAILED ({0}):" -f $failed.Count)
    $failed | ForEach-Object { Write-Output ("  " + $_) }
} else {
    Write-Output "No failures."
}

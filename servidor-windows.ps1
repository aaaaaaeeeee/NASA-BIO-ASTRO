# ============================================================================
# BIO-ASTRO OS - servidor local para Windows (sin instalar nada)
# Usa solo PowerShell, que ya viene con Windows 10/11.
#   - Sirve la consola en http://localhost:8765/max30102.html
#   - /nasa : proxy a api.nasa.gov, osdr.nasa.gov y services.swpc.noaa.gov
#   - /llm  : proxy a la API de Claude (la clave la pone el usuario en la interfaz)
# El brazalete ESP32 se conecta desde Chrome o Edge con el boton "CONECTAR ESP32 - USB" (Web Serial).
# Para cerrarlo: cierra esta ventana o pulsa Ctrl+C.
# ============================================================================
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootFull = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$port = 8765
$nasaHosts = @('api.nasa.gov', 'osdr.nasa.gov', 'services.swpc.noaa.gov')
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'; '.ino' = 'text/plain; charset=utf-8'
}

function Send-Bytes($res, [int]$code, [string]$ctype, [byte[]]$bytes) {
  $res.StatusCode = $code
  $res.ContentType = $ctype
  $res.Headers['Cache-Control'] = 'no-store'
  $res.ContentLength64 = $bytes.Length
  if ($bytes.Length -gt 0) { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
}
function Send-Json($res, [int]$code, [string]$json) { Send-Bytes $res $code 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json)) }
function Json-Error([string]$msg) { return '{"error":{"message":' + (ConvertTo-Json $msg) + '}}' }

# Ejecuta la peticion y devuelve la respuesta aunque sea un error HTTP (4xx/5xx)
function Invoke-Upstream($wr) {
  try { $up = $wr.GetResponse() }
  catch {
    $e = $_.Exception
    while ($e -and -not ($e -is [Net.WebException])) { $e = $e.InnerException }
    if ($e -and $e.Response) { $up = $e.Response } else { throw }
  }
  $ms = New-Object IO.MemoryStream
  $up.GetResponseStream().CopyTo($ms)
  $out = @{ Code = [int]$up.StatusCode; Type = $up.ContentType; Body = $ms.ToArray(); Rem = $up.Headers['X-RateLimit-Remaining']; Lim = $up.Headers['X-RateLimit-Limit'] }
  $up.Close()
  return $out
}

function Handle-Nasa($req, $res) {
  $url = $req.QueryString['url']
  $u = $null
  if (-not $url -or -not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$u) -or $u.Scheme -ne 'https' -or ($nasaHosts -notcontains $u.Host)) {
    Send-Json $res 502 (Json-Error 'host no permitido'); return
  }
  $wr = [Net.HttpWebRequest]::Create($u)
  $wr.Method = 'GET'; $wr.Accept = 'application/json'; $wr.UserAgent = 'ARES-BioTwin/1.0'; $wr.Timeout = 20000
  $r = Invoke-Upstream $wr
  if ($r.Rem) { $res.Headers['X-RateLimit-Remaining'] = $r.Rem }
  if ($r.Lim) { $res.Headers['X-RateLimit-Limit'] = $r.Lim }
  $type = if ($r.Type) { $r.Type } else { 'application/json' }
  Send-Bytes $res $r.Code $type $r.Body
}

function Handle-Llm($req, $res) {
  if ($req.HttpMethod -ne 'POST') { Send-Json $res 405 (Json-Error 'usa POST'); return }
  $key = "$($req.Headers['X-Claude-Key'])".Trim()
  if (-not $key) { Send-Json $res 502 (Json-Error 'falta la clave de Claude'); return }
  $sr = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
  $body = [Text.Encoding]::UTF8.GetBytes($sr.ReadToEnd())
  $wr = [Net.HttpWebRequest]::Create('https://api.anthropic.com/v1/messages')
  $wr.Method = 'POST'; $wr.ContentType = 'application/json'; $wr.Timeout = 120000; $wr.ReadWriteTimeout = 120000
  $wr.Headers.Add('x-api-key', $key)
  $wr.Headers.Add('anthropic-version', '2026-10-21')
  $wr.Headers.Add('anthropic-beta', 'server-side-fallback-2026-07-01')
  $wr.ContentLength = $body.Length
  $s = $wr.GetRequestStream(); $s.Write($body, 0, $body.Length); $s.Close()
  $r = Invoke-Upstream $wr
  Send-Bytes $res $r.Code 'application/json; charset=utf-8' $r.Body
}

function Handle-Static($req, $res) {
  $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
  if (-not $rel) { $rel = 'max30102.html' }
  $full = [IO.Path]::GetFullPath((Join-Path $root ($rel -replace '/', '\')))
  if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
    Send-Bytes $res 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('404')); return
  }
  $ext = [IO.Path]::GetExtension($full).ToLower()
  $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
  Send-Bytes $res 200 $type ([IO.File]::ReadAllBytes($full))
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() }
catch {
  Write-Host ''
  Write-Host "No se pudo abrir el puerto $port (quizas ya hay otra ventana de BIO-ASTRO abierta)." -ForegroundColor Red
  Write-Host "Abre en Chrome o Edge: http://localhost:$port/max30102.html"
  Read-Host 'Pulsa Enter para salir'
  exit 1
}

$page = "http://localhost:$port/max30102.html"
Write-Host ''
Write-Host '  BIO-ASTRO // OS v4.5' -ForegroundColor Yellow
Write-Host "  Consola: $page" -ForegroundColor Green
Write-Host '  Usa Chrome o Edge (Web Serial para el brazalete USB).'
Write-Host '  Deja esta ventana abierta mientras usas la consola. Ctrl+C para cerrar.'
Write-Host ''
Start-Process $page

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request; $res = $ctx.Response
    try {
      switch ($req.Url.AbsolutePath) {
        '/nasa' { Handle-Nasa $req $res }
        '/llm' { Handle-Llm $req $res }
        default { Handle-Static $req $res }
      }
    } catch {
      Write-Host ("  error en " + $req.Url.AbsolutePath + ": " + $_.Exception.Message) -ForegroundColor DarkYellow
      try { Send-Json $res 502 (Json-Error $_.Exception.Message) } catch { }
    } finally {
      try { $res.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}

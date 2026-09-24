<#
  StoryMaker 本地服务。

  策划双击「启动StoryMaker.bat」时跑的就是这个脚本。它做三件事：

    1. 在 127.0.0.1 上开一个只给本机用的极小 HTTP 服务，把同目录的 index.html 发给浏览器
    2. 代理项目文件的读写：新建 / 打开 / 读回 / 写回
    3. 记住「上一次开启的项目文件路径」

  为什么必须有它：浏览器里的页面拿不到磁盘路径，也不允许按路径读写文件。
  项目内容只有一份，就在用户选定的那个 .json 里；本机不缓存任何项目数据。

  安全：只监听回环地址；页面里带着启动时随机生成的令牌，别的网页猜不到也调不动。
  服务只肯碰它自己记住的那个项目文件，不接受页面传来的任意路径。
#>

param(
  # 0 = 让系统随便挑一个空闲端口（避免和别的东西撞端口）
  [int]$Port = 0,
  # 开发用（pnpm dev 的代理会传）：只提供 /api，不负责发页面
  [switch]$ApiOnly,
  # 开发用：由调用方指定令牌，方便它和页面用同一个
  [string]$Token = '',
  # 自动化校验用：不要自动打开浏览器
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PagePath = Join-Path $Root 'index.html'
$SessionDir = Join-Path $env:LOCALAPPDATA 'StoryMaker'
$SessionFile = Join-Path $SessionDir 'session.json'
# 开发 / 自动化校验用：把会话文件指到别处，免得动到本机记住的路径
if ($env:STORYMAKER_SESSION_FILE) {
  $SessionFile = $env:STORYMAKER_SESSION_FILE
  $SessionDir = Split-Path -Parent $SessionFile
}

$script:Token = if ($Token -ne '') {
  $Token
} else {
  -join (1..32 | ForEach-Object { '{0:x}' -f (Get-Random -Minimum 0 -Maximum 16) })
}
$script:ProjectPath = $null

# ---------- 会话文件：只存"上一次开启的项目文件路径" ----------

function Read-Session {
  if (-not (Test-Path $SessionFile)) { return $null }
  try {
    $raw = Get-Content -Path $SessionFile -Raw -Encoding UTF8
    $data = ConvertFrom-Json $raw
    $path = [string]$data.projectPath
    if ($path -ne '') { return $path }
  } catch {
    # 会话文件坏了就当成没记过，不影响使用
  }
  return $null
}

function Write-Session([string]$projectPath) {
  if (-not (Test-Path $SessionDir)) { New-Item -ItemType Directory -Path $SessionDir -Force | Out-Null }
  $json = if ([string]::IsNullOrEmpty($projectPath)) {
    '{"projectPath":null}'
  } else {
    ConvertTo-Json -InputObject @{ projectPath = $projectPath } -Compress
  }
  # UTF-8 不带 BOM：路径里有中文也不能被写坏
  [IO.File]::WriteAllText($SessionFile, $json, (New-Object Text.UTF8Encoding($false)))
}

# ---------- 文件读写 ----------

function Read-FileBytes([string]$filePath) {
  try {
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { return $null }
    return [IO.File]::ReadAllBytes($filePath)
  } catch {
    return $null
  }
}

function Remove-Utf8Bom([byte[]]$bytes) {
  if ($null -eq $bytes) { return $null }
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    return $bytes[3..($bytes.Length - 1)]
  }
  return $bytes
}

# 大小写、斜杠方向都不计较地比较两个路径
function Test-SamePath([string]$left, [string]$right) {
  if ([string]::IsNullOrEmpty($right)) { return $false }
  $a = $left -replace '/', '\'
  $b = $right -replace '/', '\'
  return [string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase)
}

# ---------- 系统文件对话框 ----------

# 对话框弹出时不会自动变成"前台窗口"（前台锁），有可能躲在浏览器后面，
# 让人以为点了没反应。这里用一点点 Win32 把它显式压到最上层（不抢键盘焦点）。
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class StoryMakerWin32
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string className, string windowTitle);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter,
        int x, int y, int width, int height, uint flags);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;

    public static bool MakeTopMost(string windowTitle)
    {
        IntPtr handle = FindWindow(null, windowTitle);
        if (handle == IntPtr.Zero) return false;
        return SetWindowPos(handle, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    }
}
'@

function New-DialogOwner {
  # 文件对话框要有"父窗口"才会压在浏览器上面。
  # 这里用屏幕正中一个几乎看不见的 1px 顶层窗口当父窗口：
  # 对话框默认居中于父窗口，于是正好弹在屏幕中间，不会跑到屏幕外，也不会躲在浏览器后面。
  $owner = New-Object System.Windows.Forms.Form
  $owner.Text = 'StoryMaker'
  $owner.TopMost = $true
  $owner.ShowInTaskbar = $false
  $owner.FormBorderStyle = 'None'
  $owner.StartPosition = 'Manual'
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $owner.Location = New-Object System.Drawing.Point(
    ($area.Left + [int]($area.Width / 2)),
    ($area.Top + [int]($area.Height / 2))
  )
  $owner.Opacity = 0.01
  $owner.Show()
  return $owner
}

function Get-SafeFileName([string]$name) {
  $clean = ($name -replace '[\\/:*?"<>|]', '_').Trim()
  if ($clean -eq '') { return 'StoryMaker项目' }
  return $clean
}

# ShowDialog 会阻塞，所以借它自己的消息循环，用计时器在弹出来之后把对话框压到最上层
function Show-DialogOnTop($dialog, $owner) {
  $script:DialogTitle = $dialog.Title
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 250
  $timer.Add_Tick({
    $timer.Stop()
    try { [void][StoryMakerWin32]::MakeTopMost($script:DialogTitle) } catch { }
  })
  $timer.Start()
  try {
    return $dialog.ShowDialog($owner)
  } finally {
    $timer.Stop()
    $timer.Dispose()
  }
}

function Show-NewProjectDialog([string]$suggestedName) {
  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Title = '新建项目文件'
  $dialog.Filter = 'StoryMaker 项目 (*.json)|*.json'
  $dialog.DefaultExt = 'json'
  $dialog.AddExtension = $true
  $dialog.OverwritePrompt = $true
  $dialog.FileName = (Get-SafeFileName $suggestedName) + '.json'
  $dialog.RestoreDirectory = $true
  $owner = New-DialogOwner
  try {
    if ((Show-DialogOnTop $dialog $owner) -eq [System.Windows.Forms.DialogResult]::OK) {
      return $dialog.FileName
    }
  } finally {
    $dialog.Dispose()
    $owner.Close()
    $owner.Dispose()
  }
  return $null
}

function Show-OpenProjectDialog {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = '打开项目文件'
  $dialog.Filter = 'StoryMaker 项目 (*.json)|*.json|所有文件 (*.*)|*.*'
  $dialog.CheckFileExists = $true
  $dialog.RestoreDirectory = $true
  $owner = New-DialogOwner
  try {
    if ((Show-DialogOnTop $dialog $owner) -eq [System.Windows.Forms.DialogResult]::OK) {
      return $dialog.FileName
    }
  } finally {
    $dialog.Dispose()
    $owner.Close()
    $owner.Dispose()
  }
  return $null
}

function Show-ExportDialog([string]$suggestedName) {
  $name = Get-SafeFileName ([IO.Path]::GetFileNameWithoutExtension($suggestedName))
  $extension = [IO.Path]::GetExtension($suggestedName)
  if ($extension -eq '') { $extension = '.xlsx' }

  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Title = '导出'
  if ($extension -eq '.csv') {
    $dialog.Filter = 'CSV (*.csv)|*.csv'
  } else {
    $dialog.Filter = 'Excel 工作簿 (*.xlsx)|*.xlsx'
  }
  $dialog.DefaultExt = $extension.TrimStart('.')
  $dialog.AddExtension = $true
  $dialog.OverwritePrompt = $true
  $dialog.FileName = $name + $extension
  $dialog.RestoreDirectory = $true
  $owner = New-DialogOwner
  try {
    if ((Show-DialogOnTop $dialog $owner) -eq [System.Windows.Forms.DialogResult]::OK) {
      return $dialog.FileName
    }
  } finally {
    $dialog.Dispose()
    $owner.Close()
    $owner.Dispose()
  }
  return $null
}

# ---------- 极简 HTTP ----------

function Get-HeaderEnd([System.IO.MemoryStream]$stream, [int]$from) {
  $buffer = $stream.GetBuffer()
  $length = [int]$stream.Length
  $start = [Math]::Max(0, $from - 3)
  for ($i = $start; $i -le $length - 4; $i++) {
    if ($buffer[$i] -eq 13 -and $buffer[$i + 1] -eq 10 -and $buffer[$i + 2] -eq 13 -and $buffer[$i + 3] -eq 10) {
      return $i
    }
  }
  return -1
}

function Read-Request([System.Net.Sockets.NetworkStream]$stream) {
  $chunk = New-Object byte[] 65536
  $head = New-Object System.IO.MemoryStream
  $end = -1

  while ($end -lt 0) {
    $read = $stream.Read($chunk, 0, $chunk.Length)
    if ($read -le 0) { return $null }
    $head.Write($chunk, 0, $read)
    if ($head.Length -gt 262144) { return $null }   # 请求头不可能这么大
    $end = Get-HeaderEnd $head $end
  }

  $all = $head.ToArray()
  $lines = [Text.Encoding]::ASCII.GetString($all, 0, $end) -split "`r`n"
  $parts = $lines[0] -split ' '
  if ($parts.Count -lt 2) { return $null }

  $headers = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -eq '') { continue }
    $colon = $line.IndexOf(':')
    if ($colon -lt 1) { continue }
    $headers[$line.Substring(0, $colon).Trim().ToLowerInvariant()] = $line.Substring($colon + 1).Trim()
  }

  $length = 0
  if ($headers.ContainsKey('content-length')) {
    [void][int]::TryParse($headers['content-length'], [ref]$length)
  }
  if ($length -lt 0 -or $length -gt 268435456) { return $null }   # 上限 256MB

  $body = New-Object byte[] $length
  $have = $all.Length - ($end + 4)
  if ($have -gt $length) { $have = $length }
  if ($have -gt 0) { [Array]::Copy($all, $end + 4, $body, 0, $have) }
  while ($have -lt $length) {
    $read = $stream.Read($body, $have, $length - $have)
    if ($read -le 0) { break }
    $have += $read
  }

  $target = $parts[1]
  $path = $target
  $query = @{}
  $question = $target.IndexOf('?')
  if ($question -ge 0) {
    $path = $target.Substring(0, $question)
    foreach ($pair in $target.Substring($question + 1).Split('&')) {
      if ($pair -eq '') { continue }
      $eq = $pair.IndexOf('=')
      if ($eq -lt 0) { $query[$pair] = ''; continue }
      $key = $pair.Substring(0, $eq)
      $query[$key] = [Uri]::UnescapeDataString($pair.Substring($eq + 1).Replace('+', ' '))
    }
  }

  return [pscustomobject]@{
    Method  = $parts[0]
    Path    = $path
    Query   = $query
    Headers = $headers
    Body    = $body
  }
}

function Send-Bytes($stream, [string]$status, [string]$contentType, [byte[]]$body, $extraHeaders) {
  if ($null -eq $body) { $body = New-Object byte[] 0 }
  $head = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n"
  if ($null -ne $extraHeaders) {
    foreach ($key in $extraHeaders.Keys) { $head += "$($key): $($extraHeaders[$key])`r`n" }
  }
  $head += "`r`n"
  $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($headBytes, 0, $headBytes.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Send-Json($stream, $value, [string]$status = '200 OK', $extraHeaders = $null) {
  $json = ConvertTo-Json -InputObject $value -Compress -Depth 4
  Send-Bytes $stream $status 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json)) $extraHeaders
}

function Send-NoContent($stream) {
  Send-Bytes $stream '204 No Content' 'text/plain; charset=utf-8' (New-Object byte[] 0)
}

# ---------- 路由 ----------

function Handle-Request($stream, $request) {
  $path = $request.Path

  if ($request.Method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
    Send-Bytes $stream '200 OK' 'text/html; charset=utf-8' $script:PageBytes
    return
  }
  if (-not $path.StartsWith('/api/')) {
    Send-Bytes $stream '404 Not Found' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('没有这个地址'))
    return
  }

  # 令牌对不上：多半是别的网页在乱敲本机端口，直接拒掉
  $token = ''
  if ($request.Headers.ContainsKey('x-storymaker-token')) { $token = $request.Headers['x-storymaker-token'] }
  if ($token -ne $script:Token) {
    Send-Json $stream @{ error = '令牌不对' } '403 Forbidden'
    return
  }

  switch ($path) {
    '/api/ping' {
      Send-Json $stream @{ ok = $true; port = $script:ActualPort }
      return
    }

    '/api/last-path' {
      Send-Json $stream @{ filePath = $script:ProjectPath }
      return
    }

    '/api/remember' {
      $target = [string]$request.Query['path']
      if ($target -eq '') {
        Send-Json $stream @{ error = '缺少路径' } '400 Bad Request'
        return
      }
      $script:ProjectPath = $target
      Write-Session $target
      Send-Json $stream @{ ok = $true; filePath = $target }
      return
    }

    '/api/forget' {
      $script:ProjectPath = $null
      Write-Session ''
      Send-Json $stream @{ ok = $true; filePath = $null }
      return
    }

    '/api/pick-new' {
      $target = Show-NewProjectDialog ([string]$request.Query['suggestedName'])
      if ($null -eq $target) { Send-NoContent $stream; return }
      $script:ProjectPath = $target
      Write-Session $target
      Send-Json $stream @{ filePath = $target }
      return
    }

    '/api/pick-open' {
      $target = Show-OpenProjectDialog
      if ($null -eq $target) { Send-NoContent $stream; return }
      $bytes = Read-FileBytes $target
      if ($null -eq $bytes) {
        Send-Json $stream @{ error = '这个文件读不出来' } '404 Not Found'
        return
      }
      $script:ProjectPath = $target
      Write-Session $target
      Send-Bytes $stream '200 OK' 'application/json; charset=utf-8' (Remove-Utf8Bom $bytes) @{
        'X-StoryMaker-Path' = [Uri]::EscapeDataString($target)
      }
      return
    }

    '/api/read' {
      $target = [string]$request.Query['path']
      if (-not (Test-SamePath $target $script:ProjectPath)) {
        Send-Json $stream @{ error = '只能读当前项目文件' } '403 Forbidden'
        return
      }
      $bytes = Read-FileBytes $script:ProjectPath
      if ($null -eq $bytes) {
        Send-Json $stream @{ error = '这个文件读不出来' } '404 Not Found'
        return
      }
      Send-Bytes $stream '200 OK' 'application/json; charset=utf-8' (Remove-Utf8Bom $bytes)
      return
    }

    '/api/write' {
      $target = [string]$request.Query['path']
      if (-not (Test-SamePath $target $script:ProjectPath)) {
        Send-Json $stream @{ error = '只能写当前项目文件' } '403 Forbidden'
        return
      }
      try {
        # 浏览器发来的本来就是 UTF-8 字节，原样落盘，不做任何转码
        [IO.File]::WriteAllBytes($script:ProjectPath, $request.Body)
      } catch {
        Send-Json $stream @{ error = "写不进去：$($_.Exception.Message)" } '500 Internal Server Error'
        return
      }
      Send-Json $stream @{ ok = $true; bytes = $request.Body.Length }
      return
    }

    '/api/export' {
      $text = [Text.Encoding]::ASCII.GetString($request.Body)
      try {
        $bytes = [Convert]::FromBase64String($text)
      } catch {
        Send-Json $stream @{ error = '导出内容读不出来' } '400 Bad Request'
        return
      }
      $target = Show-ExportDialog ([string]$request.Query['suggestedName'])
      if ($null -eq $target) { Send-NoContent $stream; return }
      try {
        [IO.File]::WriteAllBytes($target, $bytes)
      } catch {
        Send-Json $stream @{ error = "写不进去：$($_.Exception.Message)" } '500 Internal Server Error'
        return
      }
      Send-Json $stream @{ filePath = $target }
      return
    }

    '/api/reveal' {
      $target = [string]$request.Query['path']
      if ($target -ne '') {
        try { Start-Process explorer.exe -ArgumentList ('/select,"' + $target + '"') } catch { }
      }
      Send-Json $stream @{ ok = $true }
      return
    }

    default {
      Send-Bytes $stream '404 Not Found' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('没有这个接口'))
    }
  }
}

# ---------- 起服务 ----------

if ($ApiOnly) {
  # 开发模式：页面由 vite dev server 发，这里只管 /api
  $script:PageBytes = New-Object byte[] 0
} else {
  if (-not (Test-Path $PagePath)) {
    Write-Host ''
    Write-Host "  找不到 index.html：$PagePath" -ForegroundColor Red
    Write-Host '  请把「启动StoryMaker.bat」「storymaker-server.ps1」「index.html」放在同一个文件夹里。'
    Write-Host ''
    exit 1
  }

  # 页面里注入令牌：这样浏览器不需要把令牌写在地址栏里
  $page = [IO.File]::ReadAllText($PagePath, [Text.Encoding]::UTF8)
  $injected = '<script>window.__STORYMAKER_SERVER__={"token":"' + $script:Token + '"};</script></head>'
  $script:PageBytes = [Text.Encoding]::UTF8.GetBytes($page.Replace('</head>', $injected))
}

try {
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
  $listener.Start()
} catch {
  Write-Host ''
  Write-Host "  本地服务起不来：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host ''
  exit 1
}

$script:ActualPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$url = "http://127.0.0.1:$($script:ActualPort)/"
$script:ProjectPath = Read-Session

Write-Output "STORYMAKER_URL=$url"
Write-Host ''
if ($ApiOnly) {
  Write-Host '  StoryMaker 本地服务已启动（开发模式：只提供 /api）' -ForegroundColor Green
  Write-Host "  接口地址：$url"
} else {
  Write-Host '  StoryMaker 已启动' -ForegroundColor Green
  Write-Host "  页面地址：$url"
}
if ($null -ne $script:ProjectPath) {
  Write-Host "  上次的项目：$($script:ProjectPath)"
} else {
  Write-Host '  上次的项目：（还没有，在页面里新建或打开一个 .json 就行）'
}
Write-Host ''
Write-Host '  项目内容直接存在那个 .json 文件里，本机不留副本。'
if (-not $ApiOnly) {
  Write-Host '  这个黑窗口不要关；关掉它服务就停了（浏览器窗口可以随便关）。'
}
Write-Host ''

if (-not $NoBrowser) { Start-Process $url }

while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $request = Read-Request $client.GetStream()
    if ($null -ne $request) { Handle-Request $client.GetStream() $request }
  } catch {
    # 浏览器中途断开、请求不完整等等：无视，继续等下一条
  } finally {
    if ($null -ne $client) { try { $client.Close() } catch { } }
  }
}

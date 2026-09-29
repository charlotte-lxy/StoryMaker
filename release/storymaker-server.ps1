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
  [switch]$NoBrowser,
  # 自动化校验用：跳过更新检查（免得校验脚本去连 GitHub）
  [switch]$NoUpdate
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
# 更新检查取到的远端版本号，供启动信息显示
$script:RemoteVersion = $null

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

# 这个服务允许碰的范围（只有下面三条，别的路径一律拒绝——这是本服务的安全边界，
# 不要为了让某个功能方便就放宽）：
#   1. 当前项目文件本身
#   2. <项目>.sync                  协作元数据，记"上次同步到哪一版"
#   3. <项目>.backup-<时间戳>.json   首次对账时被舍弃的那一份另存的备份
function Test-AllowedPath([string]$target) {
  if ([string]::IsNullOrEmpty($target)) { return $false }
  if (Test-SamePath $target $script:ProjectPath) { return $true }
  if ([string]::IsNullOrEmpty($script:ProjectPath)) { return $false }

  if (Test-SamePath $target ($script:ProjectPath + '.sync')) { return $true }

  $normalized = $target -replace '/', '\'
  $prefix = ($script:ProjectPath + '.backup-') -replace '/', '\'
  if ($normalized.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and
      $normalized.EndsWith('.json', [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  return $false
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
      if (-not (Test-AllowedPath $target)) {
        Send-Json $stream @{ error = '只能读当前项目文件（以及它旁边的协作元数据）' } '403 Forbidden'
        return
      }
      $bytes = Read-FileBytes $target
      if ($null -eq $bytes) {
        Send-Json $stream @{ error = '这个文件读不出来' } '404 Not Found'
        return
      }
      Send-Bytes $stream '200 OK' 'application/json; charset=utf-8' (Remove-Utf8Bom $bytes)
      return
    }

    '/api/write' {
      $target = [string]$request.Query['path']
      if (-not (Test-AllowedPath $target)) {
        Send-Json $stream @{ error = '只能写当前项目文件（以及它旁边的协作元数据）' } '403 Forbidden'
        return
      }
      try {
        # 浏览器发来的本来就是 UTF-8 字节，原样落盘，不做任何转码
        [IO.File]::WriteAllBytes($target, $request.Body)
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

# ---------- 检查更新 ----------
#
# 策划双击启动时顺手看一眼 release/ 有没有新版：拉远端的 version.json（由
# tools/make-launcher.mts 生成的文件清单），比对本地三个文件的 SHA-256，只下载真的变了的。
#
# 这一步只许成功不许失败：连不上、超时、清单坏了、下载的字节和清单对不上，一律当作
# "没有更新"直接放行——绝不能因为查更新害得策划打不开工具。

$script:UpdateBase = 'https://raw.githubusercontent.com/charlotte-lxy/StoryMaker/main/release'
if ($env:STORYMAKER_UPDATE_BASE) { $script:UpdateBase = $env:STORYMAKER_UPDATE_BASE }

function Get-FileSha256([string]$filePath) {
  try {
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
  } catch {
    return $null
  }
}

function Enable-ModernTls {
  # Windows PowerShell 5.1 默认还停在 TLS 1.0，不补这一下连不上 GitHub
  try {
    $current = [Net.ServicePointManager]::SecurityProtocol
    [Net.ServicePointManager]::SecurityProtocol = $current -bor [Net.SecurityProtocolType]::Tls12
  } catch { }
}

function Get-RemoteText([string]$url, [int]$timeoutMs) {
  try {
    $request = [Net.HttpWebRequest]::Create($url)
    $request.Method = 'GET'
    $request.Timeout = $timeoutMs
    $request.ReadWriteTimeout = $timeoutMs
    $request.UserAgent = 'StoryMaker'
    $response = $request.GetResponse()
    try {
      $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
      try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally {
      $response.Close()
    }
  } catch {
    return $null
  }
}

function Save-RemoteFile([string]$url, [string]$targetPath, [int]$timeoutMs) {
  try {
    $request = [Net.HttpWebRequest]::Create($url)
    $request.Method = 'GET'
    $request.Timeout = $timeoutMs
    $request.ReadWriteTimeout = $timeoutMs
    $request.UserAgent = 'StoryMaker'
    $response = $request.GetResponse()
    try {
      $source = $response.GetResponseStream()
      $dest = [IO.File]::Create($targetPath)
      try { $source.CopyTo($dest) } finally { $dest.Dispose() }
      return $true
    } finally {
      $response.Close()
    }
  } catch {
    return $false
  }
}

# 清单里的版本号。读不出来或者格式不认识就当成 0.0.0——老清单压根没有版本号，
# 当作"很旧"正合适，该更新还是会更新。
function Get-ManifestVersion($manifest) {
  if ($null -eq $manifest) { return [version]'0.0.0' }
  try {
    $rawVersion = [string]$manifest.version
    if ([string]::IsNullOrWhiteSpace($rawVersion)) { return [version]'0.0.0' }
    return [version]$rawVersion
  } catch {
    return [version]'0.0.0'
  }
}

function Get-LocalManifestVersion {
  try {
    $path = Join-Path $Root 'version.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return [version]'0.0.0' }
    # 这文件是 UTF-8 无 BOM 的，得显式按 UTF-8 读，否则里面的中文文件名会变乱码
    $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    return Get-ManifestVersion (ConvertFrom-Json $text)
  } catch {
    return [version]'0.0.0'
  }
}

# 返回 $true 表示连服务端脚本都换了，要重新启动才生效
function Invoke-UpdateCheck {
  Enable-ModernTls

  # 版本号先摆出来：连不上更新源也得让人看见本机现在是什么版本
  $localVersion = Get-LocalManifestVersion
  $script:LocalVersion = $localVersion

  $raw = Get-RemoteText "$($script:UpdateBase)/version.json" 4000
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Host "  本机版本 $localVersion；这次没连上更新源，跳过更新检查。" -ForegroundColor DarkGray
    return $false
  }

  $remote = $null
  try { $remote = ConvertFrom-Json $raw } catch { $remote = $null }
  if ($null -eq $remote) {
    Write-Host "  本机版本 $localVersion；更新源返回的清单读不懂，跳过更新检查。" -ForegroundColor DarkGray
    return $false
  }

  # 远端不比本机新就什么都不动：本地这份可能是自己刚构建、还没推上去的更新版，
  # 只比文件哈希会把它倒着覆盖成仓库里那份旧的。
  $remoteVersion = Get-ManifestVersion $remote
  $script:RemoteVersion = $remoteVersion
  if ($remoteVersion -le $localVersion) {
    Write-Host "  本机版本 $localVersion，远端版本 $remoteVersion，已经是最新的。" -ForegroundColor DarkGray
    return $false
  }

  # 先把和远端对不上的挑出来，再决定这次动哪些
  $stale = @{}
  foreach ($property in $remote.PSObject.Properties) {
    $name = [string]$property.Name
    if ($name -eq 'version') { continue }   # 版本号不是文件，别当文件去下
    $expected = ([string]$property.Value).ToLowerInvariant()
    if ($expected -eq '') { continue }
    if ((Get-FileSha256 (Join-Path $Root $name)) -eq $expected) { continue }
    $stale[$name] = $expected
  }
  if ($stale.Count -eq 0) { return $false }

  Write-Host "  开始更新到 $remoteVersion" -ForegroundColor Cyan

  # 服务端脚本要换时，本次连页面也不换：现在跑的是内存里的那份旧服务端，
  # 配的就得是同一版的旧页面。让两边一起留到下次启动再变新，
  # 免得出现"新页面配旧服务端"这种对不上的组合。
  $serverStale = $stale.ContainsKey('storymaker-server.ps1') -or $stale.ContainsKey('启动StoryMaker.bat')

  $needRestart = $false
  foreach ($name in @($stale.Keys)) {
    if ($serverStale -and $name -eq 'index.html') {
      Write-Host '  页面也有新版，和服务端一起留到下次启动换，免得新旧对不上。' -ForegroundColor DarkGray
      continue
    }

    $expected = $stale[$name]
    $target = Join-Path $Root $name

    # 文件名里的中文要转义，否则请求发不出去
    $url = "$($script:UpdateBase)/" + [Uri]::EscapeDataString($name)
    $temp = "$target.new"
    Write-Host "  发现新版本，正在更新 $name ..." -ForegroundColor Cyan

    if (-not (Save-RemoteFile $url $temp 60000)) {
      Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
      Write-Host "  $name 没下下来，这次先用本机这份。" -ForegroundColor DarkGray
      continue
    }
    # 下完的字节对不上清单就不认它（断流、缓存坏了、中间被拦都可能）
    if ((Get-FileSha256 $temp) -ne $expected) {
      Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
      Write-Host "  $name 下下来的内容不对，这次先用本机这份。" -ForegroundColor DarkGray
      continue
    }
    try {
      Move-Item -LiteralPath $temp -Destination $target -Force
      Write-Host "  已更新 $name" -ForegroundColor Green
      if ($name -ne 'index.html') { $needRestart = $true }
    } catch {
      Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
      Write-Host "  $name 换不上去（可能正被占用），这次先用本机这份。" -ForegroundColor DarkGray
    }
  }

  return $needRestart
}

# ---------- 起服务 ----------

if ($ApiOnly) {
  # 开发模式：页面由 vite dev server 发，这里只管 /api
  $script:PageBytes = New-Object byte[] 0
} else {
  # 先看一眼远端有没有新版；-NoUpdate 是给自动化校验用的
  $serverUpdated = $false
  if (-not $NoUpdate) { $serverUpdated = [bool](Invoke-UpdateCheck) }

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
  $localShown = Get-LocalManifestVersion
  $remoteShown = '未获取'
  if ($null -ne $script:RemoteVersion) { $remoteShown = "$($script:RemoteVersion)" }
  Write-Host "  本机版本：$localShown    远端最新：$remoteShown"
  Write-Host "  页面地址：$url"
}
if ($null -ne $script:ProjectPath) {
  Write-Host "  上次的项目：$($script:ProjectPath)"
} else {
  Write-Host '  上次的项目：（还没有，在页面里新建或打开一个 .json 就行）'
}
Write-Host ''
Write-Host '  项目内容直接存在那个 .json 文件里，本机不留副本。'
if ($serverUpdated) {
  Write-Host ''
  Write-Host '  本地服务脚本也更新了，这次跑的还是旧版：' -ForegroundColor Yellow
  Write-Host '  关掉这个窗口，重新双击「启动StoryMaker.bat」就生效。' -ForegroundColor Yellow
}
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

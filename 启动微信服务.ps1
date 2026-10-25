$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = 'C:\Program Files\nodejs\node.exe'
if (!(Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
$privateDirectory = Join-Path $PSScriptRoot '.local\weixin'
New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
function Get-NianbanStatus {
    try {
        $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:8792/api/status')
        $request.Proxy = $null
        $request.Timeout = 2500
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
        } finally { $response.Dispose() }
    } catch { return $null }
}
& $nodePath 'scripts/prepare_weixin_lan.mjs'
if ($LASTEXITCODE -ne 0) { throw '无法准备本机加密连接。请检查网络与 Java 工具。' }
$serviceState = Get-NianbanStatus
$currentCertificate = Get-Content -LiteralPath (Join-Path $privateDirectory 'lan-certificate.json') -Raw | ConvertFrom-Json
if (!$serviceState -or !$serviceState.lan.ready -or $serviceState.lan.certificateCreatedAt -ne $currentCertificate.createdAt) {
    $pidFile = Join-Path $privateDirectory 'service.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $serviceProcessId = 0
        if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$serviceProcessId)) {
            $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serviceProcessId" -ErrorAction SilentlyContinue
            if ($serviceProcess -and $serviceProcess.Name -eq 'node.exe' -and $serviceProcess.CommandLine -match 'weixin[\\/]service\.mjs') {
                Stop-Process -Id $serviceProcessId
                Start-Sleep -Milliseconds 700
            }
        }
    }
    $env:NIANBAN_WEIXIN_TASKS = '1'
    $serviceScript = Join-Path $PSScriptRoot 'weixin\service.mjs'
    Start-Process -FilePath $nodePath -ArgumentList ('"' + $serviceScript + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $privateDirectory 'service.out.log') -RedirectStandardError (Join-Path $privateDirectory 'service.err.log') | Out-Null
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        Start-Sleep -Milliseconds 500
        $serviceState = Get-NianbanStatus
        if ($serviceState.lan.ready) { break }
    }
}
if (!$serviceState -or !$serviceState.lan.ready) { throw '微信服务未正常启动。请检查 .local\weixin\service.err.log；不要重复打开多个服务。' }
Write-Host '念办微信服务已在后台运行。电脑需保持开机、联网且不睡眠。'
Write-Host '手机与电脑在同一局域网后，打开念办同步；已保存到手机的提醒可以独立执行。'
if ($env:NIANBAN_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:8792/' }

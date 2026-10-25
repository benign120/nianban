$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot '.local\weixin\service.pid'
if (Test-Path -LiteralPath $pidFile) {
    $serviceProcessId = 0
    if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$serviceProcessId)) {
        $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serviceProcessId" -ErrorAction SilentlyContinue
        if ($serviceProcess -and $serviceProcess.Name -eq 'node.exe' -and $serviceProcess.CommandLine -match 'weixin[\\/]service\.mjs') {
            Stop-Process -Id $serviceProcessId
            Write-Host '已停止电脑上的微信服务；手机已有任务和提醒会保留。'
            exit
        }
    }
}
Write-Host '没有找到正在运行的念办微信服务。'

$ErrorActionPreference = 'Stop'
$rootDirectory = Split-Path -Parent $PSScriptRoot
$certificateConfig = Get-Content -LiteralPath (Join-Path $rootDirectory '.local\weixin\lan-certificate.json') -Raw | ConvertFrom-Json
$localAddresses = @($certificateConfig.addresses)
$remoteSubnets = @()
foreach ($address in $localAddresses) {
    $adapterAddress = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $address -ErrorAction Stop
    $bytes = [System.Net.IPAddress]::Parse($address).GetAddressBytes()
    $prefixLength = $adapterAddress.PrefixLength
    for ($index = 0; $index -lt 4; $index++) {
        $bits = [Math]::Max(0, [Math]::Min(8, $prefixLength - $index * 8))
        $mask = if ($bits -eq 0) { 0 } else { 256 - [Math]::Pow(2, 8 - $bits) }
        $bytes[$index] = $bytes[$index] -band [int]$mask
    }
    $remoteSubnets += (($bytes -join '.') + '/' + $prefixLength)
}
$ruleName = 'NianbanWeixinLAN'
$ruleParameters = @{ DisplayName='念办微信局域网同步'; Direction='Inbound'; Action='Allow'; Protocol='TCP'; LocalPort=8793; LocalAddress=$localAddresses; RemoteAddress=$remoteSubnets; Program='C:\Program Files\nodejs\node.exe'; Profile='Any'; Enabled='True' }
$existingRule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existingRule) { Set-NetFirewallRule -Name $ruleName @ruleParameters -ErrorAction Stop | Out-Null }
else { New-NetFirewallRule -Name $ruleName @ruleParameters -ErrorAction Stop | Out-Null }
Write-Output '已允许手机所在局域网连接念办的 HTTPS 同步端口；管理页面仍只在电脑本机开放。'

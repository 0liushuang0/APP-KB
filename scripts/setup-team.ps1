param(
    [Parameter(Mandatory = $true)]
    [string]$LanIp
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $root 'deploy/team.env'
$certPath = Join-Path $root 'deploy/tls/aikb-server.crt'
$keyPath = Join-Path $root 'deploy/tls/aikb-server.key'

$parsed = $null
if (-not [System.Net.IPAddress]::TryParse($LanIp, [ref]$parsed) -or
    $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    $parsed.IsIPv6LinkLocal -or $LanIp.StartsWith('127.')) {
    throw '请提供公司服务器的局域网 IPv4 地址，例如 192.168.1.50。'
}

if (Test-Path -LiteralPath $envPath) {
    throw "配置已存在：$envPath。为避免覆盖运行中的密钥和数据库密码，请保留原文件。"
}

if (-not (Test-Path -LiteralPath $certPath) -or -not (Test-Path -LiteralPath $keyPath)) {
    $gitBash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
    $bash = if (Test-Path -LiteralPath $gitBash) { $gitBash } else {
        (Get-Command bash -ErrorAction SilentlyContinue).Source
    }
    if (-not $bash) {
        throw '缺少 HTTPS 证书。请安装 Git for Windows，然后运行 bash deploy/tls/gen-cert.sh <服务器局域网IP>，再运行本脚本。'
    }
    Push-Location $root
    try {
        & $bash 'deploy/tls/gen-cert.sh' $LanIp
        if ($LASTEXITCODE -ne 0) { throw '生成 HTTPS 证书失败。' }
    } finally {
        Pop-Location
    }
}

$certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPath)
$san = $certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' } | Select-Object -First 1
if (-not $san -or $san.Format($true) -notlike "*$LanIp*") {
    throw "证书不包含服务器地址 $LanIp。请重新运行 bash deploy/tls/gen-cert.sh $LanIp 后再初始化。"
}

function New-HexSecret([int]$bytes) {
    $buffer = New-Object byte[] $bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return [System.BitConverter]::ToString($buffer).Replace('-', '').ToLowerInvariant()
}

$databasePassword = New-HexSecret 24
$jwtSecret = New-HexSecret 48
$aiKey = New-HexSecret 32
$adminPassword = New-HexSecret 16
$lines = @(
    'DB_USERNAME=postgres',
    "DB_PASSWORD=$databasePassword",
    'DB_NAME=aikb',
    "JWT_SECRET=$jwtSecret",
    "AI_SERVICE_API_KEY=$aiKey",
    "DEFAULT_ADMIN_PASSWORD=$adminPassword",
    'DEFAULT_ADMIN_USERNAME=admin',
    'DEFAULT_ADMIN_NICKNAME=系统管理员',
    'DEFAULT_ADMIN_EMAIL=admin@aikb.local',
    "PUBLIC_ORIGIN=https://$LanIp",
    'AUTO_BACKUP_ENABLED=true',
    'AUTO_BACKUP_INTERVAL_HOURS=6',
    'AUTO_BACKUP_KEEP_COUNT=7',
    'EMBEDDING_PROVIDER=basic',
    'EGRESS_MODE=local_only',
    'EGRESS_SANITIZE=true'
)
[System.IO.File]::WriteAllText($envPath, ($lines -join "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "团队配置已保存：$envPath"
Write-Host "客户端地址：https://$LanIp"
Write-Host '初始管理员账号：admin'
Write-Host "初始管理员密码：$adminPassword"
Write-Host '请安全保存初始密码并在首次登录后修改。每台员工电脑需信任 deploy/tls/aikb-server.crt。'

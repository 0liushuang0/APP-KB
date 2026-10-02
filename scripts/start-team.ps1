$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $root 'deploy/team.env'
$certPath = Join-Path $root 'deploy/tls/aikb-server.crt'
$keyPath = Join-Path $root 'deploy/tls/aikb-server.key'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw '未找到 Docker。请在公司服务器安装并启动 Docker Desktop，然后重试。'
}
foreach ($file in @($envPath, $certPath, $keyPath)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "缺少部署文件：$file。先运行 scripts/setup-team.ps1。"
    }
}

$originLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -like 'PUBLIC_ORIGIN=*' } | Select-Object -First 1
if (-not $originLine) { throw '配置缺少 PUBLIC_ORIGIN；请检查 deploy/team.env。' }
$origin = $originLine.Substring('PUBLIC_ORIGIN='.Length)
if ($origin -notmatch '^https://') { throw 'PUBLIC_ORIGIN 必须使用 https://。' }

Push-Location $root
try {
    & docker compose --env-file $envPath config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 配置检查失败。' }
    & docker compose --env-file $envPath up --build -d
    if ($LASTEXITCODE -ne 0) { throw '服务启动失败，请检查 docker compose logs。' }
    & docker compose --env-file $envPath ps
    Write-Host "访问地址：$origin"
    Write-Host '请从另一台员工电脑完成登录、协作、文件下载和结项报表验收。'
} finally {
    Pop-Location
}

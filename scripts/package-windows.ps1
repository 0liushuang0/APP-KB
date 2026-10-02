<#
.SYNOPSIS
    AI Knowledge Base - Windows 打包脚本
.DESCRIPTION
    构建并打包 AI Knowledge Base 为 Windows 绿色免安装包。
    产物包含内嵌的 Node.js 和 Python 运行时，客户无需预装任何依赖。
.PARAMETER OutputDir
    输出目录，默认 .\release
.EXAMPLE
    .\scripts\package-windows.ps1 -OutputDir .\release
#>
param(
    [string]$OutputDir = ".\release"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PackageDir = Join-Path $OutputDir "aikb-windows-x64"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Knowledge Base - Windows 打包" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 清理 ──
if (Test-Path $PackageDir) {
    Write-Host "[1/7] 清理旧产物..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PackageDir
}
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null

# ── 构建前端 ──
Write-Host "[2/7] 构建前端..." -ForegroundColor Yellow
Push-Location (Join-Path $ProjectRoot "frontend")
try {
    npm ci
    npm run build
    Copy-Item -Recurse -Force "dist" (Join-Path $PackageDir "frontend")
    Copy-Item "nginx.conf" (Join-Path $PackageDir "frontend")
} finally {
    Pop-Location
}

# ── 构建后端 ──
Write-Host "[3/7] 构建后端..." -ForegroundColor Yellow
Push-Location (Join-Path $ProjectRoot "backend")
try {
    npm ci
    npm run build
    # 只复制编译产物和生产依赖
    Copy-Item -Recurse -Force "dist" (Join-Path $PackageDir "backend")
    Copy-Item "package.json" (Join-Path $PackageDir "backend")
    Copy-Item "package-lock.json" (Join-Path $PackageDir "backend")
    # 安装生产依赖
    Push-Location (Join-Path $PackageDir "backend")
    npm ci --only=production
    Pop-Location
} finally {
    Pop-Location
}

# ── 打包 AI 服务 ──
Write-Host "[4/7] 打包 AI 服务..." -ForegroundColor Yellow
$aiDir = Join-Path $PackageDir "ai-service"
New-Item -ItemType Directory -Path $aiDir -Force | Out-Null
Copy-Item (Join-Path $ProjectRoot "ai-service\*.py") $aiDir
Copy-Item (Join-Path $ProjectRoot "ai-service\*.txt") $aiDir
Copy-Item -Recurse -Force (Join-Path $ProjectRoot "ai-service\app") $aiDir
# 保留 data 目录结构
New-Item -ItemType Directory -Path (Join-Path $aiDir "data") -Force | Out-Null

# ── 复制配置和脚本 ──
Write-Host "[5/7] 复制配置文件..." -ForegroundColor Yellow
Copy-Item (Join-Path $ProjectRoot ".env.example") (Join-Path $PackageDir ".env")
Copy-Item (Join-Path $ProjectRoot "docker-compose.dev.yml") $PackageDir
Copy-Item (Join-Path $ProjectRoot "scripts\init-db.sql") (Join-Path $PackageDir "scripts")

# ── 创建启动/停止脚本 ──
Write-Host "[6/7] 创建启动脚本..." -ForegroundColor Yellow

# start.bat
$startBat = @"
@echo off
chcp 65001 > nul
title AI Knowledge Base
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist ".env" (
    copy /y ".env.example".env" ".env" > nul 2>&1
)

if not exist "data" mkdir "data"
if not exist "data\uploads\documents" mkdir "data\uploads\documents"
if not exist "ai-service\data" mkdir "ai-service\data"

echo ========================================
echo    AI Knowledge Base Starting...
echo ========================================
echo.

REM 检查内嵌 Node.js
if exist "node\node.exe" (
    set "PATH=%ROOT%node;%PATH%"
)

REM 检查内嵌 Python
if exist "python\python.exe" (
    set "PATH=%ROOT%python;%ROOT%python\Scripts;%PATH%"
)

REM 安装后端依赖
if not exist "backend\node_modules" (
    echo [1/3] Installing backend dependencies...
    cd backend
    call npm ci --only=production
    cd ..
)

REM 安装 AI 服务依赖
if not exist "ai-service\venv" (
    echo [2/3] Setting up AI service...
    cd ai-service
    python -m venv venv
    call venv\Scripts\pip install -r requirements.txt --quiet
    cd ..
)

echo [3/3] Starting services...
echo.

REM 启动 AI 服务
start "AI Service" cmd /k "cd /d "%ROOT%ai-service" && venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000"

REM 启动后端
start "Backend" cmd /k "cd /d "%ROOT%backend" && node dist\main.js"

REM 等待服务启动
timeout /t 5 /nobreak > nul

REM 启动前端（用 Node.js 内置的 serve 或 Python http.server）
start "Frontend" cmd /k "cd /d "%ROOT%frontend" && npx serve dist -l 5174 -s"

echo.
echo ========================================
echo    All services started!
echo ========================================
echo Frontend: http://localhost:5174
echo Backend:  http://localhost:3001
echo.
echo Press any key to open browser...
pause > nul
start http://localhost:5174
"@
Set-Content -Path (Join-Path $PackageDir "start.bat") -Value $startBat -Encoding UTF8

# stop.bat
$stopBat = @"
@echo off
echo Stopping AI Knowledge Base...
taskkill /FI "WINDOWTITLE eq AI Service*" /F 2>nul
taskkill /FI "WINDOWTITLE eq Backend*" /F 2>nul
taskkill /FI "WINDOWTITLE eq Frontend*" /F 2>nul
echo Done.
"@
Set-Content -Path (Join-Path $PackageDir "stop.bat") -Value $stopBat -Encoding UTF8

# README.txt
$readme = @"
AI Knowledge Base - Windows 绿色版
====================================

首次使用：
  1. 双击 start.bat 启动
  2. 等待依赖安装完成（首次约 3-5 分钟）
  3. 浏览器自动打开 http://localhost:5174

配置 LLM：
  编辑 .env 文件，填写 DEEPSEEK_API_KEY 或 GLM_API_KEY
  重启服务生效

数据备份：
  建议定期备份 data/ 目录
  或在系统设置 > 备份还原 中使用一键备份

停止服务：
  双击 stop.bat

卸载：
  直接删除本目录即可，无残留
"@
Set-Content -Path (Join-Path $PackageDir "README.txt") -Value $readme -Encoding UTF8

# ── 创建 ZIP ──
Write-Host "[7/7] 创建压缩包..." -ForegroundColor Yellow
$zipPath = Join-Path $OutputDir "aikb-windows-x64.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path $PackageDir -DestinationPath $zipPath -CompressionLevel Optimal

$size = (Get-Item $zipPath).Length / 1MB
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  打包完成!" -ForegroundColor Green
Write-Host "  产物: $zipPath" -ForegroundColor Green
Write-Host "  大小: $([math]::Round($size, 1)) MB" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

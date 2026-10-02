@echo off
title AI Knowledge Base

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

echo ========================================
echo    AI Knowledge Base - Starting
echo ========================================
echo.

echo [CLEANUP] Stopping any existing services first...
powershell -Command "3101,5274,8100 | ForEach-Object { $conn = Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue; if ($conn) { $conn.OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } }" >nul 2>&1
timeout /t 2 /nobreak >nul
echo    Cleanup done.
echo.

if not exist ".env" (
    if exist ".env.example" (
        echo [INFO] Copying .env.example to .env ...
        copy /y ".env.example" ".env" > nul
    )
)

if not exist "data\uploads\documents" mkdir "data\uploads\documents"
if not exist "ai-service\data" mkdir "ai-service\data"
if not exist "ai-service\data\vectors" mkdir "ai-service\data\vectors"
if not exist "logs" mkdir "logs"

echo [1/3] Starting AI service (port 8100)...
cd /d "%PROJECT_DIR%ai-service"
start "" /b cmd /c ".\venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8100 > ..\logs\ai-service.log 2>&1"

echo [2/3] Starting backend (port 3101)...
cd /d "%PROJECT_DIR%backend"
start "" /b cmd /c "npm run start > ..\logs\backend.log 2>&1"

echo [3/3] Starting frontend (port 5274)...
cd /d "%PROJECT_DIR%frontend"
start "" /b cmd /c "npm run dev > ..\logs\frontend.log 2>&1"

cd /d "%PROJECT_DIR%"

echo.
echo ========================================
echo    All services started in background
echo ========================================
echo.
echo   Frontend:     http://localhost:5274
echo   Backend:      http://localhost:3101
echo   API Docs:     http://localhost:3101/api/docs
echo   AI service:   http://localhost:8100
echo.
echo   Log files:
echo     logs\ai-service.log
echo     logs\backend.log
echo     logs\frontend.log
echo.
echo   Opening browser in 12 seconds...
echo ========================================

timeout /t 12 /nobreak >nul
start "" "http://localhost:5274"

echo.
echo   Browser opened.
echo   Press any key to stop all services and exit.
echo ========================================
pause >nul

echo.
echo Stopping services...
powershell -Command "Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*uvicorn*' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
powershell -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*vite*' -or $_.CommandLine -like '*nest*' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
echo Services stopped.
timeout /t 2 /nobreak >nul
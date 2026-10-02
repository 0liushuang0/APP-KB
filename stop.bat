@echo off
title Stop AI Knowledge Base

echo Stopping all services...

powershell -Command "Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*uvicorn*' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
powershell -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*vite*' -or $_.CommandLine -like '*nest*' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1

echo.
echo All services stopped.
pause
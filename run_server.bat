@echo off
setlocal

cd /d "%~dp0"
title Renge Agent Lab PC Server

if not defined PORT set "PORT=5190"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please check your Node.js installation.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] Installing dependencies...
  call npm install
  if errorlevel 1 goto failed
) else (
  echo [1/3] Dependencies are ready.
)

echo.
echo [2/3] Building the web application...
call npm run build
if errorlevel 1 goto failed

echo.
echo [3/3] Starting the PC server...
echo.
echo Local address: http://127.0.0.1:%PORT%
echo On the phone, enter this computer's LAN IPv4 address followed by :%PORT%
echo Example: 192.168.1.20:%PORT%
echo.
echo This window must remain open while the phone is connected.
echo Press Ctrl+C to stop the server.
echo.
node server.mjs
set "SERVER_EXIT_CODE=%ERRORLEVEL%"

echo.
if "%SERVER_EXIT_CODE%"=="-1073741510" (
  echo Server stopped by user.
) else if not "%SERVER_EXIT_CODE%"=="0" (
  echo Server stopped with exit code %SERVER_EXIT_CODE%.
) else (
  echo Server stopped.
)
echo.
pause
exit /b %SERVER_EXIT_CODE%

:failed
echo.
echo Failed to prepare or start the server. Review the error output above.
echo.
pause
exit /b 1

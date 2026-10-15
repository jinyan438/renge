@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please check your Node.js installation.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Renge Agent Lab desktop app...
call npm run desktop
set "DESKTOP_EXIT_CODE=%ERRORLEVEL%"

if not "%DESKTOP_EXIT_CODE%"=="0" (
  echo Desktop app stopped with exit code %DESKTOP_EXIT_CODE%. Review the error output above.
  pause
)
exit /b %DESKTOP_EXIT_CODE%

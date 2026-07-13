@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "ANDROID_DIR=%ROOT_DIR%renge_android"
set "APK_PATH=%ANDROID_DIR%\app\build\outputs\apk\debug\app-debug.apk"
set "INSTALL_APK=%ROOT_DIR%Renge-Agent-Lab-debug.apk"
set "NO_PAUSE="
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"

echo [1/4] Building frontend and a clean Android debug APK...
cd /d "%ANDROID_DIR%"
call gradlew.bat clean assembleDebug
if errorlevel 1 goto failed

echo.
echo [2/4] Verifying APK structure and signature...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%scripts\verify-android-apk.ps1" -ApkPath "%APK_PATH%"
if errorlevel 1 goto failed

echo.
echo [3/4] Copying installable APK to the project root...
copy /Y "%APK_PATH%" "%INSTALL_APK%" >nul
if errorlevel 1 goto failed

echo.
echo [4/4] Done.
echo Installable APK: %INSTALL_APK%
echo.
if not defined NO_PAUSE pause
exit /b 0

:failed
echo.
echo Build failed. See the error above.
echo.
if not defined NO_PAUSE pause
exit /b 1

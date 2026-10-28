@echo off
setlocal
cd /d "%~dp0"
if exist "dist\Workset-win32-x64\Workset.exe" (
    start "" "dist\Workset-win32-x64\Workset.exe"
    exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
    echo Please install Node.js 22.12 or newer, or use the portable build.
    pause
    exit /b 1
)
if not exist "node_modules\electron\package.json" (
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
        pause
        exit /b 1
    )
)
call npm start
if errorlevel 1 pause

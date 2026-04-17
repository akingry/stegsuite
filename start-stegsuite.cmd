@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules\electron (
  echo Installing desktop dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install desktop dependencies.
    exit /b 1
  )
)

call npm run desktop
exit /b %errorlevel%

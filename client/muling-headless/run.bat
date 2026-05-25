@echo off
cd /d "%~dp0"
if not exist dist\muler.js (
  echo [muling-headless] Not built yet. Running build first...
  call build.bat
  if errorlevel 1 exit /b 1
)
echo [muling-headless] Usage: run.bat --mainId ^<account-id^>
node dist\muler.js %*

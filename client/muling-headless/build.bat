@echo off
echo [muling-headless] Installing dependencies...
cd /d "%~dp0"
npm install
if errorlevel 1 (
  echo [muling-headless] npm install failed.
  exit /b 1
)
echo [muling-headless] Building TypeScript...
npm run build
if errorlevel 1 (
  echo [muling-headless] Build failed.
  exit /b 1
)
echo [muling-headless] Build complete. dist/muler.js is ready.

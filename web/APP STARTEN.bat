@echo off
chcp 65001 >nul
title Nemesis Videos AI
cd /d "%~dp0"

if not exist "node_modules\" (
  echo Einmalig: installiert wird gerade...
  call npm install
  if errorlevel 1 (
    echo.
    echo Fehler: Node.js fehlt? Hier installieren: https://nodejs.org  ^(LTS^)
    pause
    exit /b 1
  )
)

echo.
echo Nemesis Videos AI - KI Video Generator
echo Browser gleich: http://localhost:3040  ^(nicht 3000 - damit keine andere App aufgeht^)
echo Zum Beenden: Fenster schliessen oder Strg+C
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:3040"

call npm run dev

pause

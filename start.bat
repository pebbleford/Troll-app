@echo off
title Troll Remote
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Download the LTS version from https://nodejs.org , install it, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing, this takes a minute...
  call npm install
  if errorlevel 1 (
    echo Install failed. See the messages above.
    pause
    exit /b 1
  )
)

call npm start

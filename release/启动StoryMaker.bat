@echo off
rem StoryMaker launcher.
rem Starts the local service (Windows PowerShell, no install needed) and opens the page.
rem STORYMAKER_NO_BROWSER=1 is only used by the automated checks (pnpm verify:server).
chcp 65001 >nul
title StoryMaker
cd /d "%~dp0"
set SM_NO_BROWSER=
if defined STORYMAKER_NO_BROWSER set SM_NO_BROWSER=-NoBrowser
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0storymaker-server.ps1" %SM_NO_BROWSER%
if errorlevel 1 (
  echo.
  echo StoryMaker failed to start. Please read the message above.
  pause
)

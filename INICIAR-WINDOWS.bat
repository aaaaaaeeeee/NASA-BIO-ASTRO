@echo off
title A.R.E.S. Bio-Twin OS
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor-windows.ps1"
if errorlevel 1 pause

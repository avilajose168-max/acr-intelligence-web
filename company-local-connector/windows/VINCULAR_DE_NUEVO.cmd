@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
 py -3 acr_connector.py --pair
) else (
 python acr_connector.py --pair
)
pause

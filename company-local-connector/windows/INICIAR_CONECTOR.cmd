@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ACR Integrity - Conector local de prueba
where py >nul 2>nul
if not errorlevel 1 (
 py -3 acr_connector.py
 goto finish
)
where python >nul 2>nul
if not errorlevel 1 (
 python acr_connector.py
 goto finish
)
echo.
echo Necesitas Python 3.10 o posterior para esta prueba.
echo Descargalo desde https://www.python.org/downloads/windows/ y vuelve a abrir este archivo.
:finish
echo.
pause

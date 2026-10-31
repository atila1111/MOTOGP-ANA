@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title MotoGP Telemetry - Servidor
set PYTHONIOENCODING=utf-8
if not defined PORT set PORT=8000

rem Python: primero el entorno virtual del proyecto, si no el del sistema
set "PYRUN="
if exist ".venv\Scripts\python.exe" set "PYRUN=.venv\Scripts\python.exe"
if not defined PYRUN (
  where py >nul 2>nul
  if not errorlevel 1 set "PYRUN=py -3"
)
if not defined PYRUN (
  where python >nul 2>nul
  if not errorlevel 1 set "PYRUN=python"
)
if not defined PYRUN goto :falta

%PYRUN% -c "import pdfplumber" >nul 2>nul
if errorlevel 1 goto :falta

%PYRUN% tools\actualizar.py --carpetas >nul 2>nul

echo ==============================================================
echo   MotoGP Telemetry  -  http://localhost:%PORT%
echo   Suelta los PDF en  CIRCUITO\SESION\  y pulsa F5 en el navegador.
echo   La primera carga tarda de 30 s a 1 min. Ctrl+C para parar.
echo ==============================================================
start "" "http://localhost:%PORT%/"
%PYRUN% tools\servidor.py
goto :fin

:falta
echo Falta Python 3.9+ o la libreria pdfplumber.
echo Ejecuta primero instalar.bat
pause
exit /b 1

:fin
endlocal

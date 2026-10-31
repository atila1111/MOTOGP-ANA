@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title MotoGP Telemetry - Instalacion
set PYTHONIOENCODING=utf-8

echo ==============================================================
echo   MotoGP Telemetry - verificacion e instalacion (Windows)
echo ==============================================================
echo.

rem ---------------------------------------------------------------- 1. Python 3.9+
set "PY="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>nul
  if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>nul
    if not errorlevel 1 set "PY=python"
  )
)
if defined PY (
  for /f "delims=" %%v in ('%PY% -c "import sys; print(sys.version.split()[0])"') do set "PYVER=%%v"
  echo [OK] Python !PYVER! encontrado ^(%PY%^)
) else (
  echo [FALTA] Python 3.9 o superior no esta instalado o no esta en el PATH.
  where winget >nul 2>nul
  if errorlevel 1 (
    echo         Descargalo de https://www.python.org/downloads/ y marca "Add python.exe to PATH".
    echo         Despues vuelve a ejecutar instalar.bat.
    pause
    exit /b 1
  )
  set "R="
  set /p "R=Instalar Python 3.12 ahora con winget? (S/N): "
  if /i "!R!"=="S" (
    winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    echo.
    echo Python instalado. CIERRA esta ventana y vuelve a ejecutar instalar.bat para que se actualice el PATH.
  ) else (
    echo Instalacion cancelada. Instala Python 3.9+ y vuelve a ejecutar instalar.bat.
  )
  pause
  exit /b 1
)

rem ---------------------------------------------------------------- 2. entorno virtual
set "PYRUN=%PY%"
if exist ".venv\Scripts\python.exe" (
  set "PYRUN=.venv\Scripts\python.exe"
  echo [OK] Entorno virtual .venv ya existe
) else (
  set "R="
  set /p "R=Crear un entorno virtual .venv en esta carpeta (recomendado)? (S/N): "
  if /i "!R!"=="S" (
    %PY% -m venv .venv
    if errorlevel 1 (
      echo [ERROR] No se pudo crear el entorno virtual. Se usara el Python del sistema.
    ) else (
      set "PYRUN=.venv\Scripts\python.exe"
      echo [OK] Entorno virtual creado
    )
  )
)

rem ---------------------------------------------------------------- 3. dependencias
%PYRUN% -c "import pdfplumber" >nul 2>nul
if errorlevel 1 (
  echo [FALTA] Libreria pdfplumber ^(lectura de los PDF oficiales^)
  set "R="
  set /p "R=Instalar dependencias de requirements.txt con pip? (S/N): "
  if /i not "!R!"=="S" (
    echo Sin pdfplumber el programa no puede leer los PDF. Instalacion cancelada.
    pause
    exit /b 1
  )
  %PYRUN% -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] Fallo la instalacion con pip. Revisa la conexion a Internet y vuelve a intentarlo.
    pause
    exit /b 1
  )
  %PYRUN% -c "import pdfplumber" >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] pdfplumber sigue sin poder importarse.
    pause
    exit /b 1
  )
)
echo [OK] pdfplumber disponible

rem ---------------------------------------------------------------- 4. Internet para las librerias del navegador
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -UseBasicParsing -Uri https://unpkg.com -TimeoutSec 8; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [AVISO] No hay acceso a unpkg.com / cdn.tailwindcss.com / cdn.jsdelivr.net.
  echo         El dashboard carga React, Tailwind y Chart.js desde esas CDN: necesita Internet al abrirlo.
) else (
  echo [OK] Acceso a las CDN del dashboard ^(React, Tailwind, Chart.js^)
)

rem ---------------------------------------------------------------- 5. carpetas
%PYRUN% tools\actualizar.py --carpetas
if errorlevel 1 (
  echo [ERROR] No se pudieron preparar las carpetas.
  pause
  exit /b 1
)
echo [OK] Carpetas CIRCUITO\sesion preparadas

rem ---------------------------------------------------------------- 6. primera generacion
echo.
set "R="
set /p "R=Generar ahora index.html con los PDF actuales (tarda de 30 s a 1 min)? (S/N): "
if /i "!R!"=="S" (
  %PYRUN% tools\actualizar.py
  if errorlevel 1 (
    echo [ERROR] La generacion fallo. Revisa los mensajes anteriores.
    pause
    exit /b 1
  )
)

echo.
echo ==============================================================
echo   Instalacion completada.
echo   Para arrancar:  iniciar.bat   ^(abre http://localhost:8000^)
echo   Manual:         README.txt
echo ==============================================================
set "R="
set /p "R=Arrancar el servidor ahora? (S/N): "
if /i "!R!"=="S" call "%~dp0iniciar.bat"
endlocal
exit /b 0

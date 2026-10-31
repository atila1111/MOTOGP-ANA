#!/usr/bin/env bash
# MotoGP Telemetry - verificacion e instalacion (Linux / macOS)
set -u
cd "$(dirname "$0")"
export PYTHONIOENCODING=utf-8

ask() { local r; read -r -p "$1 (s/N): " r; [[ "$r" =~ ^[sSyY]$ ]]; }

echo "=============================================================="
echo "  MotoGP Telemetry - verificacion e instalacion (Linux/macOS)"
echo "=============================================================="
echo

# ---------------------------------------------------------------- 1. Python 3.9+
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "[FALTA] Python 3.9 o superior no esta instalado."
  if command -v apt-get >/dev/null 2>&1; then CMD="sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip"
  elif command -v dnf >/dev/null 2>&1; then CMD="sudo dnf install -y python3 python3-pip"
  elif command -v pacman >/dev/null 2>&1; then CMD="sudo pacman -S --noconfirm python python-pip"
  elif command -v brew >/dev/null 2>&1; then CMD="brew install python"
  else CMD=""; fi
  if [ -n "$CMD" ] && ask "Instalar Python con:  $CMD  ?"; then
    eval "$CMD" || { echo "[ERROR] Fallo la instalacion de Python."; exit 1; }
    for c in python3 python; do command -v "$c" >/dev/null 2>&1 && PY="$c" && break; done
  fi
  [ -n "$PY" ] || { echo "Instala Python 3.9+ (https://www.python.org/downloads/) y vuelve a ejecutar ./instalar.sh"; exit 1; }
fi
echo "[OK] Python $($PY -c 'import sys; print(sys.version.split()[0])') ($PY)"

# ---------------------------------------------------------------- 2. entorno virtual
PYRUN="$PY"
if [ -x ".venv/bin/python" ]; then
  PYRUN=".venv/bin/python"; echo "[OK] Entorno virtual .venv ya existe"
elif ask "Crear un entorno virtual .venv en esta carpeta (recomendado)?"; then
  if "$PY" -m venv .venv 2>/dev/null; then PYRUN=".venv/bin/python"; echo "[OK] Entorno virtual creado"
  else
    echo "[ERROR] No se pudo crear el entorno virtual (en Debian/Ubuntu: sudo apt-get install python3-venv). Se usara el Python del sistema."
    rm -rf .venv
  fi
fi

# ---------------------------------------------------------------- 3. dependencias
if ! "$PYRUN" -c 'import pdfplumber' 2>/dev/null; then
  echo "[FALTA] Libreria pdfplumber (lectura de los PDF oficiales)"
  ask "Instalar dependencias de requirements.txt con pip?" || { echo "Sin pdfplumber el programa no puede leer los PDF. Instalacion cancelada."; exit 1; }
  "$PYRUN" -m pip install -r requirements.txt || { echo "[ERROR] Fallo pip. Si el sistema bloquea pip (PEP 668) crea el entorno .venv y repite."; exit 1; }
  "$PYRUN" -c 'import pdfplumber' 2>/dev/null || { echo "[ERROR] pdfplumber sigue sin poder importarse."; exit 1; }
fi
echo "[OK] pdfplumber disponible"

# ---------------------------------------------------------------- 4. Internet (CDN del dashboard)
if command -v curl >/dev/null 2>&1; then
  if curl -fsS -m 8 -o /dev/null https://unpkg.com 2>/dev/null; then echo "[OK] Acceso a las CDN del dashboard (React, Tailwind, Chart.js)"
  else echo "[AVISO] Sin acceso a unpkg.com / cdn.tailwindcss.com / cdn.jsdelivr.net: el dashboard necesita Internet al abrirse."; fi
fi

# ---------------------------------------------------------------- 5. carpetas
"$PYRUN" tools/actualizar.py --carpetas || { echo "[ERROR] No se pudieron preparar las carpetas."; exit 1; }
echo "[OK] Carpetas CIRCUITO/sesion preparadas"

# ---------------------------------------------------------------- 6. primera generacion
echo
if ask "Generar ahora index.html con los PDF actuales (tarda de 30 s a 1 min)?"; then
  "$PYRUN" tools/actualizar.py || { echo "[ERROR] La generacion fallo."; exit 1; }
fi
chmod +x iniciar.sh 2>/dev/null

echo
echo "=============================================================="
echo "  Instalacion completada."
echo "  Para arrancar:  ./iniciar.sh   (abre http://localhost:8000)"
echo "  Manual:         README.txt"
echo "=============================================================="
if ask "Arrancar el servidor ahora?"; then exec ./iniciar.sh; fi

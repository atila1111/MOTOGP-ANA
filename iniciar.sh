#!/usr/bin/env bash
# MotoGP Telemetry - arranca el servidor local (Linux / macOS)
cd "$(dirname "$0")" || exit 1
export PYTHONIOENCODING=utf-8
PORT="${PORT:-8000}"; export PORT

PYRUN=""
if [ -x ".venv/bin/python" ]; then PYRUN=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then PYRUN="python3"
elif command -v python >/dev/null 2>&1; then PYRUN="python"; fi
if [ -z "$PYRUN" ] || ! "$PYRUN" -c 'import pdfplumber' 2>/dev/null; then
  echo "Falta Python 3.9+ o la libreria pdfplumber. Ejecuta primero ./instalar.sh"; exit 1
fi

"$PYRUN" tools/actualizar.py --carpetas >/dev/null 2>&1
echo "=============================================================="
echo "  MotoGP Telemetry  -  http://localhost:$PORT"
echo "  Suelta los PDF en  CIRCUITO/SESION/  y pulsa F5 en el navegador."
echo "  La primera carga tarda de 30 s a 1 min. Ctrl+C para parar."
echo "=============================================================="
( sleep 1; { command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:$PORT/" || command -v open >/dev/null 2>&1 && open "http://localhost:$PORT/"; } >/dev/null 2>&1 ) &
exec "$PYRUN" tools/servidor.py

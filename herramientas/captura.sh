#!/bin/bash
# Uso: captura.sh URL ANCHO ALTO salida.png  — captura con Edge sin ventana
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"$EDGE" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$2,$3" --virtual-time-budget=${5:-15000} --screenshot="$4" "$1" 2>/dev/null

#!/usr/bin/env bash
# RuFaS Simulation Studio - Painel Web (Linux)
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "========================================================"
echo "      RuFaS Simulation Studio - Pesquisa Operacional"
echo "========================================================"
echo ""
echo "Iniciando o servidor web local..."
echo "Acesse no navegador: http://127.0.0.1:5000"
echo ""

if [ -f "venv/bin/python" ]; then
    PYTHON_EXEC="venv/bin/python"
elif [ -f "/home/ivanio/venv/bin/python" ]; then
    PYTHON_EXEC="/home/ivanio/venv/bin/python"
else
    PYTHON_EXEC="python3"
fi

if command -v xdg-open > /dev/null; then
    xdg-open "http://127.0.0.1:5000" >/dev/null 2>&1 &
fi

exec "$PYTHON_EXEC" web_app/app.py

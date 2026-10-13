@echo off
title RuFaS Simulation Studio - Painel Web
echo ========================================================
echo       RuFaS Simulation Studio - Pesquisa Operacional
echo ========================================================
echo.
echo Iniciando o servidor web local...
echo O painel abrira no seu navegador em: http://127.0.0.1:5000
echo.

start "" http://127.0.0.1:5000
"..\..\venv\Scripts\python.exe" web_app\app.py

pause

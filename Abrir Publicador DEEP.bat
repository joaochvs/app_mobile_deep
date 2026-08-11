@echo off
cd /d "%~dp0"
python -c "import google.auth, google_auth_oauthlib, googleapiclient, openpyxl, pandas" >nul 2>nul
if errorlevel 1 (
    echo Preparando as dependencias do Publicador DEEP...
    python -m pip install -r requirements-publicador.txt
    if errorlevel 1 (
        echo.
        echo Nao foi possivel instalar as dependencias.
        echo Verifique a conexao com a internet e tente novamente.
        pause
        exit /b 1
    )
)
python publicador_deep.py

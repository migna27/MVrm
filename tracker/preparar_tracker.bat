@echo off
setlocal
title Instalador Motor Tracking 3D
color 0B

echo ===================================================
echo     Instalador del Motor Externo (Python Tracker)
echo ===================================================
echo.

set "TRACKER_DIR=%~dp0"
set "PYTHON_ZIP=python-3.11.8-embed-amd64.zip"
set "PYTHON_URL=https://www.python.org/ftp/python/3.11.8/%PYTHON_ZIP%"
set "PYTHON_DIR=%TRACKER_DIR%python_portable"
set "PYTHON_EXE=%PYTHON_DIR%\python.exe"
set "PIP_PY=%TRACKER_DIR%get-pip.py"

if exist "%PYTHON_EXE%" (
    echo [OK] Python Portable ya esta instalado en tracker/python_portable.
    goto :instalar_dependencias
)

echo [INFO] Descargando Python Portable (Cero Instalacion) para el tracking...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%PYTHON_ZIP%'"

echo [INFO] Extrayendo Python Portable...
powershell -Command "Expand-Archive -Path '%PYTHON_ZIP%' -DestinationPath '%PYTHON_DIR%' -Force"
del "%PYTHON_ZIP%"

echo [INFO] Habilitando librerias en Python Portable...
:: Modificar python311._pth para descomentar import site
powershell -Command "(Get-Content '%PYTHON_DIR%\python311._pth') -replace '#import site', 'import site' | Set-Content '%PYTHON_DIR%\python311._pth'"

echo [INFO] Descargando PIP...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%PIP_PY%'"

echo [INFO] Instalando PIP en el entorno portable...
"%PYTHON_EXE%" "%PIP_PY%"
del "%PIP_PY%"

:instalar_dependencias
echo.
echo [INFO] Comprobando modelos y librerias matematicas (MediaPipe, OpenCV, SciPy)...
"%PYTHON_EXE%" -m pip install -r "%TRACKER_DIR%requirements.txt"

echo.
echo ===================================================
echo   [OK] El Motor de Tracking Externo esta listo.
echo ===================================================
echo Puedes arrastrar un video .mp4 a este ejecutable o usar la app.
pause

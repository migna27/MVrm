@echo off
setlocal
title Animador VRM - Cero Instalacion
color 0B

echo ===================================================
echo       Animador VRM - Asistente de Inicio
echo ===================================================
echo.

:: Definir rutas locales portables
set "NODE_DIR=%~dp0.node"
set "NODE_VERSION=v20.11.1"
set "NODE_ZIP=node-%NODE_VERSION%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_ZIP%"
set "NODE_PATH=%NODE_DIR%\node-%NODE_VERSION%-win-x64"
set "NODE_EXE=%NODE_PATH%\node.exe"
set "NPM_CMD=%NODE_PATH%\npm.cmd"

:: 1. Comprobar Node.js (Portable)
if exist "%NODE_EXE%" (
    echo [OK] Motor interno detectado.
    goto :entorno_preparado
)

echo [AVISO] Preparando motor interno por primera vez...
echo         Esto no instalara nada en tu computadora ni requiere permisos de administrador.
echo         (Descargando entorno base, por favor espera un momento...)
echo.

:: Descargar Node ZIP portable usando powershell de forma silenciosa
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%'"

if not exist "%NODE_ZIP%" (
    color 0C
    echo [ERROR] No se pudo descargar el motor base. Revisa tu conexion a internet.
    pause
    exit /b
)

echo.
echo [INFO] Extrayendo archivos necesarios...
powershell -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%NODE_DIR%' -Force"

:: Limpiar el archivo ZIP
del "%NODE_ZIP%"

echo [OK] Motor interno configurado exitosamente.
echo.

:entorno_preparado
:: 2. Actualizar el PATH temporalmente para la sesion de esta consola
set "PATH=%NODE_PATH%;%PATH%"

:: 3. Instalar/verificar librerias (dependencias del proyecto)
if not exist "node_modules\" (
    echo [INFO] Descargando librerias del proyecto (esto solo ocurre una vez)...
    call "%NPM_CMD%" install --silent
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] Hubo un problema al descargar las librerias.
        pause
        exit /b
    )
    echo [OK] Librerias instaladas.
    echo.
)

:: 4. Arrancar aplicacion
color 0A
echo ===================================================
echo       Iniciando aplicacion en el navegador...
echo ===================================================
echo.
echo No cierres esta ventana negra mientras estes usando el animador.
echo Para salir, simplemente cierra esta consola.
echo.

call "%NPM_CMD%" run dev

pause

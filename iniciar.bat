@echo off
title Preparando Entorno - Animador VRM
color 0A

echo ===================================================
echo       Asistente de Inicio - Animador VRM
echo ===================================================
echo.

:: 1. Comprobar si Node.js esta instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js no esta instalado en este equipo.
    echo.
    echo Para que este proyecto funcione, necesitas instalar Node.js.
    echo Descargalo gratuitamente desde: https://nodejs.org/
    echo.
    echo Una vez instalado, vuelve a ejecutar este archivo.
    pause
    exit /b
)

echo [OK] Node.js detectado correctamente.

:: 2. Instalar dependencias si no existen
if not exist "node_modules\" (
    echo.
    echo [INFO] Configurando el entorno por primera vez...
    echo Descargando e instalando dependencias (esto puede tardar unos minutos)...
    call npm install
    
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo [ERROR] Hubo un problema al intentar instalar las dependencias.
        echo Revisa tu conexion a internet o los permisos de la carpeta.
        pause
        exit /b
    )
    echo.
    echo [OK] Entorno configurado con exito.
) else (
    echo [OK] El entorno ya esta configurado (node_modules existe).
)

:: 3. Iniciar el servidor local
echo.
echo ===================================================
echo    Iniciando el Servidor de Desarrollo...
echo ===================================================
echo.
echo Se abrira una direccion local (ej: http://localhost:5173) 
echo Puedes presionar Ctrl+C en esta ventana para detener el servidor.
echo.

call npm run dev

pause

# Animador VRM

Estudio de animación en el navegador para modelos VRM: línea de tiempo, preajustes, seguimiento por video, efectos y exportación hasta 4K.

## Requerimientos del Sistema

Al ser un proyecto basado en **Node.js** y **Vite**, las dependencias y requerimientos técnicos se gestionan automáticamente a través del archivo `package.json` (el equivalente a `requirements.txt` en Python). 

Para ejecutar este proyecto necesitas:

- **Node.js**: Versión 18.0 o superior recomendada.
- **NPM**: Gestor de paquetes (incluido con Node.js).

## Dependencias Principales

- `three`: ^0.169.0 (Motor 3D)
- `@pixiv/three-vrm`: ^3.1.5 (Soporte para modelos VRM)
- `@pixiv/three-vrm-animation`: ^3.1.0 (Animaciones de formato VRMA)
- `@mediapipe/tasks-vision`: 0.10.14 (Seguimiento corporal y facial por cámara/video)
- `mp4-muxer`: ^5.1.2 (Exportación a MP4)

## Instalación y Ejecución

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Iniciar servidor de desarrollo:**
   ```bash
   npm run dev
   ```
   *Esto abrirá la aplicación en tu navegador local (usualmente en `http://localhost:5173`).*

3. **Compilar para producción:**
   ```bash
   npm run build
   ```
   *Los archivos compilados y listos para subir a un servidor web se generarán en la carpeta `dist/`.*

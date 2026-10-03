# Animador VRM (Experimental v a-0.0.1)

Estudio de animación 3D en el navegador para modelos **VRM**. Diseñado con un flujo de trabajo profesional estilo DaVinci Resolve / CapCut para crear animaciones fluidas, posar personajes y exportar videos hasta 4K.

## Características (Experimental v a-0.0.1)

- **Layout Profesional de 3 Paneles:** Flujo de trabajo ordenado con biblioteca/assets a la izquierda, visor 3D central y panel de propiedades a la derecha.
- **Posado 3D Directo:** Selecciona huesos directamente haciendo clic en el modelo 3D y utiliza el Gizmo visual (TransformControls) para rotarlos o moverlos.
  - `E` - Rotar hueso
  - `W` - Trasladar (Ideal para cadera/hips)
  - `R` - Alternar entre espacio local/mundo
  - `Q` - Deseleccionar
- **Línea de Tiempo Multiestado:** Sistema de _keyframes_ por interpolación para cada hueso, expresión facial, traslaciones y animaciones importadas.
- **Biblioteca de Animaciones y Poses:** Preajustes corregidos y listos para ser aplicados en la línea de tiempo. Soporte para importación de animaciones `.vrma` o `.json`.
- **Escena y Efectos:** Personaliza el fondo (Color, imagen o un modelo 3D estático), iluminación (fuerza de luz, bloom) y sistemas de partículas (nieve, lluvia, chispas).
- **Audio Integrado:** Añade pistas de sonido con control de desplazamiento temporal y visualización en tiempo real.
- **Exportación 4K:** Renderización a MP4 o WebM a frame constante para asegurar la máxima calidad (hasta 60fps) independientemente del rendimiento del navegador.
- *(En pausa)* **Seguimiento por video (Video Tracking):** Extracción de poses a partir de video mediante MediaPipe (Temporalmente oculto en esta versión experimental para priorizar la estabilidad de la UI).

## Requerimientos del Sistema

Al ser un proyecto basado en **Node.js** y **Vite**, las dependencias y requerimientos técnicos se gestionan automáticamente a través del archivo `package.json`.

Para ejecutar este proyecto necesitas:

- **Node.js**: Versión 18.0 o superior recomendada.
- **NPM**: Gestor de paquetes (incluido con Node.js).

## Dependencias Principales

- `three`: ^0.169.0 (Motor 3D)
- `@pixiv/three-vrm`: ^3.1.5 (Soporte para modelos VRM)
- `@pixiv/three-vrm-animation`: ^3.1.0 (Animaciones de formato VRMA)
- `@mediapipe/tasks-vision`: 0.10.14 (Seguimiento corporal y facial)
- `mp4-muxer`: ^5.1.2 (Exportación de video nativo MP4)

## Instalación y Ejecución

La forma más rápida de instalar todo en Windows es dar doble clic al archivo `iniciar.bat`, el cual descargará las dependencias y ejecutará el servidor automáticamente.

De forma manual por consola:

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

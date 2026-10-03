# Animador VRM (Experimental v a-0.0.1)

Estudio de animación 3D en el navegador para modelos **VRM**. Diseñado con un flujo de trabajo profesional estilo edición de video (tres paneles interactivos) para crear animaciones fluidas, posar personajes y exportar videos hasta resolución 4K.

## Características (v a-0.0.1)

- **Layout Profesional de 3 Paneles:** Flujo de trabajo ordenado con biblioteca de assets a la izquierda, visor 3D central y panel de propiedades e inspector a la derecha.
- **Posado 3D Directo en Visor:** Posibilidad de seleccionar huesos directamente haciendo clic sobre el modelo 3D y utilizar un Gizmo visual (TransformControls) para aplicar rotaciones y traslaciones.
  - `E` - Rotar hueso
  - `W` - Trasladar (Ideal para posicionar la cadera en el escenario)
  - `R` - Alternar entre espacio local y mundo
  - `Q` - Deseleccionar hueso activo
- **Biblioteca Local Integrada:** Reconocimiento de archivos guardados en las carpetas `user/` (las cuales se autogeneran al soltar archivos) o en `public/assets/`. Modelos, poses y animaciones pueden seleccionarse con un clic.
- **Línea de Tiempo Multiestado:** Sistema de *keyframes* mediante interpolación matemática para cada hueso, expresión facial, posición en escena y animaciones importadas.
- **Catálogo de Poses Base:** Preajustes corregidos matemáticamente (T-Pose a rotaciones seguras) e integrados para animaciones básicas (Sentado, Combate, Victoria, Caminar, Respiración, etc). Soporta importación y mezcla de datos en formatos `.vrma` o `.json`.
- **Motor de Escena y Efectos:** Personalización completa del fondo (color sólido, imagen estática o modelos 3D en formato GLB/GLTF/VRM), sistema de iluminación principal con "Bloom" y sistemas de partículas persistentes optimizados (Nieve, Lluvia, Burbujas, Magia, Chispas, Pétalos).
- **Exportación 4K:** Sistema de renderizado secuencial a formato MP4 (H.264+AAC) o WebM que asegura tasa de fotogramas constante sin importar el rendimiento del hardware.
- *(Nota de versión)* **Seguimiento por video (Video Tracking):** Extracción de poses a partir de video mediante MediaPipe (temporalmente oculto en esta versión experimental).

## Requisitos de Entorno

El proyecto corre de forma local a través de Vite (servidor web) y requiere Node.js para resoluciones de API y hospedaje de archivos temporales.

## Instalación Fácil (Windows)

Para los usuarios finales en Windows que no cuenten con experiencia técnica ni instaladores en su equipo, el repositorio incluye un iniciador automático de "Cero Instalación":

1. Da doble clic en el archivo `iniciar.bat`.
2. El script detectará si hace falta Node.js y las librerías. De ser así, descargará e instalará automáticamente una versión portable y privada del entorno en la propia carpeta del proyecto.
3. El navegador predeterminado se abrirá por su cuenta (usualmente en la dirección `http://localhost:5173`).

*Para cerrar el entorno, simplemente cierra la ventana de la consola (símbolo del sistema).*

## Ejecución Manual (Desarrolladores)

Si ya cuentas con un entorno Node.js y prefieres gestionar la consola manualmente:

1. Clona el repositorio e instala las dependencias:
   ```bash
   npm install
   ```

2. Arranca el servidor de desarrollo en caliente:
   ```bash
   npm run dev
   ```

3. Para preparar los archivos optimizados y estáticos en producción (si se va a subir a un servidor público):
   ```bash
   npm run build
   ```
   *Los archivos compilados listos para despliegue se generarán en el directorio `dist/`.*

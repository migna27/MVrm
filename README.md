# Animador VRM (Experimental v a-0.0.5)

Estudio de animación 3D en el navegador para modelos **VRM**. Diseñado con un flujo de trabajo profesional estilo edición de video (tres paneles interactivos) para crear animaciones fluidas, posar personajes y exportar videos hasta resolución 4K.

## Características (v a-0.0.5)

- **IA Holistic (Cuerpo y Manos):** Integración de MediaPipe Holistic desde Python. El modelo ahora es capaz de imitar no solo la postura del torso y brazos, sino la rotación de las muñecas y abrir/cerrar los puños.
- **Rastreo Mixto (Cámara o Archivo):** ¿Quieres usar tu cámara en vivo? Usa el botón nativo y transmite por OSC. ¿Tienes un video `.mp4`? Súbelo, transpórtalo a JSON mediante el motor Python, e incrústalo como un clip en tu línea de tiempo instantáneamente.

- **Receptor VMC (Nuevo):** Compatibilidad con el protocolo *Virtual Motion Capture (OSC)*. Recibe datos de rastreo en tiempo real desde apps de VTubing (VSeeFace, Waidayo, mocopi) y grábalos directamente en la línea de tiempo.
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
- **Motor de Tracking Externo (Nuevo):** Reemplazo del motor interno por un backend robusto en Python (basado en MediaPipe). Incluye suavizado matemático Savitzky-Golay y un algoritmo de Cinemática Inversa (IK) anti-colisiones para evitar que las extremidades atraviesen el torso.

## Instalación Fácil (Windows)

Para utilizar este proyecto en Windows **no necesitas instalar Node.js ni tener experiencia técnica**. El repositorio incluye un entorno portable automatizado:

1. **Clona o descarga** este repositorio en tu computadora y extrae la carpeta.
2. Da doble clic en el archivo `iniciar.bat`.
3. La primera vez, el script descargará de forma silenciosa un motor interno (Node.js portable) e instalará las librerías necesarias.
4. El navegador predeterminado se abrirá automáticamente con el estudio de animación listo para usarse.

*Para cerrar el entorno, simplemente cierra la ventana negra de la consola.*

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

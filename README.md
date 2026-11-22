# Animador VRM (v2.0.0)

Estudio cinematográfico de animación 3D en el navegador para modelos **VRM**. Diseñado con arquitectura desacoplada por eventos y flujo de trabajo profesional (Multi-VRM, importación directa de `.vmd` a keyframes editables, entornos procedurales con reflejos y agua, iluminación volumétrica, props adjuntos a huesos, lip-sync automático desde audio y exportación hasta 4K).

## Novedades en v2.0.0

- **Importador Nativo de `.vmd` Directo a Keyframes Editables:** Lectura binaria directa de archivos MikuMikuDance (`.vmd` en Shift-JIS) sin herramientas `.exe` externas:
  - Huesos del cuerpo, ojos y dedos completos con soporte de torsión/huesos semi-estándar (`腕捩`, `手捩`, `左肩P`, `腰`), auto-retarget A-Pose → T-Pose (`±30°`) y resolvedor analítico Two-Bone Foot IK opcional.
  - Expresiones faciales (`morphs`), cámara MMD (con detección de cortes por escalón) y luz direccional importadas como pistas totalmente editables en la línea de tiempo.
- **Producción Multi-VRM y Control de Escena Directo:**
  - Reparto de múltiples personajes VRM simultáneos en escena con pista aislada por personaje (`PersonajeId`), selección 3D al hacer clic en sus huesos y reasignación inteligente al cargar proyectos.
  - **Lip-Sync Automático desde Audio (`MotorLipSync`):** Análisis espectral por banco de filtros Goertzel sobre bandas formánticas F1/F2 (`aa`, `ih`, `ou`, `ee`, `oh`) con simplificación y deshacer en un clic (`Ctrl+Z`).
  - **Props 3D (`.glb`/`.gltf`) Adjuntos a Huesos + Gizmo (`W`/`E`/`S`):** Catálogo integrado y carga local de accesorios adjuntables a cualquier hueso VRM, con brillo HDR para Bloom y animaciones embebidas.
  - **Modo Cine (`Shift+F` / `Esc`):** Oculta barras y paneles al instante para previsualización a pantalla completa sin distracciones.
- **Entornos Procedurales, Post-Proceso Cine y Compatibilidad VRMLiveViewer:**
  - 5 preajustes en 1 clic (`Estudio Oscuro`, `Espacio Reflectivo`, `Noche Concierto`, `Atardecer Agua`, `Neón 5 Focos`).
  - Pisos `Reflector` y `Water` animada con normales procedurales, cielos `Sky` (Día/Atardecer/Noche), campo estelar GLSL `EspacioDinamico`, fondos equirectangulares 360° y video sincronizado, más niebla exponencial animable.
  - Compositor unificado: `BokehPass` con **Auto-Focus** (`CabezaActivo` / `MultiPersonaje`), `ShaderGradoCine` (Temperatura, Tinte, Saturación, Contraste, Viñeta coloreada y **Lens Dirt**), Bloom HDR, aberración cromática, grano y FXAA.
  - **Focos Volumétricos de Escenario (`SpotLight` / `PointLight`):** Conos Fresnel aditivos, rotación automática, seguimiento al VRM y posicionamiento directo con el Gizmo.
  - **Partículas HDR Multi-Capa (`KiraKira`, `SakuraGlow`, `Estrellas`, etc.):** Múltiples capas simultáneas anclables a huesos específicos e importador directo de `.json` (`Environment`, `PostEffect`, `CustomLight`) de *VRM Live Viewer*.

## Novedades en v1.2.1

- **Estabilidad y Fugas de Memoria:** Resolución bidireccional de expresiones VRM 0.x / 1.0 (`happy`/`joy`, `a`/`aa`, `blink`, etc.), liberación de texturas GPU, URLs `blob:`, *colliders* y esqueletos auxiliares, grabación VMC en vivo compatible con timeline en pausa e historial `Ctrl+Z`, control de *backpressure* WebCodecs y protección de bucle durante exportación WebM, validación segura en `/api/upload` y optimización del tracker MediaPipe Python.
- **Velocidad y Arquitectura:** Eliminación de código muerto (`GestorTracking`), división de paquetes en Vite (`vendor-three` y `vendor-vrm`), caché `WeakMap` entre vista previa e importación final, y caché de textos de tiempo/cuadro en el bucle principal.
- **Línea de Tiempo Más Cómoda:** Optimización de detección *hover*, deduplicación automática de claves colisionadas al soltar arrastre, auto-scroll durante arrastre o reproducción y barras de desplazamiento horizontales/verticales arrastrables dentro del lienzo.
- **Usabilidad, Flujo y Comodidad:**
  - **Autoguardado local (`ServicioAutoguardado`):** Respaldo automático con recuperación rápida de sesión (`↺ Recuperar sesión`).
  - **Tarjeta de Bienvenida y Vistas de Cámara (`1`–`4`):** Acceso en un clic al modelo de ejemplo o `.vrm` local, más preajustes instantáneos (`Frontal`, `3/4`, `Perfil`, `Rostro`).
  - **Atajos Inteligentes y Guía Accesible (`?`):** Diálogo modal nativo de atajos; teclas globales (`Espacio`, `K`, `Q/W/E/R`, `Ctrl+S`, `Ctrl+O`) sin quedar bloqueadas tras mover deslizadores (`range`).
  - **Flujo de Edición Sin Pérdidas:** Preservación de foco en `InspectorClave` al tabular/editar valores, exportación directa de poses (`.json`) con refresco automático de la biblioteca local y sincronización automática de los controles de escena/efectos al cargar proyectos.

## Características (v1.2.1)

- **Arquitectura Modular con Patrones de Diseño:**
  - **Observer (`BusEventos`) y Store Reactivo (`EstadoEstudio`):** Desacoplan el motor 3D, la línea de tiempo y los paneles mediante eventos tipados (`pistas:cambiadas`, `tiempo:cambiado`, `seleccion:cambiada`, `historial:cambiado`).
  - **Command + Composite (`HistorialComandos` y `ComandosAnimacion`):** Historial completo de Deshacer / Rehacer (`Ctrl+Z` / `Ctrl+Y`) para creación, edición, sobrescritura, movimiento, duplicación, desplazamiento, simplificación, importación y eliminación de claves o pistas.
  - **Strategy (`EstrategiasInterpolacion` y `ImportadoresAnimacion`):** Curvas de interpolación intercambiables por clave (`Suave`, `Lineal`, `EntradaSuave`, `SalidaSuave`, `Escalon`) y estrategias unificadas de importación.
- **Línea de Tiempo Optimizada de Alto Rendimiento:**
  - **Renderizado bajo demanda (*Dirty-Flag* + `requestAnimationFrame`):** El bucle principal solo solicita redibujado del timeline al reproducir o cuando ocurre una interacción real.
  - **Búsqueda Binaria `O(log K)` y Cachés:** Evaluación de pistas en `GestorAnimacion` con búferes temporales preasignados (0 GC), culling de claves visibles fuera de pantalla, caché de filas *Dope-Sheet* y caché *offscreen* de la forma de onda del audio.
  - **Controles por Capa y Pista:** Resumen interactivo *Dope-Sheet* al colapsar capas, botones rápidos de **Clave (`◆`)**, **Silenciar (`M`)** y **Bloquear (`🔒`)**, rango de bucle parcial, filtro de pistas y divisor vertical redimensionable.
- **Creación, Sobrescritura y Eliminación Ágil de Keyframes:**
  - Botones contextuales inteligentes que cambian visualmente a **Sobrescribir** cuando ya existe una clave en el cabezal actual, además de **Auto-Clave** al posar huesos o ajustar deslizadores.
  - Multiselección por caja de arrastre o `Shift+Clic`, duplicación directa con `Alt+Arrastre`, copiar/pegar/duplicar (`Ctrl+C` / `Ctrl+V` / `Ctrl+D`), doble clic sobre pista para insertar/sobrescribir, menú contextual por clic derecho y panel **Inspector de Clave** (*Master-Detail*).
- **Asistente de Importación Multi-Formato (`.vrma`, `.bvh`, `.glb`, `.gltf`, `.json`):**
  - Vista previa antes de importar, inserción en el cabezal o tiempo personalizado, modos de combinación / sobrescritura de rango / reemplazo de capa, control de velocidad y simplificación automática de curvas mediante **Ramer-Douglas-Peucker (RDP)**.
- **Interfaz de Estudio Renovada y Accesible:**
  - Tema oscuro estructurado en capas `@layer` con pestañas (`Animar`, `Escena`, `Captura` | `Pose`, `Clave`, `Rostro`), barra flotante de gizmo en el visor (`Q/W/E/R`, Esqueleto, Espejar L↔R, Reposo), diálogos modales nativos `<dialog>`, menú contextual `popover` e iconos SVG vectoriales.

- **Recuperación Suave de Extremidades (Decay):** Cuando las piernas o brazos salen del plano de la cámara (baja visibilidad), ya no se congelan en poses incómodas. El algoritmo calcula de manera predictiva su cinemática para devolverlos fluidamente a una pose de reposo natural utilizando filtros de inercia cuaterniónica.
- **Cinemática Inversa y Directa (Local Rotations):** El motor matemático ahora calcula la rotación relativa de cada hueso respecto a su hueso padre (inv(parent) * child), solucionando deformaciones de muñecas y codos rotos al interpretar correctamente la jerarquía ósea del VRM.
- **Motor de Tracking Optimizado:** Eliminación de modelos redundantes o inestables (RTMPose, MDM), dejando exclusivamente a MediaPipe Holistic local por su velocidad y robustez.
- **Corrección de Tracking con IA (Filtro EMA y Visibilidad):** Algoritmos avanzados de estabilización de postura y descarte inteligente de extremidades ocultas. ¡Lo que no se ve no se trackea, evitando roturas articulares!
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

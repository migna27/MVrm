// ============================================================================
// GestorEscena.ts — Etapa 1: Escena 3D, cámara, luces, fondo y post-proceso
// Administra el render en tiempo real (previa optimizada) y el render fijo
// de alta resolución usado durante la exportación.
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';
import { FilmShader } from 'three/examples/jsm/shaders/FilmShader.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { Limitar } from '../Utilidades';
import { ModoSeguimientoCamara } from '../Tipos';
import type { GestorModelos } from './GestorModelos';

export class GestorEscena {
  public Renderer!: THREE.WebGLRenderer;
  public Escena!: THREE.Scene;
  public Camara!: THREE.PerspectiveCamera;
  public Controles!: OrbitControls;
  public ControlTransformacion!: TransformControls;

  private Compositor: EffectComposer | null = null;
  private PaseBloom: UnrealBloomPass | null = null;
  private PaseRGB!: ShaderPass;
  private PaseRuido!: ShaderPass;
  private PaseVigneta!: ShaderPass;
  
  private Contenedor!: HTMLElement;

  public LuzDireccional!: THREE.DirectionalLight;
  public LuzAmbiental!: THREE.AmbientLight;
  public LuzPersonaje!: THREE.DirectionalLight;
  public LuzPersonajeActiva = true;
  public IntensidadLuzPersonaje = 0.75;
  private Rejilla!: THREE.GridHelper;

  public RollCamara = 0;
  public SeguimientoCamara: ModoSeguimientoCamara = 'Ninguno';
  public VibracionCamara = 0;
  private readonly _TargetSeguimiento = new THREE.Vector3();
  private _TiempoCamara = 0;

  public ModeloFondo: THREE.Object3D | null = null;
  private TexturaFondo: THREE.Texture | null = null;
  private UrlFondoBlob: string | null = null;

  public BloomActivo = false;
  public BloomFuerza = 0.55;
  public EscalaPrevia = 0.75; // Escala de resolución de la previa en tiempo real
  
  public AberracionCromaticaActiva = false;
  public RuidoActivo = false;
  public VignetaActiva = false;

  /** Inicializa el renderer, la cámara, las luces y la rejilla de referencia. */
  public Inicializar(Contenedor: HTMLElement): void {
    this.Contenedor = Contenedor;

    // Renderer WebGL con conservación del búfer para captura de cuadros
    this.Renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.Renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.Renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.Renderer.toneMappingExposure = 1.0;
    this.Renderer.shadowMap.enabled = true;
    this.Renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Contenedor.appendChild(this.Renderer.domElement);

    // Escena y fondo neutro
    this.Escena = new THREE.Scene();
    this.Escena.background = new THREE.Color('#1b1e26');

    // Cámara frontal: los modelos VRM miran hacia +Z
    this.Camara = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.Camara.position.set(0, 1.35, 3.4);

    // Controles orbitales para inspeccionar la escena
    this.Controles = new OrbitControls(this.Camara, this.Renderer.domElement);
    this.Controles.target.set(0, 1.0, 0);
    this.Controles.enableDamping = true;
    this.Controles.dampingFactor = 0.08;
    this.Controles.maxDistance = 25;

    // Control de transformación para manipular huesos directamente
    this.ControlTransformacion = new TransformControls(this.Camara, this.Renderer.domElement);
    this.ControlTransformacion.setMode('rotate');
    this.ControlTransformacion.setSpace('local');
    this.ControlTransformacion.addEventListener('dragging-changed', (E) => {
      this.Controles.enabled = !E.value;
    });
    this.Escena.add(this.ControlTransformacion.getHelper());

    // Iluminación principal tipo estudio
    this.LuzDireccional = new THREE.DirectionalLight(0xffffff, 2.2);
    this.LuzDireccional.position.set(1.5, 3.2, 2.4);
    this.LuzDireccional.castShadow = true;
    this.LuzDireccional.shadow.mapSize.set(1024, 1024);
    this.LuzDireccional.shadow.camera.left = -4;
    this.LuzDireccional.shadow.camera.right = 4;
    this.LuzDireccional.shadow.camera.top = 4;
    this.LuzDireccional.shadow.camera.bottom = -4;
    this.Escena.add(this.LuzDireccional);
    this.Escena.add(this.LuzDireccional.target);

    this.LuzAmbiental = new THREE.AmbientLight(0xbfd0ff, 0.85);
    this.Escena.add(this.LuzAmbiental);

    const LuzRelleno = new THREE.DirectionalLight(0x88aaff, 0.5);
    LuzRelleno.position.set(-2.5, 1.5, -1.5);
    this.Escena.add(LuzRelleno);

    // Luz dedicada suave para mantener rostro y silueta del personaje legibles en escenarios oscuros
    this.LuzPersonaje = new THREE.DirectionalLight(0xffffff, this.IntensidadLuzPersonaje);
    this.LuzPersonaje.position.set(0.8, 2.2, 2.6);
    this.LuzPersonaje.castShadow = false;
    this.Escena.add(this.LuzPersonaje);

    // Rejilla de piso como referencia espacial
    this.Rejilla = new THREE.GridHelper(20, 40, 0x3a4152, 0x272b36);
    this.Escena.add(this.Rejilla);

    // Piso invisible que solo recibe sombras
    const Piso = new THREE.Mesh(
      new THREE.CircleGeometry(12, 48).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    Piso.receiveShadow = true;
    Piso.position.y = -0.001;
    this.Escena.add(Piso);

    // Compositor de post-procesado
    this.Compositor = new EffectComposer(this.Renderer);
    this.Compositor.addPass(new RenderPass(this.Escena, this.Camara));
    
    this.PaseBloom = new UnrealBloomPass(new THREE.Vector2(1, 1), this.BloomFuerza, 0.6, 0.85);
    this.Compositor.addPass(this.PaseBloom);

    this.PaseRGB = new ShaderPass(RGBShiftShader);
    this.PaseRGB.uniforms['amount'].value = 0.0025;
    this.Compositor.addPass(this.PaseRGB);

    this.PaseRuido = new ShaderPass(FilmShader);
    this.PaseRuido.uniforms['intensity'].value = 0.35;
    this.PaseRuido.uniforms['grayscale'].value = false;
    this.Compositor.addPass(this.PaseRuido);

    this.PaseVigneta = new ShaderPass(VignetteShader);
    this.PaseVigneta.uniforms['offset'].value = 1.0;
    this.PaseVigneta.uniforms['darkness'].value = 1.2;
    this.Compositor.addPass(this.PaseVigneta);

    this.Compositor.addPass(new OutputPass());

    window.addEventListener('resize', () => this.Redimensionar());
    this.Redimensionar();
  }

  /** Ajusta el tamaño del lienzo al contenedor aplicando la escala de previa. */
  public Redimensionar(): void {
    const Ancho = this.Contenedor.clientWidth || 1;
    const Alto = this.Contenedor.clientHeight || 1;
    const RelacionPixeles = Limitar(window.devicePixelRatio || 1, 0.5, 2) * this.EscalaPrevia;
    this.Renderer.setPixelRatio(RelacionPixeles);
    this.Renderer.setSize(Ancho, Alto);
    if (this.Compositor) {
      this.Compositor.setPixelRatio(RelacionPixeles);
      this.Compositor.setSize(Ancho, Alto);
    }
    this.Camara.aspect = Ancho / Alto;
    this.Camara.updateProjectionMatrix();
  }

  /** Cambia la escala de resolución de la previa (optimización en tiempo real). */
  public EstablecerEscalaPrevia(Escala: number): void {
    this.EscalaPrevia = Escala;
    this.Redimensionar();
  }

  /** Fija un tamaño exacto del lienzo para el render de exportación. */
  public EstablecerTamanoExportacion(Ancho: number, Alto: number): void {
    this.Renderer.setPixelRatio(1);
    this.Renderer.setSize(Ancho, Alto, false);
    if (this.Compositor) {
      this.Compositor.setPixelRatio(1);
      this.Compositor.setSize(Ancho, Alto);
    }
    this.Camara.aspect = Ancho / Alto;
    this.Camara.updateProjectionMatrix();
  }

  /** Fija la inclinación lateral (Roll) de cámara en radianes. */
  public EstablecerRollCamara(Radianes: number): void {
    this.RollCamara = Number.isFinite(Radianes) ? Radianes : 0;
  }

  /** Actualiza Auto-Follow y vibración suave de cámara sobre el personaje activo. */
  public ActualizarCamaraDinamica(Delta: number, Modelos?: GestorModelos): void {
    this._TiempoCamara += Delta;
    if (this.SeguimientoCamara !== 'Ninguno' && Modelos) {
      const Hueso = this.SeguimientoCamara === 'Cabeza' ? 'head' : 'chest';
      const Pos = Modelos.ObtenerPosicionMundoHueso(Hueso, Modelos.PersonajeActivoId, this._TargetSeguimiento);
      if (Pos) {
        const Factor = 1 - Math.exp(-Math.max(0.1, Delta) * 7.0);
        this.Controles.target.lerp(Pos, Factor);
      }
    }
  }

  /** Controla la luz dedicada al personaje (independiente de la escena oscura). */
  public EstablecerLuzPersonaje(Activa: boolean, Intensidad?: number, ColorHex?: string): void {
    this.LuzPersonajeActiva = Activa;
    if (Intensidad !== undefined) this.IntensidadLuzPersonaje = Intensidad;
    if (this.LuzPersonaje) {
      this.LuzPersonaje.visible = Activa;
      this.LuzPersonaje.intensity = Activa ? this.IntensidadLuzPersonaje : 0;
      if (ColorHex) this.LuzPersonaje.color.set(ColorHex);
    }
  }

  /** Renderiza un cuadro: usa el compositor si algún efecto está activo. */
  public Renderizar(): void {
    this.Controles.update();
    if (Math.abs(this.RollCamara) > 1e-5) {
      this.Camara.rotateZ(this.RollCamara);
    }
    if (this.VibracionCamara > 0.0005) {
      const T = this._TiempoCamara;
      const Amp = this.VibracionCamara * 0.02;
      this.Camara.rotateX(Math.sin(T * 11.3) * Amp * 0.5);
      this.Camara.rotateY(Math.cos(T * 8.7) * Amp * 0.6);
      this.Camara.rotateZ(Math.sin(T * 14.1) * Amp);
    }
    const UsarCompositor = this.BloomActivo || this.AberracionCromaticaActiva || this.RuidoActivo || this.VignetaActiva;

    if (UsarCompositor && this.Compositor) {
      if (this.PaseBloom) {
        this.PaseBloom.enabled = this.BloomActivo;
        this.PaseBloom.strength = this.BloomFuerza;
      }
      if (this.PaseRGB) this.PaseRGB.enabled = this.AberracionCromaticaActiva;
      if (this.PaseRuido) {
        this.PaseRuido.enabled = this.RuidoActivo;
        // Semilla por cuadro (determinista para que la exportación sea reproducible)
        this.PaseRuido.uniforms['time'].value = (this.PaseRuido.uniforms['time'].value + 0.137) % 1000;
      }
      if (this.PaseVigneta) this.PaseVigneta.enabled = this.VignetaActiva;
      
      this.Compositor.render();
    } else {
      this.Renderer.render(this.Escena, this.Camara);
    }
  }

  /** Activa o desactiva la aberración cromática. */
  public EstablecerAberracionCromatica(Activa: boolean, Cantidad?: number): void {
    this.AberracionCromaticaActiva = Activa;
    if (Cantidad !== undefined && this.PaseRGB) this.PaseRGB.uniforms['amount'].value = Cantidad;
  }

  /** Activa o desactiva el ruido de película. */
  public EstablecerRuido(Activo: boolean, Intensidad?: number): void {
    this.RuidoActivo = Activo;
    if (Intensidad !== undefined && this.PaseRuido) this.PaseRuido.uniforms['intensity'].value = Intensidad;
  }

  /** Activa o desactiva la viñeta oscura. */
  public EstablecerVigneta(Activa: boolean, Oscuridad?: number, Desplazamiento?: number): void {
    this.VignetaActiva = Activa;
    if (this.PaseVigneta) {
      if (Oscuridad !== undefined) this.PaseVigneta.uniforms['darkness'].value = Oscuridad;
      if (Desplazamiento !== undefined) this.PaseVigneta.uniforms['offset'].value = Desplazamiento;
    }
  }

  private LimpiarFondoAnterior(): void {
    if (this.TexturaFondo) {
      this.TexturaFondo.dispose();
      this.TexturaFondo = null;
    }
    if (this.UrlFondoBlob && this.UrlFondoBlob.startsWith('blob:')) {
      URL.revokeObjectURL(this.UrlFondoBlob);
      this.UrlFondoBlob = null;
    }
  }

  /** Fondo con color sólido. */
  public EstablecerFondoColor(Hex: string): void {
    this.LimpiarFondoAnterior();
    this.Escena.background = new THREE.Color(Hex);
  }

  /** Fondo con una imagen cargada desde un archivo local. */
  public EstablecerFondoImagen(Url: string): void {
    this.LimpiarFondoAnterior();
    if (Url.startsWith('blob:')) {
      this.UrlFondoBlob = Url;
    }
    new THREE.TextureLoader().load(Url, (Textura) => {
      Textura.colorSpace = THREE.SRGBColorSpace;
      this.TexturaFondo = Textura;
      this.Escena.background = Textura;
    });
  }

  /** Agrega un modelo (GLB/GLTF/VRM) como elemento de fondo de la escena. */
  public EstablecerModeloFondo(Objeto: THREE.Object3D): void {
    this.QuitarModeloFondo();
    this.ModeloFondo = Objeto;
    Objeto.traverse((Nodo) => {
      const Malla = Nodo as THREE.Mesh;
      if (Malla.isMesh) { Malla.receiveShadow = true; Malla.castShadow = false; }
    });
    this.Escena.add(Objeto);
  }

  /** Retira el modelo de fondo actual, liberando su geometría y materiales GPU. */
  public QuitarModeloFondo(): void {
    if (this.ModeloFondo) {
      this.ModeloFondo.traverse((Nodo) => {
        const Malla = Nodo as THREE.Mesh;
        if (Malla.geometry) Malla.geometry.dispose();
        if (Malla.material) {
          if (Array.isArray(Malla.material)) {
            Malla.material.forEach((Mat) => Mat.dispose());
          } else {
            Malla.material.dispose();
          }
        }
      });
      this.Escena.remove(this.ModeloFondo);
      this.ModeloFondo = null;
    }
  }

  /** Encuadra la cámara rápidamente en una vista preestablecida del estudio. */
  public EnfocarVistaPreajuste(Vista: 'frontal' | 'perfil' | 'tresCuartos' | 'rostro'): void {
    switch (Vista) {
      case 'frontal':
        this.Camara.position.set(0, 1.35, 3.4);
        this.Controles.target.set(0, 1.0, 0);
        break;
      case 'perfil':
        this.Camara.position.set(3.2, 1.3, 0.2);
        this.Controles.target.set(0, 1.0, 0);
        break;
      case 'tresCuartos':
        this.Camara.position.set(2.1, 1.45, 2.6);
        this.Controles.target.set(0, 1.0, 0);
        break;
      case 'rostro':
        this.Camara.position.set(0, 1.48, 1.15);
        this.Controles.target.set(0, 1.42, 0);
        break;
    }
    this.Controles.update();
  }

  /** Activa o desactiva el efecto de brillo (bloom). */
  public EstablecerBloom(Activo: boolean, Fuerza?: number, Radio?: number, Umbral?: number): void {
    this.BloomActivo = Activo;
    if (Fuerza !== undefined) this.BloomFuerza = Fuerza;
    if (this.PaseBloom) {
      if (Radio !== undefined) this.PaseBloom.radius = Radio;
      if (Umbral !== undefined) this.PaseBloom.threshold = Umbral;
    }
  }

  /** Exposición general (Tonemapping) */
  public EstablecerExposicion(Valor: number): void {
    this.Renderer.toneMappingExposure = Valor;
  }

  /** Intensidad y color de la luz direccional principal. */
  public EstablecerLuzDireccional(Intensidad: number, ColorHex?: string): void {
    this.LuzDireccional.intensity = Intensidad;
    if (ColorHex) this.LuzDireccional.color.set(ColorHex);
  }

  /** Intensidad y color de la luz ambiental. */
  public EstablecerLuzAmbiental(Intensidad: number, ColorHex?: string): void {
    this.LuzAmbiental.intensity = Intensidad;
    if (ColorHex) this.LuzAmbiental.color.set(ColorHex);
  }

  /** Muestra u oculta la rejilla de referencia. */
  public AlternarRejilla(Visible: boolean): void {
    this.Rejilla.visible = Visible;
  }

  /** Lienzo del renderer (para captura de cuadros en la exportación). */
  public ObtenerLienzo(): HTMLCanvasElement {
    return this.Renderer.domElement;
  }
}

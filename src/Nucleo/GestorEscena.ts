// ============================================================================
// GestorEscena.ts — Etapa 1: Escena 3D, cámara, luces, fondo y post-proceso
// Administra el render en tiempo real (previa optimizada) y el render fijo
// de alta resolución usado durante la exportación.
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Limitar } from '../Utilidades';

export class GestorEscena {
  public Renderer!: THREE.WebGLRenderer;
  public Escena!: THREE.Scene;
  public Camara!: THREE.PerspectiveCamera;
  public Controles!: OrbitControls;

  private Compositor: EffectComposer | null = null;
  private PaseBloom: UnrealBloomPass | null = null;
  private Contenedor!: HTMLElement;

  private LuzDireccional!: THREE.DirectionalLight;
  private LuzAmbiental!: THREE.AmbientLight;
  private Rejilla!: THREE.GridHelper;

  public ModeloFondo: THREE.Object3D | null = null;
  private TexturaFondo: THREE.Texture | null = null;

  public BloomActivo = false;
  public BloomFuerza = 0.55;
  public EscalaPrevia = 0.75; // Escala de resolución de la previa en tiempo real

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

    // Compositor con pase de bloom (brillo) opcional
    this.Compositor = new EffectComposer(this.Renderer);
    this.Compositor.addPass(new RenderPass(this.Escena, this.Camara));
    this.PaseBloom = new UnrealBloomPass(new THREE.Vector2(1, 1), this.BloomFuerza, 0.6, 0.85);
    this.Compositor.addPass(this.PaseBloom);
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
    this.Compositor?.setSize(Ancho * RelacionPixeles, Alto * RelacionPixeles);
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
    this.Compositor?.setSize(Ancho, Alto);
    this.Camara.aspect = Ancho / Alto;
    this.Camara.updateProjectionMatrix();
  }

  /** Renderiza un cuadro: usa el compositor solo si el bloom está activo. */
  public Renderizar(): void {
    this.Controles.update();
    if (this.BloomActivo && this.Compositor) {
      this.PaseBloom!.strength = this.BloomFuerza;
      this.Compositor.render();
    } else {
      this.Renderer.render(this.Escena, this.Camara);
    }
  }

  /** Fondo con color sólido. */
  public EstablecerFondoColor(Hex: string): void {
    this.TexturaFondo = null;
    this.Escena.background = new THREE.Color(Hex);
  }

  /** Fondo con una imagen cargada desde un archivo local. */
  public EstablecerFondoImagen(Url: string): void {
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

  /** Retira el modelo de fondo actual, si existe. */
  public QuitarModeloFondo(): void {
    if (this.ModeloFondo) {
      this.Escena.remove(this.ModeloFondo);
      this.ModeloFondo = null;
    }
  }

  /** Activa o desactiva el efecto de brillo (bloom). */
  public EstablecerBloom(Activo: boolean, Fuerza?: number): void {
    this.BloomActivo = Activo;
    if (Fuerza !== undefined) this.BloomFuerza = Fuerza;
  }

  /** Intensidad de la luz principal. */
  public EstablecerIntensidadLuz(Valor: number): void {
    this.LuzDireccional.intensity = Valor;
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

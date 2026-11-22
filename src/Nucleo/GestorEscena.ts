// ============================================================================
// GestorEscena.ts — Escena 3D, cámara con Roll/Auto-Follow, iluminación de
// escenario volumétrica y post-proceso cinematográfico (DoF Auto-Focus,
// Bloom, Color Grading, Viñeta, Lens Dirt, Ruido, Aberración, FXAA).
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';
import { FilmShader } from 'three/examples/jsm/shaders/FilmShader.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { Limitar, GenerarId } from '../Utilidades';
import {
  ConfiguracionLuzEscenario, ConfiguracionPostProceso,
  ModoAutoFocus, ModoSeguimientoCamara
} from '../Tipos';
import type { GestorModelos } from './GestorModelos';

// ----------------------------------------------------------------------------
// Shader cinematográfico unificado: Color Grading + Viñeta Coloreada + Lens Dirt
// ----------------------------------------------------------------------------

const ShaderGradoCine = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDirt: { value: null as THREE.Texture | null },
    uHasDirt: { value: 0.0 },
    uDirtIntensity: { value: 0.35 },
    uColorGradingActive: { value: 0.0 },
    uTemperature: { value: 0.0 },
    uTint: { value: 0.0 },
    uSaturation: { value: 0.0 },
    uContrast: { value: 0.0 },
    uVignetteActive: { value: 0.0 },
    uVignetteColor: { value: new THREE.Color('#000000') },
    uVignetteIntensity: { value: 0.35 },
    uVignetteSmoothness: { value: 0.5 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDirt;
    uniform float uHasDirt;
    uniform float uDirtIntensity;
    uniform float uColorGradingActive;
    uniform float uTemperature;
    uniform float uTint;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignetteActive;
    uniform vec3 uVignetteColor;
    uniform float uVignetteIntensity;
    uniform float uVignetteSmoothness;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = texel.rgb;

      if (uHasDirt > 0.5 && uDirtIntensity > 0.001) {
        vec3 dirt = texture2D(tDirt, vUv).rgb;
        float lumBlur = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float bright = smoothstep(0.45, 1.25, lumBlur);
        col += dirt * uDirtIntensity * (0.25 + 0.9 * bright);
      }

      if (uColorGradingActive > 0.5) {
        col.r += uTemperature * 0.14;
        col.b -= uTemperature * 0.14;
        col.g += uTint * 0.12;
        col.r -= uTint * 0.06;
        col.b -= uTint * 0.06;

        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(lum), col, clamp(1.0 + uSaturation, 0.0, 2.5));
        col = (col - 0.5) * clamp(1.0 + uContrast, 0.2, 2.5) + 0.5;
      }

      if (uVignetteActive > 0.5 && uVignetteIntensity > 0.001) {
        vec2 dist = (vUv - 0.5) * 1.4142;
        float r = length(dist);
        float inner = clamp(1.0 - clamp(uVignetteIntensity, 0.0, 1.5) * 0.75, 0.05, 0.95);
        float vig = smoothstep(inner, inner + max(0.08, uVignetteSmoothness), r);
        col = mix(col, uVignetteColor, clamp(vig * uVignetteIntensity * 0.85, 0.0, 1.0));
      }

      gl_FragColor = vec4(max(col, 0.0), texel.a);
    }
  `
};

// Shader aditivo Fresnel suave para conos volumétricos de foco de escenario
function CrearMaterialHazVolumetrico(ColorHex: string, Opacidad: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(ColorHex) },
      uOpacity: { value: Opacidad }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        // vUv.y = 1 cerca del origen del foco, 0 en la base lejana del cono
        float axial = smoothstep(0.0, 0.95, vUv.y) * pow(vUv.y, 0.75);
        float fresnel = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 1.35);
        float alpha = axial * fresnel * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
}

export interface InstanciaLuzEscenario {
  Config: ConfiguracionLuzEscenario;
  Luz: THREE.SpotLight | THREE.PointLight;
  Objetivo: THREE.Object3D;
  HazVolumetrico: THREE.Mesh | null;
  MaterialHaz: THREE.ShaderMaterial | null;
}

export class GestorEscena {
  public Renderer!: THREE.WebGLRenderer;
  public Escena!: THREE.Scene;
  public Camara!: THREE.PerspectiveCamera;
  public Controles!: OrbitControls;
  public ControlTransformacion!: TransformControls;

  private Compositor: EffectComposer | null = null;
  private PaseBokeh: BokehPass | null = null;
  private PaseBloom: UnrealBloomPass | null = null;
  private PaseGradoCine!: ShaderPass;
  private PaseRGB!: ShaderPass;
  private PaseRuido!: ShaderPass;
  private PaseFXAA!: ShaderPass;

  private Contenedor!: HTMLElement;

  public LuzDireccional!: THREE.DirectionalLight;
  public LuzAmbiental!: THREE.AmbientLight;
  public LuzPersonaje!: THREE.DirectionalLight;
  public LuzPersonajeActiva = true;
  public IntensidadLuzPersonaje = 0.75;
  public LucesEscenario: InstanciaLuzEscenario[] = [];

  private Rejilla!: THREE.GridHelper;
  private PisoSombra!: THREE.Mesh;
  private GeometriaHazBase: THREE.BufferGeometry | null = null;

  public RollCamara = 0;
  public SeguimientoCamara: ModoSeguimientoCamara = 'Ninguno';
  public VibracionCamara = 0;
  private readonly _TargetSeguimiento = new THREE.Vector3();
  private readonly _PosTempA = new THREE.Vector3();
  private readonly _PosTempB = new THREE.Vector3();
  private readonly _DirCamara = new THREE.Vector3();
  private _TiempoCamara = 0;

  public ModeloFondo: THREE.Object3D | null = null;
  private TexturaFondo: THREE.Texture | null = null;
  private UrlFondoBlob: string | null = null;
  private TexturaDirt: THREE.Texture | null = null;
  private UrlDirtBlob: string | null = null;

  // Parámetros de post-procesado
  public EscalaPrevia = 0.75;
  public DofActivo = false;
  public DofModoAutoFocus: ModoAutoFocus = 'CabezaActivo';
  public DofDistancia = 2.4;
  public DofOffset = 0.0;
  public DofApertura = 1.6;
  public DofMaxBlur = 0.012;
  public VelocidadAutoFocus = 12;

  public BloomActivo = false;
  public BloomFuerza = 0.55;
  public BloomRadio = 0.6;
  public BloomUmbral = 0.85;

  public LensDirtActivo = false;
  public LensDirtTextura = '';
  public LensDirtIntensidad = 0.35;

  public ColorGradingActivo = false;
  public Temperatura = 0.0;
  public Tinte = 0.0;
  public Saturacion = 0.0;
  public Contraste = 0.0;

  public VignetaActiva = false;
  public VignetaColor = '#000000';
  public VignetaOscuridad = 0.45;
  public VignetaSuavizado = 0.5;

  public AberracionCromaticaActiva = false;
  public AberracionCantidad = 0.0025;
  public RuidoActivo = false;
  public RuidoIntensidad = 0.35;
  public FxaaActivo = false;

  /** Inicializa el renderer, cámara, luces, compositor cinematográfico y rejilla. */
  public Inicializar(Contenedor: HTMLElement): void {
    this.Contenedor = Contenedor;

    this.Renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.Renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.Renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.Renderer.toneMappingExposure = 1.0;
    this.Renderer.shadowMap.enabled = true;
    this.Renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Contenedor.appendChild(this.Renderer.domElement);

    this.Escena = new THREE.Scene();
    this.Escena.background = new THREE.Color('#1b1e26');

    // Cámara frontal: los modelos VRM miran hacia +Z
    this.Camara = new THREE.PerspectiveCamera(32, 1, 0.05, 220);
    this.Camara.position.set(0, 1.35, 3.4);

    this.Controles = new OrbitControls(this.Camara, this.Renderer.domElement);
    this.Controles.target.set(0, 1.0, 0);
    this.Controles.enableDamping = true;
    this.Controles.dampingFactor = 0.08;
    this.Controles.maxDistance = 40;

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

    this.LuzPersonaje = new THREE.DirectionalLight(0xffffff, this.IntensidadLuzPersonaje);
    this.LuzPersonaje.position.set(0.8, 2.2, 2.6);
    this.LuzPersonaje.castShadow = false;
    this.Escena.add(this.LuzPersonaje);

    // Rejilla de piso como referencia espacial
    this.Rejilla = new THREE.GridHelper(20, 40, 0x3a4152, 0x272b36);
    this.Escena.add(this.Rejilla);

    // Piso receptor de sombras invisible
    this.PisoSombra = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    this.PisoSombra.receiveShadow = true;
    this.PisoSombra.position.y = 0.002;
    this.Escena.add(this.PisoSombra);

    // Pipeline de post-procesado
    this.Compositor = new EffectComposer(this.Renderer);
    this.Compositor.addPass(new RenderPass(this.Escena, this.Camara));

    this.PaseBokeh = new BokehPass(this.Escena, this.Camara, {
      focus: this.DofDistancia,
      aperture: this.DofApertura * 0.00012,
      maxblur: this.DofMaxBlur
    });
    this.PaseBokeh.enabled = false;
    this.Compositor.addPass(this.PaseBokeh);

    this.PaseBloom = new UnrealBloomPass(new THREE.Vector2(1, 1), this.BloomFuerza, this.BloomRadio, this.BloomUmbral);
    this.PaseBloom.enabled = false;
    this.Compositor.addPass(this.PaseBloom);

    this.PaseGradoCine = new ShaderPass(ShaderGradoCine);
    this.PaseGradoCine.enabled = false;
    this.Compositor.addPass(this.PaseGradoCine);

    this.PaseRGB = new ShaderPass(RGBShiftShader);
    this.PaseRGB.uniforms['amount'].value = this.AberracionCantidad;
    this.PaseRGB.enabled = false;
    this.Compositor.addPass(this.PaseRGB);

    this.PaseRuido = new ShaderPass(FilmShader);
    this.PaseRuido.uniforms['intensity'].value = this.RuidoIntensidad;
    this.PaseRuido.uniforms['grayscale'].value = false;
    this.PaseRuido.enabled = false;
    this.Compositor.addPass(this.PaseRuido);

    this.PaseFXAA = new ShaderPass(FXAAShader);
    this.PaseFXAA.enabled = false;
    this.Compositor.addPass(this.PaseFXAA);

    this.Compositor.addPass(new OutputPass());

    window.addEventListener('resize', () => this.Redimensionar());
    this.Redimensionar();
  }

  /** Ajusta el tamaño del lienzo aplicando la escala de previa. */
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
    this.ActualizarResolucionFXAA(Ancho * RelacionPixeles, Alto * RelacionPixeles);
    this.Camara.aspect = Ancho / Alto;
    this.Camara.updateProjectionMatrix();
  }

  public EstablecerEscalaPrevia(Escala: number): void {
    this.EscalaPrevia = Escala;
    this.Redimensionar();
  }

  public EstablecerTamanoExportacion(Ancho: number, Alto: number): void {
    this.Renderer.setPixelRatio(1);
    this.Renderer.setSize(Ancho, Alto, false);
    if (this.Compositor) {
      this.Compositor.setPixelRatio(1);
      this.Compositor.setSize(Ancho, Alto);
    }
    this.ActualizarResolucionFXAA(Ancho, Alto);
    this.Camara.aspect = Ancho / Alto;
    this.Camara.updateProjectionMatrix();
  }

  private ActualizarResolucionFXAA(PixAncho: number, PixAlto: number): void {
    if (this.PaseFXAA?.uniforms['resolution']) {
      this.PaseFXAA.uniforms['resolution'].value.set(1 / Math.max(1, PixAncho), 1 / Math.max(1, PixAlto));
    }
  }

  public EstablecerRollCamara(Radianes: number): void {
    this.RollCamara = Number.isFinite(Radianes) ? Radianes : 0;
  }

  /** Actualiza Auto-Follow de cámara, Auto-Focus DoF y focos dinámicos de escenario. */
  public ActualizarCamaraDinamica(Delta: number, Modelos?: GestorModelos): void {
    this._TiempoCamara += Delta;

    // 1. Auto-Follow de objetivo de cámara
    if (this.SeguimientoCamara !== 'Ninguno' && Modelos) {
      const Hueso = this.SeguimientoCamara === 'Cabeza' ? 'head' : 'chest';
      const Pos = Modelos.ObtenerPosicionMundoHueso(Hueso, Modelos.PersonajeActivoId, this._TargetSeguimiento);
      if (Pos) {
        const Factor = 1 - Math.exp(-Math.max(0.05, Delta) * 7.0);
        this.Controles.target.lerp(Pos, Factor);
      }
    }

    // 2. DoF Auto-Focus hacia cabeza del personaje activo o más cercano al centro
    if (this.DofActivo && this.DofModoAutoFocus !== 'Manual' && Modelos && Modelos.Personajes.length > 0) {
      let MejorDist = this.DofDistancia;
      if (this.DofModoAutoFocus === 'CabezaActivo') {
        const Pos = Modelos.ObtenerPosicionMundoHueso('head', Modelos.PersonajeActivoId, this._PosTempA);
        if (Pos) MejorDist = this.Camara.position.distanceTo(Pos) + this.DofOffset;
      } else {
        this.Camara.getWorldDirection(this._DirCamara);
        let MejorScore = Infinity;
        for (const P of Modelos.Personajes) {
          const Pos = Modelos.ObtenerPosicionMundoHueso('head', P.Id, this._PosTempA);
          if (!Pos) continue;
          const Vec = this._PosTempB.copy(Pos).sub(this.Camara.position);
          const Dist = Vec.length();
          if (Dist < 0.05) continue;
          Vec.divideScalar(Dist);
          const Angulo = Math.acos(Limitar(Vec.dot(this._DirCamara), -1, 1));
          const Score = Angulo * 3.0 + Dist * 0.12;
          if (Score < MejorScore) {
            MejorScore = Score;
            MejorDist = Dist + this.DofOffset;
          }
        }
      }
      const Suavizado = 1 - Math.exp(-Math.max(0.1, Delta) * this.VelocidadAutoFocus);
      this.DofDistancia = this.DofDistancia + (Limitar(MejorDist, 0.2, 60) - this.DofDistancia) * Suavizado;
    }

    // 3. Focos dinámicos de escenario (Auto-rotar / Follow / Alinear haz volumétrico)
    for (const Item of this.LucesEscenario) {
      if (!Item.Config.Activa) continue;

      if (this.ControlTransformacion.object === Item.Luz) {
        Item.Config.Posicion = [Item.Luz.position.x, Item.Luz.position.y, Item.Luz.position.z];
      }

      if (Item.Config.AutoRotarVelocidad && Math.abs(Item.Config.AutoRotarVelocidad) > 1e-4) {
        const Ang = Item.Config.AutoRotarVelocidad * Delta;
        const Cos = Math.cos(Ang);
        const Sin = Math.sin(Ang);
        const Ox = Item.Luz.position.x;
        const Oz = Item.Luz.position.z;
        Item.Luz.position.x = Ox * Cos - Oz * Sin;
        Item.Luz.position.z = Ox * Sin + Oz * Cos;
        Item.Config.Posicion = [Item.Luz.position.x, Item.Luz.position.y, Item.Luz.position.z];
      }

      if (Item.Config.SeguirPersonaje && Modelos?.Vrm) {
        const Pos = Modelos.ObtenerPosicionMundoHueso('chest', Modelos.PersonajeActivoId, this._PosTempA);
        if (Pos) {
          Item.Objetivo.position.copy(Pos);
          Item.Config.Objetivo = [Pos.x, Pos.y, Pos.z];
        }
      }

      this.SincronizarHazSpotlight(Item);
    }
  }

  public EstablecerLuzPersonaje(Activa: boolean, Intensidad?: number, ColorHex?: string): void {
    this.LuzPersonajeActiva = Activa;
    if (Intensidad !== undefined) this.IntensidadLuzPersonaje = Intensidad;
    if (this.LuzPersonaje) {
      this.LuzPersonaje.visible = Activa;
      this.LuzPersonaje.intensity = Activa ? this.IntensidadLuzPersonaje : 0;
      if (ColorHex) this.LuzPersonaje.color.set(ColorHex);
    }
  }

  /** Renderiza un cuadro usando Composer cinematográfico si algún efecto está encendido. */
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

    const GradoCineActivo =
      this.ColorGradingActivo ||
      this.VignetaActiva ||
      (this.LensDirtActivo && Boolean(this.TexturaDirt));

    const UsarCompositor =
      this.DofActivo ||
      this.BloomActivo ||
      GradoCineActivo ||
      this.AberracionCromaticaActiva ||
      this.RuidoActivo ||
      this.FxaaActivo;

    if (UsarCompositor && this.Compositor) {
      if (this.PaseBokeh) {
        this.PaseBokeh.enabled = this.DofActivo;
        if (this.DofActivo) {
          const U = this.PaseBokeh.uniforms as Record<string, THREE.IUniform>;
          if (U['focus']) U['focus'].value = this.DofDistancia;
          if (U['aperture']) U['aperture'].value = this.DofApertura * 0.00012;
          if (U['maxblur']) U['maxblur'].value = this.DofMaxBlur;
        }
      }
      if (this.PaseBloom) {
        this.PaseBloom.enabled = this.BloomActivo;
        this.PaseBloom.strength = this.BloomFuerza;
        this.PaseBloom.radius = this.BloomRadio;
        this.PaseBloom.threshold = this.BloomUmbral;
      }
      if (this.PaseGradoCine) {
        this.PaseGradoCine.enabled = GradoCineActivo;
        const U = this.PaseGradoCine.uniforms;
        U['uHasDirt'].value = this.LensDirtActivo && this.TexturaDirt ? 1.0 : 0.0;
        U['uDirtIntensity'].value = this.LensDirtIntensidad;
        U['uColorGradingActive'].value = this.ColorGradingActivo ? 1.0 : 0.0;
        U['uTemperature'].value = this.Temperatura;
        U['uTint'].value = this.Tinte;
        U['uSaturation'].value = this.Saturacion;
        U['uContrast'].value = this.Contraste;
        U['uVignetteActive'].value = this.VignetaActiva ? 1.0 : 0.0;
        (U['uVignetteColor'].value as THREE.Color).set(this.VignetaColor || '#000000');
        U['uVignetteIntensity'].value = this.VignetaOscuridad;
        U['uVignetteSmoothness'].value = this.VignetaSuavizado;
      }
      if (this.PaseRGB) {
        this.PaseRGB.enabled = this.AberracionCromaticaActiva;
        this.PaseRGB.uniforms['amount'].value = this.AberracionCantidad;
      }
      if (this.PaseRuido) {
        this.PaseRuido.enabled = this.RuidoActivo;
        this.PaseRuido.uniforms['intensity'].value = this.RuidoIntensidad;
        this.PaseRuido.uniforms['time'].value = (this.PaseRuido.uniforms['time'].value + 0.137) % 1000;
      }
      if (this.PaseFXAA) {
        this.PaseFXAA.enabled = this.FxaaActivo;
      }

      this.Compositor.render();
    } else {
      this.Renderer.render(this.Escena, this.Camara);
    }
  }

  // --------------------------------------------------------------------------
  // Post-proceso setters & serialización
  // --------------------------------------------------------------------------

  public EstablecerBloom(Activo: boolean, Fuerza?: number, Radio?: number, Umbral?: number): void {
    this.BloomActivo = Activo;
    if (Fuerza !== undefined) this.BloomFuerza = Fuerza;
    if (Radio !== undefined) this.BloomRadio = Radio;
    if (Umbral !== undefined) this.BloomUmbral = Umbral;
    if (this.PaseBloom) {
      this.PaseBloom.strength = this.BloomFuerza;
      this.PaseBloom.radius = this.BloomRadio;
      this.PaseBloom.threshold = this.BloomUmbral;
    }
  }

  public EstablecerDOF(
    Activo: boolean,
    Opts?: { Modo?: ModoAutoFocus; Distancia?: number; Offset?: number; Apertura?: number; MaxBlur?: number }
  ): void {
    this.DofActivo = Activo;
    if (Opts?.Modo !== undefined) this.DofModoAutoFocus = Opts.Modo;
    if (Opts?.Distancia !== undefined) this.DofDistancia = Opts.Distancia;
    if (Opts?.Offset !== undefined) this.DofOffset = Opts.Offset;
    if (Opts?.Apertura !== undefined) this.DofApertura = Opts.Apertura;
    if (Opts?.MaxBlur !== undefined) this.DofMaxBlur = Opts.MaxBlur;
  }

  public EstablecerColorGrading(
    Activo: boolean,
    Opts?: { Temperatura?: number; Tinte?: number; Saturacion?: number; Contraste?: number }
  ): void {
    this.ColorGradingActivo = Activo;
    if (Opts?.Temperatura !== undefined) this.Temperatura = Opts.Temperatura;
    if (Opts?.Tinte !== undefined) this.Tinte = Opts.Tinte;
    if (Opts?.Saturacion !== undefined) this.Saturacion = Opts.Saturacion;
    if (Opts?.Contraste !== undefined) this.Contraste = Opts.Contraste;
  }

  public EstablecerLensDirt(Activo: boolean, TexturaUrl?: string, Intensidad?: number): void {
    this.LensDirtActivo = Activo;
    if (Intensidad !== undefined) this.LensDirtIntensidad = Intensidad;
    if (TexturaUrl !== undefined && TexturaUrl !== this.LensDirtTextura) {
      this.LensDirtTextura = TexturaUrl;
      if (this.TexturaDirt) {
        this.TexturaDirt.dispose();
        this.TexturaDirt = null;
      }
      if (this.UrlDirtBlob && this.UrlDirtBlob.startsWith('blob:')) {
        URL.revokeObjectURL(this.UrlDirtBlob);
        this.UrlDirtBlob = null;
      }
      if (TexturaUrl) {
        if (TexturaUrl.startsWith('blob:')) this.UrlDirtBlob = TexturaUrl;
        new THREE.TextureLoader().load(TexturaUrl, (Tex) => {
          Tex.colorSpace = THREE.SRGBColorSpace;
          this.TexturaDirt = Tex;
          if (this.PaseGradoCine) this.PaseGradoCine.uniforms['tDirt'].value = Tex;
        });
      } else if (this.PaseGradoCine) {
        this.PaseGradoCine.uniforms['tDirt'].value = null;
      }
    }
  }

  public EstablecerAberracionCromatica(Activa: boolean, Cantidad?: number): void {
    this.AberracionCromaticaActiva = Activa;
    if (Cantidad !== undefined) this.AberracionCantidad = Cantidad;
    if (this.PaseRGB) this.PaseRGB.uniforms['amount'].value = this.AberracionCantidad;
  }

  public EstablecerRuido(Activo: boolean, Intensidad?: number): void {
    this.RuidoActivo = Activo;
    if (Intensidad !== undefined) this.RuidoIntensidad = Intensidad;
    if (this.PaseRuido) this.PaseRuido.uniforms['intensity'].value = this.RuidoIntensidad;
  }

  public EstablecerVigneta(Activa: boolean, Oscuridad?: number, Suavizado?: number, ColorHex?: string): void {
    this.VignetaActiva = Activa;
    if (Oscuridad !== undefined) this.VignetaOscuridad = Oscuridad;
    if (Suavizado !== undefined) this.VignetaSuavizado = Suavizado;
    if (ColorHex !== undefined) this.VignetaColor = ColorHex;
  }

  public EstablecerFXAA(Activo: boolean): void {
    this.FxaaActivo = Activo;
  }

  public ObtenerConfigPostProceso(): ConfiguracionPostProceso {
    return {
      DofActivo: this.DofActivo,
      DofModoAutoFocus: this.DofModoAutoFocus,
      DofDistancia: this.DofDistancia,
      DofOffset: this.DofOffset,
      DofApertura: this.DofApertura,
      DofMaxBlur: this.DofMaxBlur,
      BloomActivo: this.BloomActivo,
      BloomFuerza: this.BloomFuerza,
      BloomRadio: this.BloomRadio,
      BloomUmbral: this.BloomUmbral,
      LensDirtActivo: this.LensDirtActivo,
      LensDirtTextura: this.LensDirtTextura,
      LensDirtIntensidad: this.LensDirtIntensidad,
      ColorGradingActivo: this.ColorGradingActivo,
      Temperatura: this.Temperatura,
      Tinte: this.Tinte,
      Saturacion: this.Saturacion,
      Contraste: this.Contraste,
      VignetaActiva: this.VignetaActiva,
      VignetaColor: this.VignetaColor,
      VignetaOscuridad: this.VignetaOscuridad,
      AberracionActiva: this.AberracionCromaticaActiva,
      AberracionCantidad: this.AberracionCantidad,
      RuidoActivo: this.RuidoActivo,
      RuidoIntensidad: this.RuidoIntensidad,
      FxaaActivo: this.FxaaActivo
    };
  }

  public AplicarConfigPostProceso(C: Partial<ConfiguracionPostProceso>): void {
    if (C.DofActivo !== undefined || C.DofApertura !== undefined || C.DofModoAutoFocus !== undefined) {
      this.EstablecerDOF(C.DofActivo ?? this.DofActivo, {
        Modo: C.DofModoAutoFocus,
        Distancia: C.DofDistancia,
        Offset: C.DofOffset,
        Apertura: C.DofApertura,
        MaxBlur: C.DofMaxBlur
      });
    }
    if (C.BloomActivo !== undefined || C.BloomFuerza !== undefined || C.BloomRadio !== undefined || C.BloomUmbral !== undefined) {
      this.EstablecerBloom(C.BloomActivo ?? this.BloomActivo, C.BloomFuerza, C.BloomRadio, C.BloomUmbral);
    }
    if (C.LensDirtActivo !== undefined || C.LensDirtTextura !== undefined || C.LensDirtIntensidad !== undefined) {
      this.EstablecerLensDirt(C.LensDirtActivo ?? this.LensDirtActivo, C.LensDirtTextura, C.LensDirtIntensidad);
    }
    if (C.ColorGradingActivo !== undefined || C.Temperatura !== undefined || C.Tinte !== undefined || C.Saturacion !== undefined || C.Contraste !== undefined) {
      this.EstablecerColorGrading(C.ColorGradingActivo ?? this.ColorGradingActivo, {
        Temperatura: C.Temperatura,
        Tinte: C.Tinte,
        Saturacion: C.Saturacion,
        Contraste: C.Contraste
      });
    }
    if (C.VignetaActiva !== undefined || C.VignetaColor !== undefined || C.VignetaOscuridad !== undefined) {
      this.EstablecerVigneta(C.VignetaActiva ?? this.VignetaActiva, C.VignetaOscuridad, undefined, C.VignetaColor);
    }
    if (C.AberracionActiva !== undefined || C.AberracionCantidad !== undefined) {
      this.EstablecerAberracionCromatica(C.AberracionActiva ?? this.AberracionCromaticaActiva, C.AberracionCantidad);
    }
    if (C.RuidoActivo !== undefined || C.RuidoIntensidad !== undefined) {
      this.EstablecerRuido(C.RuidoActivo ?? this.RuidoActivo, C.RuidoIntensidad);
    }
    if (C.FxaaActivo !== undefined) {
      this.EstablecerFXAA(C.FxaaActivo);
    }
  }

  // --------------------------------------------------------------------------
  // Focos y luces de escenario volumétricas (Multi-Foco concierto / Gizmo)
  // --------------------------------------------------------------------------

  private ObtenerGeometriaHazBase(): THREE.BufferGeometry {
    if (!this.GeometriaHazBase) {
      const Geo = new THREE.ConeGeometry(1, 1, 24, 1, true);
      // Orientar punta en (0,0,0) y cono abriéndose hacia +Z hasta z=1
      Geo.rotateX(-Math.PI / 2);
      Geo.translate(0, 0, 0.5);
      this.GeometriaHazBase = Geo;
    }
    return this.GeometriaHazBase;
  }

  private SincronizarHazSpotlight(Item: InstanciaLuzEscenario): void {
    const C = Item.Config;
    Item.Luz.position.set(C.Posicion[0], C.Posicion[1], C.Posicion[2]);
    Item.Objetivo.position.set(C.Objetivo[0], C.Objetivo[1], C.Objetivo[2]);
    Item.Luz.visible = C.Activa;

    if (Item.Luz instanceof THREE.SpotLight) {
      Item.Luz.angle = THREE.MathUtils.degToRad(Limitar(C.AnguloDeg, 5, 80));
      Item.Luz.distance = C.Alcance;
      Item.Luz.penumbra = 0.45;
      Item.Luz.color.set(C.Color);
      Item.Luz.intensity = C.Activa ? C.Intensidad : 0;
    } else {
      Item.Luz.color.set(C.Color);
      Item.Luz.intensity = C.Activa ? C.Intensidad : 0;
      Item.Luz.distance = C.Alcance;
    }

    if (Item.HazVolumetrico && Item.MaterialHaz) {
      Item.HazVolumetrico.visible = C.Activa && C.Volumetrica && C.Tipo === 'Spot';
      if (Item.HazVolumetrico.visible) {
        Item.MaterialHaz.uniforms['uColor'].value.set(C.Color);
        Item.MaterialHaz.uniforms['uOpacity'].value = C.OpacidadHaz;
        Item.HazVolumetrico.position.copy(Item.Luz.position);
        Item.HazVolumetrico.lookAt(Item.Objetivo.position);
        const Dist = Math.max(0.5, Math.min(C.Alcance, Item.Luz.position.distanceTo(Item.Objetivo.position) + 1.2));
        const Radio = Math.tan(THREE.MathUtils.degToRad(Limitar(C.AnguloDeg, 5, 75))) * Dist;
        Item.HazVolumetrico.scale.set(Radio, Radio, Dist);
      }
    }
  }

  public AgregarLuzEscenario(Parcial?: Partial<ConfiguracionLuzEscenario>): InstanciaLuzEscenario {
    const Id = Parcial?.Id ?? GenerarId();
    const Index = this.LucesEscenario.length + 1;
    const Config: ConfiguracionLuzEscenario = {
      Id,
      Nombre: Parcial?.Nombre ?? `Foco ${Index}`,
      Activa: Parcial?.Activa ?? true,
      Tipo: Parcial?.Tipo ?? 'Spot',
      Color: Parcial?.Color ?? '#4cc9ff',
      Intensidad: Parcial?.Intensidad ?? 35,
      Posicion: Parcial?.Posicion ?? [0, 3.2, -1.5],
      Objetivo: Parcial?.Objetivo ?? [0, 0.9, 0],
      AnguloDeg: Parcial?.AnguloDeg ?? 26,
      Alcance: Parcial?.Alcance ?? 12,
      Volumetrica: Parcial?.Volumetrica ?? true,
      OpacidadHaz: Parcial?.OpacidadHaz ?? 0.22,
      SeguirPersonaje: Parcial?.SeguirPersonaje ?? false,
      AutoRotarVelocidad: Parcial?.AutoRotarVelocidad ?? 0
    };

    const Objetivo = new THREE.Object3D();
    Objetivo.position.set(Config.Objetivo[0], Config.Objetivo[1], Config.Objetivo[2]);
    this.Escena.add(Objetivo);

    let Luz: THREE.SpotLight | THREE.PointLight;
    if (Config.Tipo === 'Spot') {
      const Spot = new THREE.SpotLight(Config.Color, Config.Intensidad, Config.Alcance, THREE.MathUtils.degToRad(Config.AnguloDeg), 0.45, 1.2);
      Spot.target = Objetivo;
      Luz = Spot;
    } else {
      Luz = new THREE.PointLight(Config.Color, Config.Intensidad, Config.Alcance, 1.2);
    }
    Luz.position.set(Config.Posicion[0], Config.Posicion[1], Config.Posicion[2]);
    this.Escena.add(Luz);

    const MaterialHaz = CrearMaterialHazVolumetrico(Config.Color, Config.OpacidadHaz);
    const HazVolumetrico = new THREE.Mesh(this.ObtenerGeometriaHazBase(), MaterialHaz);
    HazVolumetrico.frustumCulled = false;
    this.Escena.add(HazVolumetrico);

    const Instancia: InstanciaLuzEscenario = { Config, Luz, Objetivo, HazVolumetrico, MaterialHaz };
    this.SincronizarHazSpotlight(Instancia);
    this.LucesEscenario.push(Instancia);
    return Instancia;
  }

  public ActualizarLuzEscenario(Id: string, Parcial: Partial<ConfiguracionLuzEscenario>): void {
    const Instancia = this.LucesEscenario.find((L) => L.Config.Id === Id);
    if (!Instancia) return;
    Object.assign(Instancia.Config, Parcial);
    this.SincronizarHazSpotlight(Instancia);
  }

  public BuscarLuzPorObjeto(Obj: THREE.Object3D | null): InstanciaLuzEscenario | undefined {
    if (!Obj) return undefined;
    return this.LucesEscenario.find((L) => L.Luz === Obj);
  }

  public EliminarLuzEscenario(Id: string): void {
    const Idx = this.LucesEscenario.findIndex((L) => L.Config.Id === Id);
    if (Idx < 0) return;
    const Item = this.LucesEscenario[Idx];
    if (this.ControlTransformacion.object === Item.Luz) {
      this.ControlTransformacion.detach();
    }
    this.Escena.remove(Item.Luz);
    this.Escena.remove(Item.Objetivo);
    if (Item.HazVolumetrico) this.Escena.remove(Item.HazVolumetrico);
    Item.MaterialHaz?.dispose();
    this.LucesEscenario.splice(Idx, 1);
  }

  public LimpiarLucesEscenario(): void {
    for (const L of [...this.LucesEscenario]) this.EliminarLuzEscenario(L.Config.Id);
  }

  public ObtenerConfigsLucesEscenario(): ConfiguracionLuzEscenario[] {
    return this.LucesEscenario.map((L) => ({
      ...L.Config,
      Posicion: [...L.Config.Posicion] as [number, number, number],
      Objetivo: [...L.Config.Objetivo] as [number, number, number]
    }));
  }

  public AplicarLucesEscenario(Configs: ConfiguracionLuzEscenario[]): void {
    this.LimpiarLucesEscenario();
    for (const C of Configs) this.AgregarLuzEscenario(C);
  }

  /** Crea los 5 focos pentagonales estilo escenario de concierto (inspirado en Stage Lighting). */
  public AplicarPresetCincoFocos(): void {
    this.LimpiarLucesEscenario();
    const Colores = ['#ffe600', '#a100ff', '#00ffed', '#10ff40', '#ff8700'];
    const Radio = 1.9;
    for (let I = 0; I < 5; I++) {
      const Ang = (I * Math.PI * 2) / 5 - Math.PI / 2;
      this.AgregarLuzEscenario({
        Nombre: `Foco Concierto ${I + 1}`,
        Tipo: 'Spot',
        Color: Colores[I],
        Intensidad: 42,
        Posicion: [Math.cos(Ang) * Radio, 3.4, Math.sin(Ang) * Radio],
        Objetivo: [0, 0.5, 0],
        AnguloDeg: 24,
        Alcance: 10,
        Volumetrica: true,
        OpacidadHaz: 0.19,
        AutoRotarVelocidad: 0.35
      });
    }
  }

  // --------------------------------------------------------------------------
  // Fondos, piso, iluminación global y cámara
  // --------------------------------------------------------------------------

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

  public EstablecerFondoColor(Hex: string): void {
    this.LimpiarFondoAnterior();
    this.Escena.background = new THREE.Color(Hex);
  }

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

  public EstablecerModeloFondo(Objeto: THREE.Object3D): void {
    this.QuitarModeloFondo();
    this.ModeloFondo = Objeto;
    Objeto.traverse((Nodo) => {
      const Malla = Nodo as THREE.Mesh;
      if (Malla.isMesh) { Malla.receiveShadow = true; Malla.castShadow = false; }
    });
    this.Escena.add(Objeto);
  }

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

  public EstablecerExposicion(Valor: number): void {
    this.Renderer.toneMappingExposure = Valor;
  }

  public EstablecerLuzDireccional(Intensidad: number, ColorHex?: string): void {
    this.LuzDireccional.intensity = Intensidad;
    if (ColorHex) this.LuzDireccional.color.set(ColorHex);
  }

  public EstablecerLuzAmbiental(Intensidad: number, ColorHex?: string): void {
    this.LuzAmbiental.intensity = Intensidad;
    if (ColorHex) this.LuzAmbiental.color.set(ColorHex);
  }

  public AlternarRejilla(Visible: boolean): void {
    this.Rejilla.visible = Visible;
  }

  public EstablecerSombraPiso(Visible: boolean): void {
    if (this.PisoSombra) this.PisoSombra.visible = Visible;
  }

  public ObtenerLienzo(): HTMLCanvasElement {
    return this.Renderer.domElement;
  }
}

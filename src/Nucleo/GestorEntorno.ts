// ============================================================================
// GestorEntorno.ts — Entornos procedurales cinematográficos y JSON VRMLiveViewer
// Administra pisos (Rejilla, Reflectivo, Agua animada, Neón), cielos (Solido,
// Sky Día/Atardecer/Noche, Espacio Dinámico, 360°, Video sincronizado), niebla,
// presets en 1 clic e importador directo de configuraciones .json de VRMLiveViewer.
// ============================================================================

import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ConfiguracionEntorno, TipoCielo, TipoPiso } from '../Tipos';
import { Limitar } from '../Utilidades';
import type { GestorEscena } from './GestorEscena';
import type { GestorEfectos, TipoParticulas } from './GestorEfectos';
import type { BusEventos } from '../Arquitectura/BusEventos';

export type PresetEntornoId = 'estudio' | 'espacio_reflectivo' | 'noche_kagura' | 'atardecer_agua' | 'escenario_neon';

export interface DefinicionPresetEntorno {
  Id: PresetEntornoId;
  Nombre: string;
  Descripcion: string;
}

export const PRESETS_ENTORNO: DefinicionPresetEntorno[] = [
  { Id: 'estudio', Nombre: 'Estudio Oscuro', Descripcion: 'Rejilla limpia neutra de trabajo rápido.' },
  { Id: 'espacio_reflectivo', Nombre: 'Espacio Reflectivo', Descripcion: 'Espejo en piso + nebulosa animada + Bloom.' },
  { Id: 'noche_kagura', Nombre: 'Noche Concierto', Descripcion: 'Escenario oscuro con niebla violeta, DoF y viñeta.' },
  { Id: 'atardecer_agua', Nombre: 'Atardecer Agua', Descripcion: 'Plano de agua con reflejos solares, DoF y Lens Dirt.' },
  { Id: 'escenario_neon', Nombre: 'Neón 5 Focos', Descripcion: 'Plataforma emisiva con 5 focos volumétricos en movimiento.' }
];

function CrearMapaNormalAguaProcedural(): THREE.CanvasTexture {
  const Tam = 256;
  const Canvas = document.createElement('canvas');
  Canvas.width = Tam;
  Canvas.height = Tam;
  const Ctx = Canvas.getContext('2d')!;
  const Img = Ctx.createImageData(Tam, Tam);
  const Data = Img.data;
  const DosPi = Math.PI * 2;

  for (let y = 0; y < Tam; y++) {
    const v = (y / Tam) * DosPi;
    for (let x = 0; x < Tam; x++) {
      const u = (x / Tam) * DosPi;
      // Derivadas analíticas periódicas (seamless tileable) para ondas suaves de agua
      const dx =
        Math.cos(u * 3 + v * 2) * 0.45 +
        Math.cos(u * 7 - v * 4) * 0.25 +
        Math.sin(u * 11 + v * 9) * 0.12;
      const dy =
        Math.sin(v * 3 - u * 2) * 0.45 +
        Math.cos(v * 6 + u * 5) * 0.25 +
        Math.sin(v * 10 - u * 8) * 0.12;
      const Nx = -dx * 0.45;
      const Ny = -dy * 0.45;
      const Nz = Math.sqrt(Math.max(0.01, 1 - Nx * Nx - Ny * Ny));
      const idx = (y * Tam + x) * 4;
      Data[idx] = Math.round((Nx * 0.5 + 0.5) * 255);
      Data[idx + 1] = Math.round((Ny * 0.5 + 0.5) * 255);
      Data[idx + 2] = Math.round((Nz * 0.5 + 0.5) * 255);
      Data[idx + 3] = 255;
    }
  }
  Ctx.putImageData(Img, 0, 0);
  const Tex = new THREE.CanvasTexture(Canvas);
  Tex.wrapS = THREE.RepeatWrapping;
  Tex.wrapT = THREE.RepeatWrapping;
  return Tex;
}

function CrearMaterialEspacioDinamico(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color('#3b6dff') },
      uAccent: { value: new THREE.Color('#c04cff') }
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTint;
      uniform vec3 uAccent;
      varying vec3 vDir;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      void main() {
        vec3 d = normalize(vDir);
        float drift = uTime * 0.08;
        float n1 = noise(d * 3.5 + vec3(0.0, drift, drift * 0.5));
        float n2 = noise(d * 7.5 - vec3(drift * 0.4, 0.0, drift));
        float nebula = smoothstep(0.32, 0.85, n1 * 0.65 + n2 * 0.35);

        vec3 base = vec3(0.02, 0.025, 0.055);
        vec3 col = base + uTint * nebula * 0.42 + uAccent * pow(n2, 2.2) * 0.38;

        // Campo de estrellas nítido con centelleo sutil
        vec3 grid = floor(d * 145.0);
        float starRnd = hash(grid);
        if (starRnd > 0.992) {
          float twinkle = 0.65 + 0.35 * sin(uTime * 3.0 + starRnd * 100.0);
          col += vec3(1.1, 1.15, 1.35) * twinkle;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false
  });
}

export class GestorEntorno {
  public Config: ConfiguracionEntorno = {
    PresetId: 'estudio',
    Piso: 'Rejilla',
    ColorPiso: '#283042',
    TamanoPiso: 12,
    Cielo: 'Solido',
    ColorFondo: '#1b1e26',
    NieblaActiva: false,
    NieblaColor: '#1b1e26',
    NieblaDensidad: 0.035,
    Exposicion: 1.0
  };

  private GrupoPiso = new THREE.Group();
  private ReflectorObj: Reflector | null = null;
  private AguaObj: Water | null = null;
  private TexturaNormalAgua: THREE.Texture | null = null;

  private SkyObj: Sky | null = null;
  private EspacioMalla: THREE.Mesh | null = null;
  private EspacioMat: THREE.ShaderMaterial | null = null;
  private Textura360: THREE.Texture | null = null;
  private VideoElem: HTMLVideoElement | null = null;
  private VideoTextura: THREE.VideoTexture | null = null;
  private UrlVideoBlob: string | null = null;
  private TiempoAcumulado = 0;

  constructor(
    private readonly EscenaSys: GestorEscena,
    private readonly Bus?: BusEventos
  ) {
    this.EscenaSys.Escena.add(this.GrupoPiso);
  }

  // --------------------------------------------------------------------------
  // Pisos procedurales (Rejilla, Reflectivo, Agua, Escenario Neón, Ninguno)
  // --------------------------------------------------------------------------

  private LimpiarPisoActual(): void {
    if (this.ReflectorObj) {
      this.ReflectorObj.dispose();
      this.ReflectorObj = null;
    }
    this.AguaObj = null;
    if (this.TexturaNormalAgua) {
      this.TexturaNormalAgua.dispose();
      this.TexturaNormalAgua = null;
    }
    while (this.GrupoPiso.children.length > 0) {
      const Hijo = this.GrupoPiso.children.pop()!;
      Hijo.traverse((N) => {
        const M = N as THREE.Mesh;
        if (M.geometry) M.geometry.dispose();
        if (M.material) {
          if (Array.isArray(M.material)) M.material.forEach((Mat) => Mat.dispose());
          else M.material.dispose();
        }
      });
    }
  }

  public EstablecerPiso(Tipo: TipoPiso, ColorHex?: string, Tamano?: number): void {
    this.Config.Piso = Tipo;
    if (ColorHex) this.Config.ColorPiso = ColorHex;
    if (Tamano) this.Config.TamanoPiso = Tamano;

    this.LimpiarPisoActual();
    this.EscenaSys.AlternarRejilla(Tipo === 'Rejilla');
    this.EscenaSys.EstablecerSombraPiso(Tipo !== 'Ninguno' && Tipo !== 'Agua');

    if (Tipo === 'Rejilla' || Tipo === 'Ninguno') {
      this.Bus?.Emitir('entorno:cambiado', {});
      return;
    }

    const Radio = Limitar(this.Config.TamanoPiso, 4, 40);

    if (Tipo === 'Reflectivo') {
      const TexRes = Math.min(1024, Math.max(256, Math.round(512 * this.EscenaSys.EscalaPrevia * 1.4)));
      const Geo = new THREE.CircleGeometry(Radio, 64);
      const Ref = new Reflector(Geo, {
        clipBias: 0.003,
        textureWidth: TexRes,
        textureHeight: TexRes,
        color: new THREE.Color(this.Config.ColorPiso || '#3b4254'),
        multisample: 0
      });
      Ref.rotation.x = -Math.PI / 2;
      Ref.position.y = -0.002;
      this.ReflectorObj = Ref;
      this.GrupoPiso.add(Ref);

      // Aro sutil luminoso para delimitar escenario de baile
      const Aro = new THREE.Mesh(
        new THREE.RingGeometry(Radio * 0.25, Radio * 0.256, 64),
        new THREE.MeshBasicMaterial({ color: '#4cc9ff', transparent: true, opacity: 0.45, side: THREE.DoubleSide })
      );
      Aro.rotation.x = -Math.PI / 2;
      Aro.position.y = 0.001;
      this.GrupoPiso.add(Aro);
    } else if (Tipo === 'Agua') {
      const Geo = new THREE.PlaneGeometry(80, 80);
      this.TexturaNormalAgua = CrearMapaNormalAguaProcedural();
      const Agua = new Water(Geo, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: this.TexturaNormalAgua,
        sunDirection: this.EscenaSys.LuzDireccional.position.clone().normalize(),
        sunColor: 0xffffff,
        waterColor: new THREE.Color(this.Config.ColorPiso || '#004966'),
        distortionScale: 1.6,
        fog: Boolean(this.EscenaSys.Escena.fog)
      });
      Agua.rotation.x = -Math.PI / 2;
      Agua.position.y = -0.02;
      this.AguaObj = Agua;
      this.GrupoPiso.add(Agua);
    } else if (Tipo === 'EscenarioNeon') {
      const Base = new THREE.Mesh(
        new THREE.CylinderGeometry(Radio * 0.55, Radio * 0.6, 0.08, 64),
        new THREE.MeshStandardMaterial({
          color: this.Config.ColorPiso || '#121521',
          roughness: 0.22,
          metalness: 0.7
        })
      );
      Base.position.y = -0.04;
      Base.receiveShadow = true;
      this.GrupoPiso.add(Base);

      const AroExterno = new THREE.Mesh(
        new THREE.TorusGeometry(Radio * 0.55, 0.028, 12, 72),
        new THREE.MeshStandardMaterial({
          color: '#00d4ff',
          emissive: new THREE.Color('#00e5ff'),
          emissiveIntensity: 2.8,
          roughness: 0.2
        })
      );
      AroExterno.rotation.x = Math.PI / 2;
      AroExterno.position.y = 0.004;

      const AroInterno = new THREE.Mesh(
        new THREE.TorusGeometry(Radio * 0.28, 0.018, 12, 64),
        new THREE.MeshStandardMaterial({
          color: '#c04cff',
          emissive: new THREE.Color('#d946ef'),
          emissiveIntensity: 2.5,
          roughness: 0.2
        })
      );
      AroInterno.rotation.x = Math.PI / 2;
      AroInterno.position.y = 0.004;
      this.GrupoPiso.add(AroExterno, AroInterno);
    }

    this.Bus?.Emitir('entorno:cambiado', {});
  }

  // --------------------------------------------------------------------------
  // Cielos (Solido, Día/Atardecer/Noche, EspacioDinamico, 360, Video)
  // --------------------------------------------------------------------------

  private LimpiarCieloActual(mantenerVideo = false): void {
    if (this.SkyObj) {
      this.EscenaSys.Escena.remove(this.SkyObj);
      this.SkyObj.geometry.dispose();
      (this.SkyObj.material as THREE.Material).dispose();
      this.SkyObj = null;
    }
    if (this.EspacioMalla) {
      this.EscenaSys.Escena.remove(this.EspacioMalla);
      this.EspacioMalla.geometry.dispose();
      this.EspacioMat?.dispose();
      this.EspacioMalla = null;
      this.EspacioMat = null;
    }
    if (this.Textura360) {
      this.Textura360.dispose();
      this.Textura360 = null;
    }
    if (!mantenerVideo) this.QuitarVideoFondo();
  }

  public EstablecerCielo(
    Tipo: TipoCielo,
    Opts?: { ColorFondo?: string; Turbidity?: number; ElevacionDeg?: number; AzimutDeg?: number }
  ): void {
    this.Config.Cielo = Tipo;
    if (Opts?.ColorFondo) this.Config.ColorFondo = Opts.ColorFondo;

    if (Tipo !== 'Imagen360' && Tipo !== 'VideoFondo') {
      this.LimpiarCieloActual(false);
    }

    if (Tipo === 'Solido') {
      this.EscenaSys.EstablecerFondoColor(this.Config.ColorFondo || '#1b1e26');
    } else if (Tipo === 'Dia' || Tipo === 'Atardecer' || Tipo === 'Noche') {
      const Cielo = new Sky();
      Cielo.scale.setScalar(4500);
      const U = Cielo.material.uniforms;

      const Def = Tipo === 'Dia'
        ? { Turb: 2.8, Ray: 1.5, Mie: 0.005, Elev: 42, Azim: 155 }
        : Tipo === 'Atardecer'
          ? { Turb: 9.5, Ray: 3.1, Mie: 0.015, Elev: 3.5, Azim: 175 }
          : { Turb: 1.2, Ray: 0.35, Mie: 0.002, Elev: -3.5, Azim: 180 };

      U['turbidity'].value = Opts?.Turbidity ?? Def.Turb;
      U['rayleigh'].value = Def.Ray;
      U['mieCoefficient'].value = Def.Mie;
      U['mieDirectionalG'].value = 0.82;

      const Phi = THREE.MathUtils.degToRad(90 - (Opts?.ElevacionDeg ?? Def.Elev));
      const Theta = THREE.MathUtils.degToRad(Opts?.AzimutDeg ?? Def.Azim);
      const Sol = new THREE.Vector3().setFromSphericalCoords(1, Phi, Theta);
      U['sunPosition'].value.copy(Sol);

      if (this.AguaObj) {
        (this.AguaObj.material.uniforms['sunDirection'].value as THREE.Vector3).copy(Sol).normalize();
      }
      this.EscenaSys.Escena.add(Cielo);
      this.SkyObj = Cielo;
      if (Tipo === 'Noche') {
        this.EscenaSys.EstablecerFondoColor('#060814');
      }
    } else if (Tipo === 'EspacioDinamico') {
      this.EspacioMat = CrearMaterialEspacioDinamico();
      this.EspacioMalla = new THREE.Mesh(new THREE.SphereGeometry(95, 32, 24), this.EspacioMat);
      this.EscenaSys.Escena.add(this.EspacioMalla);
      this.EscenaSys.EstablecerFondoColor('#05060e');
    }

    this.Bus?.Emitir('entorno:cambiado', {});
  }

  public EstablecerImagen360(ArchivoOUrn: File | string): void {
    this.LimpiarCieloActual(false);
    this.Config.Cielo = 'Imagen360';
    const EsBlob = typeof ArchivoOUrn !== 'string';
    const Url = EsBlob ? URL.createObjectURL(ArchivoOUrn) : ArchivoOUrn;
    new THREE.TextureLoader().load(Url, (Tex) => {
      Tex.mapping = THREE.EquirectangularReflectionMapping;
      Tex.colorSpace = THREE.SRGBColorSpace;
      this.Textura360 = Tex;
      this.EscenaSys.Escena.background = Tex;
      if (EsBlob) URL.revokeObjectURL(Url);
      this.Bus?.Emitir('entorno:cambiado', {});
    });
  }

  public EstablecerVideoFondo(Archivo: File): void {
    this.LimpiarCieloActual(false);
    this.Config.Cielo = 'VideoFondo';
    const Url = URL.createObjectURL(Archivo);
    this.UrlVideoBlob = Url;

    const Video = document.createElement('video');
    Video.src = Url;
    Video.loop = true;
    Video.muted = true;
    Video.playsInline = true;
    Video.crossOrigin = 'anonymous';
    void Video.play().catch(() => {});

    const Tex = new THREE.VideoTexture(Video);
    Tex.colorSpace = THREE.SRGBColorSpace;
    this.VideoElem = Video;
    this.VideoTextura = Tex;
    this.EscenaSys.Escena.background = Tex;
    this.Bus?.Emitir('entorno:cambiado', {});
  }

  public QuitarVideoFondo(): void {
    if (this.VideoElem) {
      this.VideoElem.pause();
      this.VideoElem.src = '';
      this.VideoElem = null;
    }
    if (this.VideoTextura) {
      this.VideoTextura.dispose();
      this.VideoTextura = null;
    }
    if (this.UrlVideoBlob) {
      URL.revokeObjectURL(this.UrlVideoBlob);
      this.UrlVideoBlob = null;
    }
  }

  // --------------------------------------------------------------------------
  // Niebla atmosférica
  // --------------------------------------------------------------------------

  public EstablecerNiebla(Activa: boolean, ColorHex?: string, Densidad?: number): void {
    this.Config.NieblaActiva = Activa;
    if (ColorHex) this.Config.NieblaColor = ColorHex;
    if (Densidad !== undefined) this.Config.NieblaDensidad = Limitar(Densidad, 0, 0.35);

    this.EscenaSys.Escena.fog = this.Config.NieblaActiva
      ? new THREE.FogExp2(this.Config.NieblaColor, this.Config.NieblaDensidad)
      : null;

    if (this.AguaObj) {
      this.EstablecerPiso('Agua', this.Config.ColorPiso, this.Config.TamanoPiso);
    }
    this.Bus?.Emitir('entorno:cambiado', {});
  }

  // --------------------------------------------------------------------------
  // Presets en 1 clic e importador JSON compatible con VRMLiveViewer
  // --------------------------------------------------------------------------

  public AplicarConfig(Parcial: Partial<ConfiguracionEntorno>): void {
    Object.assign(this.Config, Parcial);
    this.EstablecerNiebla(this.Config.NieblaActiva, this.Config.NieblaColor, this.Config.NieblaDensidad);
    this.EstablecerPiso(this.Config.Piso, this.Config.ColorPiso, this.Config.TamanoPiso);
    this.EstablecerCielo(this.Config.Cielo, { ColorFondo: this.Config.ColorFondo });
    if (Parcial.Exposicion !== undefined) {
      this.EscenaSys.EstablecerExposicion(Parcial.Exposicion);
    }
  }

  public AplicarPreset(Id: PresetEntornoId, Efectos?: GestorEfectos): void {
    this.Config.PresetId = Id;

    if (Id === 'estudio') {
      this.EscenaSys.LimpiarLucesEscenario();
      this.EscenaSys.EstablecerLuzDireccional(2.2, '#ffffff');
      this.EscenaSys.EstablecerLuzAmbiental(0.85, '#bfd0ff');
      this.EscenaSys.EstablecerLuzPersonaje(true, 0.75);
      this.EscenaSys.EstablecerExposicion(1.0);
      this.EscenaSys.AplicarConfigPostProceso({
        DofActivo: false, BloomActivo: false, ColorGradingActivo: false,
        VignetaActiva: false, LensDirtActivo: false, AberracionActiva: false, RuidoActivo: false, FxaaActivo: false
      });
      this.AplicarConfig({ Piso: 'Rejilla', ColorPiso: '#283042', Cielo: 'Solido', ColorFondo: '#1b1e26', NieblaActiva: false });
      Efectos?.QuitarParticulas();
    } else if (Id === 'espacio_reflectivo') {
      this.EscenaSys.LimpiarLucesEscenario();
      this.EscenaSys.EstablecerLuzDireccional(1.0, '#d8e4ff');
      this.EscenaSys.EstablecerLuzAmbiental(0.9, '#7a75ff');
      this.EscenaSys.EstablecerLuzPersonaje(true, 0.9);
      this.EscenaSys.EstablecerExposicion(1.05);
      this.EscenaSys.AplicarConfigPostProceso({
        DofActivo: false,
        BloomActivo: true, BloomFuerza: 0.75, BloomRadio: 0.75, BloomUmbral: 0.78,
        LensDirtActivo: true, LensDirtTextura: '/assets/textures/LensDirt_Vertical.png', LensDirtIntensidad: 0.35,
        ColorGradingActivo: true, Temperatura: -0.15, Tinte: 0.2, Saturacion: 0.12, Contraste: 0.08,
        VignetaActiva: true, VignetaColor: '#4c1d95', VignetaOscuridad: 0.35,
        FxaaActivo: true
      });
      this.AplicarConfig({ Piso: 'Reflectivo', ColorPiso: '#2b3146', TamanoPiso: 12, Cielo: 'EspacioDinamico', NieblaActiva: true, NieblaColor: '#0c081f', NieblaDensidad: 0.02 });
      Efectos?.EstablecerParticulas('KiraKira', 220);
    } else if (Id === 'noche_kagura') {
      this.EscenaSys.LimpiarLucesEscenario();
      this.EscenaSys.EstablecerLuzDireccional(1.1, '#c9b8ff');
      this.EscenaSys.EstablecerLuzAmbiental(0.45, '#3b2466');
      this.EscenaSys.EstablecerLuzPersonaje(true, 1.05);
      this.EscenaSys.EstablecerExposicion(1.05);
      this.EscenaSys.AplicarConfigPostProceso({
        DofActivo: true, DofModoAutoFocus: 'CabezaActivo', DofApertura: 1.8, DofMaxBlur: 0.011,
        BloomActivo: true, BloomFuerza: 0.9, BloomRadio: 0.75, BloomUmbral: 0.76,
        ColorGradingActivo: true, Temperatura: -0.35, Tinte: 0.35, Saturacion: 0.1, Contraste: 0.1,
        VignetaActiva: true, VignetaColor: '#006875', VignetaOscuridad: 0.42,
        LensDirtActivo: false, FxaaActivo: true
      });
      this.AplicarConfig({ Piso: 'Reflectivo', ColorPiso: '#1d1c2e', TamanoPiso: 12, Cielo: 'Noche', NieblaActiva: true, NieblaColor: '#280a45', NieblaDensidad: 0.032 });
      Efectos?.EstablecerParticulas('SakuraGlow', 240);
    } else if (Id === 'atardecer_agua') {
      this.EscenaSys.LimpiarLucesEscenario();
      this.EscenaSys.EstablecerLuzDireccional(1.6, '#ff9c42');
      this.EscenaSys.EstablecerLuzAmbiental(0.8, '#9d6b31');
      this.EscenaSys.EstablecerLuzPersonaje(true, 0.85, '#ffe0ba');
      this.EscenaSys.EstablecerExposicion(0.95);
      this.EscenaSys.AplicarConfigPostProceso({
        DofActivo: true, DofModoAutoFocus: 'CabezaActivo', DofApertura: 1.6, DofMaxBlur: 0.01,
        BloomActivo: true, BloomFuerza: 0.65, BloomRadio: 0.65, BloomUmbral: 0.82,
        LensDirtActivo: true, LensDirtTextura: '/assets/textures/LensDirt_Vertical.png', LensDirtIntensidad: 0.4,
        ColorGradingActivo: true, Temperatura: 0.42, Tinte: 0.22, Saturacion: 0.08, Contraste: 0.12,
        VignetaActiva: true, VignetaColor: '#3a5b6e', VignetaOscuridad: 0.32,
        FxaaActivo: true
      });
      this.AplicarConfig({ Piso: 'Agua', ColorPiso: '#0b445e', Cielo: 'Atardecer', NieblaActiva: true, NieblaColor: '#b55b26', NieblaDensidad: 0.014 });
      Efectos?.EstablecerParticulas('Chispas', 160);
    } else if (Id === 'escenario_neon') {
      this.EscenaSys.AplicarPresetCincoFocos();
      this.EscenaSys.EstablecerLuzDireccional(0.35, '#ffffff');
      this.EscenaSys.EstablecerLuzAmbiental(0.35, '#2a2250');
      this.EscenaSys.EstablecerLuzPersonaje(true, 0.85);
      this.EscenaSys.EstablecerExposicion(1.0);
      this.EscenaSys.AplicarConfigPostProceso({
        DofActivo: false,
        BloomActivo: true, BloomFuerza: 1.0, BloomRadio: 0.7, BloomUmbral: 0.72,
        LensDirtActivo: true, LensDirtTextura: '/assets/textures/LensDirt_Vertical.png', LensDirtIntensidad: 0.28,
        ColorGradingActivo: true, Temperatura: 0, Tinte: 0.05, Saturacion: 0.15, Contraste: 0.1,
        VignetaActiva: true, VignetaColor: '#000000', VignetaOscuridad: 0.48,
        FxaaActivo: true
      });
      this.AplicarConfig({ Piso: 'EscenarioNeon', ColorPiso: '#121524', TamanoPiso: 10, Cielo: 'Solido', ColorFondo: '#070912', NieblaActiva: true, NieblaColor: '#090b18', NieblaDensidad: 0.025 });
      Efectos?.EstablecerParticulas('Estrellas', 140);
    }

    this.Bus?.Emitir('entorno:cambiado', { preset: Id });
    this.Bus?.Emitir('luces:cambiadas', {});
  }

  /**
   * Traduce archivos `.json` exportados por *VRM Live Viewer*
   * (`dataType === 'Environment' | 'PostEffect' | 'CustomLight'`).
   */
  public ImportarJsonVRMLV(Texto: string, Efectos?: GestorEfectos): string {
    const Lineas = Texto.trim().split(/\r?\n/).filter((L) => L.trim().startsWith('{'));
    if (Lineas.length === 0) throw new Error('Archivo JSON vacío.');
    const Objetos = Lineas.map((L) => JSON.parse(L));
    const Primero = Objetos[0];
    const TipoDatos = String(Primero.dataType || '');

    if (TipoDatos === 'PostEffect' || (TipoDatos === 'Environment' && Primero.postEffect)) {
      const PE = TipoDatos === 'PostEffect' ? Primero : Primero.postEffect;
      const Habilitado = PE.enable !== false;
      this.EscenaSys.AplicarConfigPostProceso({
        BloomActivo: Habilitado && Boolean(PE.bloom?.enable),
        BloomFuerza: Limitar((PE.bloom?.intensity ?? 1.5) * 0.3, 0, 2.5),
        BloomUmbral: Limitar(PE.bloom?.threshold ?? 0.85, 0.2, 1.5),
        LensDirtActivo: Habilitado && Boolean(PE.bloom?.enableLensDirt),
        LensDirtTextura: '/assets/textures/LensDirt_Vertical.png',
        LensDirtIntensidad: Limitar((PE.bloom?.lensDirtIntensity ?? 100) / 300, 0, 1.5),
        DofActivo: Habilitado && Boolean(PE.depthOfField?.enable),
        DofModoAutoFocus: PE.depthOfField?.enableAutoFocus
          ? (PE.depthOfField?.autoFocusMode === 'MultipleCharacters' ? 'MultiPersonaje' : 'CabezaActivo')
          : 'Manual',
        DofDistancia: PE.depthOfField?.focusDistance ?? 2.0,
        DofOffset: PE.depthOfField?.autoFocusOffset ?? 0,
        DofApertura: Limitar(16 / Math.max(1.2, PE.depthOfField?.aperture ?? 8), 0.4, 6),
        VignetaActiva: Habilitado && Boolean(PE.vignette?.enable),
        VignetaColor: PE.vignette?.enableColor ? (PE.vignette?.color || '#000000') : '#000000',
        VignetaOscuridad: Limitar((PE.vignette?.intensity ?? 0.35) * 1.4, 0, 1.5),
        ColorGradingActivo: Habilitado && Boolean(PE.colorGrading?.enable),
        Temperatura: Limitar((PE.colorGrading?.temperature ?? 0) / 100, -1, 1),
        Tinte: Limitar((PE.colorGrading?.tint ?? 0) / 100, -1, 1),
        Saturacion: Limitar((PE.colorGrading?.saturation ?? 0) / 100, -1, 1),
        Contraste: Limitar((PE.colorGrading?.contrast ?? 0) / 100, -1, 1),
        AberracionActiva: Habilitado && Boolean(PE.chromaticAberration?.enable),
        RuidoActivo: Habilitado && Boolean(PE.grain?.enable),
        FxaaActivo: Habilitado && Boolean(PE.antiAliasing?.enable)
      });
      if (TipoDatos === 'PostEffect') {
        this.Bus?.Emitir('entorno:cambiado', {});
        return 'Post-procesado importado desde JSON de VRM Live Viewer.';
      }
    }

    if (TipoDatos === 'Environment') {
      const FloorKey = String(Primero.floor?.key || '');
      const HasWater = Array.isArray(Primero.waters) && Primero.waters.length > 0 && Primero.waters[0]?.visible !== false;
      const Piso: TipoPiso = HasWater
        ? 'Agua'
        : FloorKey.includes('reflection') ? 'Reflectivo'
        : FloorKey === 'none' ? 'Ninguno' : 'Rejilla';

      const SkyKey = String(Primero.sky?.key || '');
      const Cielo: TipoCielo = SkyKey.includes('dynamic_space') ? 'EspacioDinamico'
        : SkyKey.includes('moonshine') ? 'Noche'
        : SkyKey.includes('dynamic_simple') ? 'Atardecer' : 'Solido';

      const FogCfg = Primero.fog?.overlayFog?.enable
        ? Primero.fog.overlayFog
        : (Primero.fog?.globalFog?.enable ? Primero.fog.globalFog : null);

      if (Primero.light) {
        const L = Primero.light;
        this.EscenaSys.EstablecerLuzDireccional(L.enableMainLight === false ? 0 : (L.intensity ?? 1.2), L.color || '#ffffff');
        this.EscenaSys.EstablecerLuzAmbiental(L.ambientIntensity ?? 0.8, L.ambientColor || '#bfd0ff');
        this.EscenaSys.EstablecerLuzPersonaje(L.enableCharaLight !== false, L.charaLightIntensity ?? 0.85, L.charaLightColor || '#ffffff');
      }

      this.AplicarConfig({
        Piso,
        Cielo,
        ColorFondo: String(Primero.sky?.bgColor || '#141824').slice(0, 7),
        NieblaActiva: Boolean(Primero.fog?.enable && FogCfg),
        NieblaColor: String(FogCfg?.color || '#1b1e26').slice(0, 7),
        NieblaDensidad: Limitar((FogCfg?.density ?? 0.5) * 0.035, 0.002, 0.15)
      });

      if (Efectos && Array.isArray(Primero.effects) && Primero.effects.length > 0) {
        Efectos.LimpiarTodas();
        for (const Ef of Primero.effects.slice(0, 4)) {
          const K = String(Ef.key || '').toLowerCase();
          const TipoP: Exclude<TipoParticulas, 'Ninguno'> =
            K.includes('sakura') ? 'SakuraGlow' :
            K.includes('kira') ? 'KiraKira' :
            K.includes('kami') ? 'Confeti' : 'Chispas';
          Efectos.AgregarCapa({ Tipo: TipoP, Cantidad: 160, IntensidadEmision: 2.4 });
        }
      }

      this.Bus?.Emitir('entorno:cambiado', {});
      this.Bus?.Emitir('luces:cambiadas', {});
      return `Entorno "${Primero.stage?.values?.[0] || SkyKey || 'VRMLiveViewer'}" importado.`;
    }

    if (TipoDatos === 'CustomLight') {
      this.EscenaSys.LimpiarLucesEscenario();
      for (const Obj of Objetos) {
        const KV = new Map<string, string>();
        const Keys = Obj.light?.keys as string[] | undefined;
        const Vals = Obj.light?.values as string[] | undefined;
        if (Keys && Vals) {
          Keys.forEach((K, idx) => KV.set(K, Vals[idx]));
        }
        const VolOn = Obj.volumetric?.keys && Obj.volumetric?.values
          ? Obj.volumetric.values[Obj.volumetric.keys.indexOf('enable')] === 'True'
          : true;

        this.EscenaSys.AgregarLuzEscenario({
          Nombre: `Foco ${this.EscenaSys.LucesEscenario.length + 1}`,
          Activa: Obj.enable !== false,
          Tipo: KV.get('type') === 'Point' ? 'Point' : 'Spot',
          Color: (KV.get('color') || '#ffffff').slice(0, 7),
          Intensidad: Limitar((parseFloat(KV.get('intensity') || '2') || 2) * 16, 1, 150),
          Posicion: [
            parseFloat(KV.get('positionX') || '0') || 0,
            parseFloat(KV.get('positionY') || '3') || 3,
            -(parseFloat(KV.get('positionZ') || '-1.5') || -1.5)
          ],
          Objetivo: [0, 0.8, 0],
          AnguloDeg: Limitar(parseFloat(KV.get('spotAngle') || '28') || 28, 8, 70),
          Alcance: Limitar(parseFloat(KV.get('range') || '10') || 10, 3, 40),
          Volumetrica: VolOn,
          OpacidadHaz: 0.2
        });
      }
      this.Bus?.Emitir('luces:cambiadas', {});
      return `${Objetos.length} foco(s) de escenario importados.`;
    }

    throw new Error('Tipo de JSON de entorno/efecto no reconocido.');
  }

  public Actualizar(TiempoActual: number, Delta: number): void {
    this.TiempoAcumulado += Delta;
    if (this.AguaObj?.material?.uniforms['time']) {
      this.AguaObj.material.uniforms['time'].value += Delta * 0.48;
    }
    if (this.EspacioMat?.uniforms['uTime']) {
      this.EspacioMat.uniforms['uTime'].value = this.TiempoAcumulado;
    }
    if (this.VideoElem && Math.abs(this.VideoElem.currentTime - TiempoActual) > 0.25 && this.VideoElem.duration > 0) {
      this.VideoElem.currentTime = TiempoActual % this.VideoElem.duration;
    }
  }

  public Destruir(): void {
    this.LimpiarPisoActual();
    this.LimpiarCieloActual(false);
    this.EscenaSys.Escena.remove(this.GrupoPiso);
  }
}

// ============================================================================
// GestorEfectos.ts — Partículas Ambientales y Multi-Capa HDR
// Soporta múltiples capas simultáneas con emisión HDR (para Bloom),
// texturas personalizadas y anclaje directo a huesos del VRM.
// ============================================================================

import * as THREE from 'three';
import { GenerarId } from '../Utilidades';
import type { GestorModelos } from './GestorModelos';

export type TipoParticulas =
  | 'Ninguno'
  | 'Nieve'
  | 'Lluvia'
  | 'Petalos'
  | 'Chispas'
  | 'Burbujas'
  | 'Magia'
  | 'KiraKira'
  | 'SakuraGlow'
  | 'Estrellas'
  | 'Confeti';

export interface ConfiguracionCapaParticulas {
  Id: string;
  Nombre: string;
  Tipo: Exclude<TipoParticulas, 'Ninguno'>;
  Cantidad: number;
  Color: string;
  IntensidadEmision: number; // 1 = normal; >1 HDR con AdditiveBlending para activar Bloom
  Tamano: number;
  TexturaUrl?: string;
  AnclaHueso?: { PersonajeId: string | null; Hueso: string } | null;
  Activa: boolean;
}

interface CapaRuntime {
  Config: ConfiguracionCapaParticulas;
  Puntos: THREE.Points;
  Velocidades: Float32Array;
  Fases: Float32Array;
  OffsetsLocales: Float32Array;
  Aditiva: boolean;
}

interface PresetEstiloParticula {
  Color: string;
  Tamano: number;
  VelocidadY: [number, number];
  Vaiven: number;
  Emision: number;
  TexturaDefault?: string;
}

const ESTILOS: Record<Exclude<TipoParticulas, 'Ninguno'>, PresetEstiloParticula> = {
  Nieve:      { Color: '#ffffff', Tamano: 0.10, VelocidadY: [-0.9, -0.4], Vaiven: 0.35, Emision: 1.0 },
  Lluvia:     { Color: '#9fc3ff', Tamano: 0.05, VelocidadY: [-14, -10],   Vaiven: 0.0,  Emision: 1.0 },
  Petalos:    { Color: '#ffb7d5', Tamano: 0.12, VelocidadY: [-0.8, -0.5], Vaiven: 0.55, Emision: 1.1 },
  Chispas:    { Color: '#ffd977', Tamano: 0.09, VelocidadY: [0.6, 1.6],   Vaiven: 0.35, Emision: 2.2 },
  Burbujas:   { Color: '#ccffff', Tamano: 0.18, VelocidadY: [0.3, 0.8],   Vaiven: 0.20, Emision: 1.2 },
  Magia:      { Color: '#d88cff', Tamano: 0.08, VelocidadY: [-0.15, 0.35], Vaiven: 0.65, Emision: 2.5 },
  KiraKira:   { Color: '#88e8ff', Tamano: 0.22, VelocidadY: [0.05, 0.45], Vaiven: 0.40, Emision: 3.0, TexturaDefault: '/assets/textures/Star_base.png' },
  SakuraGlow: { Color: '#d27cff', Tamano: 0.16, VelocidadY: [-0.85, -0.35], Vaiven: 0.70, Emision: 2.2 },
  Estrellas:  { Color: '#ffdf6e', Tamano: 0.28, VelocidadY: [0.15, 0.75], Vaiven: 0.50, Emision: 2.8, TexturaDefault: '/assets/textures/Pentagram_emission.png' },
  Confeti:    { Color: '#ff8a5c', Tamano: 0.14, VelocidadY: [-1.4, -0.6], Vaiven: 0.85, Emision: 1.5 }
};

const CAJA = { X: 14, Y: 9, Z: 14 };
const CAJA_ANCLA = { X: 1.6, Y: 1.6, Z: 1.6 };

export class GestorEfectos {
  public Tipo: TipoParticulas = 'Ninguno';
  public Cantidad = 300;
  public Capas: CapaRuntime[] = [];

  private TexturaSuave: THREE.Texture | null = null;
  private CacheTexturas = new Map<string, THREE.Texture>();
  private TiempoAcumulado = 0;
  private readonly _PosAncla = new THREE.Vector3();

  constructor(private Escena: THREE.Scene) {}

  /** Compatibilidad clásica: reemplaza la capa principal (o todas) con un único preset. */
  public EstablecerParticulas(Tipo: TipoParticulas, Cantidad?: number): void {
    this.LimpiarTodas();
    this.Tipo = Tipo;
    if (Cantidad !== undefined) this.Cantidad = Cantidad;
    if (Tipo === 'Ninguno') return;

    const Estilo = ESTILOS[Tipo];
    this.AgregarCapa({
      Nombre: Tipo,
      Tipo,
      Cantidad: this.Cantidad,
      Color: Estilo.Color,
      IntensidadEmision: Estilo.Emision,
      Tamano: Estilo.Tamano,
      TexturaUrl: Estilo.TexturaDefault
    });
  }

  /** Agrega una nueva capa independiente de partículas (soporta múltiples simultáneas). */
  public AgregarCapa(Opciones: Partial<ConfiguracionCapaParticulas> & { Tipo: Exclude<TipoParticulas, 'Ninguno'> }): ConfiguracionCapaParticulas {
    const Estilo = ESTILOS[Opciones.Tipo];
    const Config: ConfiguracionCapaParticulas = {
      Id: Opciones.Id ?? GenerarId(),
      Nombre: Opciones.Nombre ?? Opciones.Tipo,
      Tipo: Opciones.Tipo,
      Cantidad: Opciones.Cantidad ?? 180,
      Color: Opciones.Color ?? Estilo.Color,
      IntensidadEmision: Opciones.IntensidadEmision ?? Estilo.Emision,
      Tamano: Opciones.Tamano ?? Estilo.Tamano,
      TexturaUrl: Opciones.TexturaUrl ?? Estilo.TexturaDefault,
      AnclaHueso: Opciones.AnclaHueso ?? null,
      Activa: Opciones.Activa ?? true
    };

    const EsAnclada = Boolean(Config.AnclaHueso);
    const Caja = EsAnclada ? CAJA_ANCLA : CAJA;
    const N = Config.Cantidad;
    const Posiciones = new Float32Array(N * 3);
    const OffsetsLocales = new Float32Array(N * 3);
    const Velocidades = new Float32Array(N * 3);
    const Fases = new Float32Array(N);

    for (let I = 0; I < N; I++) {
      const Ox = (Math.random() - 0.5) * Caja.X;
      const Oy = EsAnclada ? (Math.random() - 0.5) * Caja.Y : Math.random() * Caja.Y;
      const Oz = (Math.random() - 0.5) * Caja.Z;
      OffsetsLocales[I * 3] = Ox;
      OffsetsLocales[I * 3 + 1] = Oy;
      OffsetsLocales[I * 3 + 2] = Oz;
      Posiciones[I * 3] = Ox;
      Posiciones[I * 3 + 1] = Oy;
      Posiciones[I * 3 + 2] = Oz;

      Velocidades[I * 3] = (Math.random() - 0.5) * Estilo.Vaiven;
      Velocidades[I * 3 + 1] = Estilo.VelocidadY[0] + Math.random() * (Estilo.VelocidadY[1] - Estilo.VelocidadY[0]);
      Velocidades[I * 3 + 2] = (Math.random() - 0.5) * Estilo.Vaiven;
      Fases[I] = Math.random() * Math.PI * 2;
    }

    const Geometria = new THREE.BufferGeometry();
    Geometria.setAttribute('position', new THREE.BufferAttribute(Posiciones, 3));

    const ColorHdr = new THREE.Color(Config.Color).multiplyScalar(Math.max(0.2, Config.IntensidadEmision));
    const Aditiva = Config.IntensidadEmision > 1.15;

    const Material = new THREE.PointsMaterial({
      color: ColorHdr,
      size: EsAnclada ? Config.Tamano * 0.65 : Config.Tamano,
      map: this.ObtenerTextura(Config.TexturaUrl),
      transparent: true,
      opacity: Aditiva ? 0.92 : 0.88,
      depthWrite: false,
      blending: Aditiva ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true
    });

    const Puntos = new THREE.Points(Geometria, Material);
    Puntos.frustumCulled = false;
    Puntos.visible = Config.Activa;
    this.Escena.add(Puntos);

    this.Capas.push({ Config, Puntos, Velocidades, Fases, OffsetsLocales, Aditiva });
    if (this.Capas.length === 1) {
      this.Tipo = Config.Tipo;
      this.Cantidad = Config.Cantidad;
    }
    return Config;
  }

  /** Actualiza color/emisión/ancla/visibilidad de una capa existente en vivo. */
  public ActualizarCapa(Id: string, Parcial: Partial<ConfiguracionCapaParticulas>): void {
    const Runtime = this.Capas.find((C) => C.Config.Id === Id);
    if (!Runtime) return;
    Object.assign(Runtime.Config, Parcial);

    Runtime.Puntos.visible = Runtime.Config.Activa;
    const Mat = Runtime.Puntos.material as THREE.PointsMaterial;
    Mat.color.set(Runtime.Config.Color).multiplyScalar(Math.max(0.2, Runtime.Config.IntensidadEmision));
    Mat.size = Runtime.Config.AnclaHueso ? Runtime.Config.Tamano * 0.65 : Runtime.Config.Tamano;
    if (Parcial.TexturaUrl !== undefined) {
      Mat.map = this.ObtenerTextura(Runtime.Config.TexturaUrl);
      Mat.needsUpdate = true;
    }
  }

  /** Elimina una capa específica liberando GPU. */
  public EliminarCapa(Id: string): void {
    const Idx = this.Capas.findIndex((C) => C.Config.Id === Id);
    if (Idx < 0) return;
    const Runtime = this.Capas[Idx];
    this.Escena.remove(Runtime.Puntos);
    Runtime.Puntos.geometry.dispose();
    (Runtime.Puntos.material as THREE.Material).dispose();
    this.Capas.splice(Idx, 1);
    if (this.Capas.length === 0) this.Tipo = 'Ninguno';
  }

  /** Elimina todas las partículas (método clásico conservado). */
  public QuitarParticulas(): void {
    this.LimpiarTodas();
    this.Tipo = 'Ninguno';
  }

  public LimpiarTodas(): void {
    for (const Runtime of this.Capas) {
      this.Escena.remove(Runtime.Puntos);
      Runtime.Puntos.geometry.dispose();
      (Runtime.Puntos.material as THREE.Material).dispose();
    }
    this.Capas = [];
  }

  /** Avanza todas las capas activas, siguiendo huesos anclados cuando corresponda. */
  public Actualizar(Delta: number, Modelos?: GestorModelos): void {
    if (this.Capas.length === 0) return;
    this.TiempoAcumulado += Delta;

    for (const Runtime of this.Capas) {
      if (!Runtime.Config.Activa) continue;

      const Atributo = Runtime.Puntos.geometry.getAttribute('position') as THREE.BufferAttribute;
      const Pos = Atributo.array as Float32Array;
      const Off = Runtime.OffsetsLocales;
      const Vel = Runtime.Velocidades;
      const Fases = Runtime.Fases;
      const N = Pos.length / 3;

      let TieneAncla = false;
      if (Runtime.Config.AnclaHueso && Modelos) {
        const W = Modelos.ObtenerPosicionMundoHueso(
          Runtime.Config.AnclaHueso.Hueso,
          Runtime.Config.AnclaHueso.PersonajeId,
          this._PosAncla
        );
        TieneAncla = Boolean(W);
      }

      const Caja = TieneAncla ? CAJA_ANCLA : CAJA;
      const Cx = TieneAncla ? this._PosAncla.x : 0;
      const Cy = TieneAncla ? this._PosAncla.y : 0;
      const Cz = TieneAncla ? this._PosAncla.z : 0;

      for (let I = 0; I < N; I++) {
        const Vaiven = Math.sin(this.TiempoAcumulado * 1.6 + Fases[I]) * 0.3;
        Off[I * 3] += (Vel[I * 3] + Vaiven * Math.abs(Vel[I * 3])) * Delta;
        Off[I * 3 + 1] += Vel[I * 3 + 1] * Delta;
        Off[I * 3 + 2] += Vel[I * 3 + 2] * Delta;

        if (TieneAncla) {
          if (Off[I * 3 + 1] < -Caja.Y / 2) Off[I * 3 + 1] = Caja.Y / 2;
          if (Off[I * 3 + 1] > Caja.Y / 2) Off[I * 3 + 1] = -Caja.Y / 2;
        } else {
          if (Off[I * 3 + 1] < 0) Off[I * 3 + 1] = Caja.Y;
          if (Off[I * 3 + 1] > Caja.Y) Off[I * 3 + 1] = 0;
        }
        if (Off[I * 3] > Caja.X / 2) Off[I * 3] = -Caja.X / 2;
        if (Off[I * 3] < -Caja.X / 2) Off[I * 3] = Caja.X / 2;
        if (Off[I * 3 + 2] > Caja.Z / 2) Off[I * 3 + 2] = -Caja.Z / 2;
        if (Off[I * 3 + 2] < -Caja.Z / 2) Off[I * 3 + 2] = Caja.Z / 2;

        Pos[I * 3] = Cx + Off[I * 3];
        Pos[I * 3 + 1] = Cy + Off[I * 3 + 1];
        Pos[I * 3 + 2] = Cz + Off[I * 3 + 2];
      }
      Atributo.needsUpdate = true;
    }
  }

  private ObtenerTextura(Url?: string): THREE.Texture {
    if (!Url) return this.ObtenerTexturaSuave();
    let Tex = this.CacheTexturas.get(Url);
    if (!Tex) {
      Tex = new THREE.TextureLoader().load(Url);
      Tex.colorSpace = THREE.SRGBColorSpace;
      this.CacheTexturas.set(Url, Tex);
    }
    return Tex;
  }

  private ObtenerTexturaSuave(): THREE.Texture {
    if (this.TexturaSuave) return this.TexturaSuave;
    const Lienzo = document.createElement('canvas');
    Lienzo.width = Lienzo.height = 64;
    const Contexto = Lienzo.getContext('2d')!;
    const Gradiente = Contexto.createRadialGradient(32, 32, 0, 32, 32, 32);
    Gradiente.addColorStop(0, 'rgba(255,255,255,1)');
    Gradiente.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    Gradiente.addColorStop(1, 'rgba(255,255,255,0)');
    Contexto.fillStyle = Gradiente;
    Contexto.fillRect(0, 0, 64, 64);
    const Textura = new THREE.CanvasTexture(Lienzo);
    Textura.colorSpace = THREE.SRGBColorSpace;
    this.TexturaSuave = Textura;
    return Textura;
  }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GestorModelos } from './GestorModelos';
import type { BusEventos } from '../Arquitectura/BusEventos';

/**
 * Prop 3D (formato GLB/GLTF) colocado en el escenario o adjunto directamente a un hueso de un personaje VRM.
 */
export interface PropEscena {
  Id: string;
  Nombre: string;
  RutaOrigen?: string;
  Objeto: THREE.Group;
  Mixer: THREE.AnimationMixer | null;
  ClipActivo: THREE.AnimationAction | null;
  TieneAnimacionGlb: boolean;
  PersonajeId: string | null;
  Hueso: string | null;
  ColorEmision: string;
  IntensidadEmision: number;
  Visible: boolean;
}

export interface PresetProp {
  Id: string;
  Nombre: string;
  Url: string;
  HuesoSugerido: string | null;
  IntensidadEmisionInicial: number;
}

export const PRESETS_PROPS: PresetProp[] = [
  {
    Id: 'hand_emission_bar',
    Nombre: 'Barra Luminosa de Mano',
    Url: '/assets/props/HandEmissionBar.glb',
    HuesoSugerido: 'rightHand',
    IntensidadEmisionInicial: 2.5,
  },
  {
    Id: 'circle_stand_1m',
    Nombre: 'Podio Circular 1m',
    Url: '/assets/props/CircleStand_1m.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.0,
  },
  {
    Id: 'circle_stand_updown',
    Nombre: 'Podio Elevador Animado',
    Url: '/assets/props/CircleStand_EasingUpDown.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.0,
  },
  {
    Id: 'grid_light_box',
    Nombre: 'Caja de Luz Rejilla',
    Url: '/assets/props/Grid_Light_Box.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.8,
  },
  {
    Id: 'rotate_cw_10s',
    Nombre: 'Aro Rotación Horaria',
    Url: '/assets/props/Rotate_Clockwise_10s.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.4,
  },
  {
    Id: 'rotate_ccw_10s',
    Nombre: 'Aro Rotación Anti-Horaria',
    Url: '/assets/props/Rotate_Anti-Clockwise_10s.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.4,
  },
  {
    Id: 'reciprocate_10s',
    Nombre: 'Prop Vaivén 10s',
    Url: '/assets/props/Reciprocate_10s.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.2,
  },
  {
    Id: 'wipe_30deg_10s',
    Nombre: 'Barrido Haz 30°',
    Url: '/assets/props/Wipe_30deg_10s.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.5,
  },
  {
    Id: 'wipe_45deg_10s',
    Nombre: 'Barrido Haz 45°',
    Url: '/assets/props/Wipe_45deg_10s.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.5,
  },
  {
    Id: 'quad_panel',
    Nombre: 'Plano / Pantalla FX',
    Url: '/assets/props/Quad.glb',
    HuesoSugerido: null,
    IntensidadEmisionInicial: 1.0,
  },
];

interface MetadatosMaterialOriginal {
  EmissiveHex: number;
  EmissiveIntensity: number;
  TenidoEmision: boolean;
}

/**
 * Administra props 3D GLB/GLTF del estudio: carga, adjunto jerárquico a huesos VRM,
 * brillo HDR compatible con Bloom y animaciones embebidas.
 */
export class GestorProps {
  private Escena: THREE.Scene;
  private Bus?: BusEventos;
  private Cargador = new GLTFLoader();
  private Props: PropEscena[] = [];
  public PropActivoId: string | null = null;
  private SecuenciaId = 1;

  constructor(Escena: THREE.Scene, Bus?: BusEventos) {
    this.Escena = Escena;
    this.Bus = Bus;
  }

  public SeleccionarProp(Id: string | null): void {
    this.PropActivoId = Id;
    this.EmitirCambio();
  }

  public ObtenerProps(): PropEscena[] {
    return this.Props;
  }

  public ObtenerProp(Id: string): PropEscena | undefined {
    return this.Props.find((P) => P.Id === Id);
  }

  public BuscarPropPorObjeto(Objeto: THREE.Object3D | null): PropEscena | undefined {
    if (!Objeto) return undefined;
    let Actual: THREE.Object3D | null = Objeto;
    while (Actual) {
      const Encontrado = this.Props.find((P) => P.Objeto === Actual);
      if (Encontrado) return Encontrado;
      Actual = Actual.parent;
    }
    return undefined;
  }

  public async CargarDesdeUrl(
    Url: string,
    NombreOpcional?: string,
    Opciones?: {
      Modelos?: GestorModelos;
      PersonajeId?: string | null;
      Hueso?: string | null;
      IntensidadEmision?: number;
      ColorEmision?: string;
    }
  ): Promise<PropEscena> {
    const Gltf = await this.Cargador.loadAsync(Url);
    const Nombre = NombreOpcional ?? (Url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') || 'Prop 3D');
    return this.RegistrarGltf(Gltf.scene, Gltf.animations, Nombre, Url, Opciones);
  }

  public async CargarDesdeArchivo(
    Archivo: File,
    Opciones?: {
      Modelos?: GestorModelos;
      PersonajeId?: string | null;
      Hueso?: string | null;
      IntensidadEmision?: number;
      ColorEmision?: string;
    }
  ): Promise<PropEscena> {
    const UrlTemporal = URL.createObjectURL(Archivo);
    try {
      const Gltf = await this.Cargador.loadAsync(UrlTemporal);
      const Nombre = Archivo.name.replace(/\.(glb|gltf)$/i, '');
      return this.RegistrarGltf(Gltf.scene, Gltf.animations, Nombre, Archivo.name, Opciones);
    } finally {
      URL.revokeObjectURL(UrlTemporal);
    }
  }

  private RegistrarGltf(
    RaizGltf: THREE.Group,
    Animaciones: THREE.AnimationClip[],
    Nombre: string,
    RutaOrigen: string,
    Opciones?: {
      Modelos?: GestorModelos;
      PersonajeId?: string | null;
      Hueso?: string | null;
      IntensidadEmision?: number;
      ColorEmision?: string;
    }
  ): PropEscena {
    const Id = `prop_${this.SecuenciaId++}`;
    const Contenedor = new THREE.Group();
    Contenedor.name = `Prop_${Nombre}_${Id}`;
    Contenedor.userData.PropId = Id;
    Contenedor.add(RaizGltf);

    let PrimerColorEmision = Opciones?.ColorEmision ?? '#38bdf8';
    let DetectoEmisionReal = false;

    RaizGltf.traverse((Obj) => {
      if ((Obj as THREE.Mesh).isMesh) {
        const Malla = Obj as THREE.Mesh;
        Malla.castShadow = true;
        Malla.receiveShadow = true;
        Malla.userData.PropId = Id;

        const Mats = Array.isArray(Malla.material) ? Malla.material : [Malla.material];
        for (const Mat of Mats) {
          if (Mat && (Mat instanceof THREE.MeshStandardMaterial || Mat instanceof THREE.MeshPhysicalMaterial)) {
            const ColorOriginal = Mat.emissive ? Mat.emissive.getHex() : 0x000000;
            const TieneEmision = ColorOriginal !== 0x000000 || Mat.emissiveMap !== null;
            if (TieneEmision && !DetectoEmisionReal && ColorOriginal !== 0x000000) {
              PrimerColorEmision = `#${Mat.emissive.getHexString()}`;
              DetectoEmisionReal = true;
            }
            Mat.userData._OrigEmision = {
              EmissiveHex: ColorOriginal,
              EmissiveIntensity: Mat.emissiveIntensity ?? 1,
              TenidoEmision: TieneEmision,
            } satisfies MetadatosMaterialOriginal;
          }
        }
      }
    });

    let Mixer: THREE.AnimationMixer | null = null;
    let ClipActivo: THREE.AnimationAction | null = null;
    if (Animaciones && Animaciones.length > 0) {
      Mixer = new THREE.AnimationMixer(RaizGltf);
      ClipActivo = Mixer.clipAction(Animaciones[0]);
      ClipActivo.play();
    }

    const Prop: PropEscena = {
      Id,
      Nombre,
      RutaOrigen,
      Objeto: Contenedor,
      Mixer,
      ClipActivo,
      TieneAnimacionGlb: Animaciones.length > 0,
      PersonajeId: null,
      Hueso: null,
      ColorEmision: PrimerColorEmision,
      IntensidadEmision: Opciones?.IntensidadEmision ?? 1.0,
      Visible: true,
    };

    this.Props.push(Prop);
    this.PropActivoId = Prop.Id;
    this.Escena.add(Contenedor);

    if (Opciones?.Modelos && Opciones.PersonajeId && Opciones.Hueso) {
      this.AdjuntarAHueso(Id, Opciones.PersonajeId, Opciones.Hueso, Opciones.Modelos);
    }

    if (Prop.IntensidadEmision !== 1.0 || Opciones?.ColorEmision) {
      this.EstablecerEmision(Id, Prop.ColorEmision, Prop.IntensidadEmision);
    }

    this.EmitirCambio();
    return Prop;
  }

  /**
   * Adjunta el prop directamente como hijo de un hueso humanoide del personaje (en espacio local del hueso),
   * o lo devuelve al espacio mundial de la escena cuando PersonajeId o Hueso son nulos.
   */
  public AdjuntarAHueso(
    PropId: string,
    PersonajeId: string | null,
    Hueso: string | null,
    Modelos: GestorModelos
  ): boolean {
    const Prop = this.ObtenerProp(PropId);
    if (!Prop) return false;

    if (PersonajeId && Hueso) {
      const Personaje = Modelos.ObtenerPersonaje(PersonajeId);
      const Humanoide = Personaje?.Vrm.humanoid;
      const NodoHueso =
        Humanoide?.getNormalizedBoneNode(Hueso as never) ??
        Humanoide?.getRawBoneNode(Hueso as never) ??
        null;

      if (NodoHueso) {
        NodoHueso.add(Prop.Objeto);
        Prop.Objeto.position.set(0, 0, 0);
        Prop.Objeto.rotation.set(0, 0, 0);
        Prop.Objeto.scale.set(1, 1, 1);
        Prop.PersonajeId = PersonajeId;
        Prop.Hueso = Hueso;
        this.EmitirCambio();
        return true;
      }
    }

    this.Escena.attach(Prop.Objeto);
    Prop.PersonajeId = null;
    Prop.Hueso = null;
    this.EmitirCambio();
    return false;
  }

  public EstablecerEmision(PropId: string, ColorHex: string, Intensidad: number): void {
    const Prop = this.ObtenerProp(PropId);
    if (!Prop) return;
    Prop.ColorEmision = ColorHex;
    Prop.IntensidadEmision = Math.max(0, Math.min(12, Intensidad));

    const ColorEmisivo = new THREE.Color(ColorHex);
    Prop.Objeto.traverse((Obj) => {
      if ((Obj as THREE.Mesh).isMesh) {
        const Malla = Obj as THREE.Mesh;
        const Mats = Array.isArray(Malla.material) ? Malla.material : [Malla.material];
        for (const Mat of Mats) {
          if (Mat && (Mat instanceof THREE.MeshStandardMaterial || Mat instanceof THREE.MeshPhysicalMaterial)) {
            const Meta = Mat.userData._OrigEmision as MetadatosMaterialOriginal | undefined;
            if (!Meta || Meta.TenidoEmision || Intensidad > 1.01) {
              Mat.emissive.copy(ColorEmisivo);
              Mat.emissiveIntensity = Prop.IntensidadEmision;
            } else {
              Mat.emissive.setHex(Meta.EmissiveHex);
              Mat.emissiveIntensity = Meta.EmissiveIntensity * Prop.IntensidadEmision;
            }
          }
        }
      }
    });

    this.EmitirCambio();
  }

  public EstablecerVisibilidad(PropId: string, Visible: boolean): void {
    const Prop = this.ObtenerProp(PropId);
    if (!Prop) return;
    Prop.Visible = Visible;
    Prop.Objeto.visible = Visible;
    this.EmitirCambio();
  }

  public LimpiarPersonaje(PersonajeId: string): void {
    let HuboCambio = false;
    for (const Prop of this.Props) {
      if (Prop.PersonajeId === PersonajeId) {
        this.Escena.attach(Prop.Objeto);
        Prop.PersonajeId = null;
        Prop.Hueso = null;
        HuboCambio = true;
      }
    }
    if (HuboCambio) this.EmitirCambio();
  }

  public EliminarProp(PropId: string, DesacoplarGizmoSiEsObjetivo?: (Obj: THREE.Object3D) => void): boolean {
    const Indice = this.Props.findIndex((P) => P.Id === PropId);
    if (Indice === -1) return false;

    const Prop = this.Props[Indice];
    DesacoplarGizmoSiEsObjetivo?.(Prop.Objeto);

    if (Prop.Mixer) {
      Prop.Mixer.stopAllAction();
      Prop.Mixer.uncacheRoot(Prop.Objeto);
    }

    Prop.Objeto.removeFromParent();
    Prop.Objeto.traverse((Obj) => {
      if ((Obj as THREE.Mesh).isMesh) {
        const Malla = Obj as THREE.Mesh;
        Malla.geometry?.dispose();
        const Mats = Array.isArray(Malla.material) ? Malla.material : [Malla.material];
        for (const Mat of Mats) {
          Mat?.dispose();
        }
      }
    });

    this.Props.splice(Indice, 1);
    if (this.PropActivoId === PropId) {
      this.PropActivoId = this.Props[0]?.Id ?? null;
    }
    this.EmitirCambio();
    return true;
  }

  public Actualizar(Delta: number, TiempoAbsoluto?: number): void {
    for (const Prop of this.Props) {
      if (!Prop.Visible || !Prop.Mixer) continue;
      if (TiempoAbsoluto !== undefined) {
        Prop.Mixer.setTime(TiempoAbsoluto);
      } else {
        Prop.Mixer.update(Delta);
      }
    }
  }

  private EmitirCambio(): void {
    this.Bus?.Emitir('props:cambiados', {
      cantidad: this.Props.length,
      activoId: this.PropActivoId
    });
  }
}

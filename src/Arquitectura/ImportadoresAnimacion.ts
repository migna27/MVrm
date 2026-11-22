// ============================================================================
// ImportadoresAnimacion.ts — Patrones Strategy y Facade para importar animaciones
// Soporta .vrma, .json (animaciones/poses/proyectos), .bvh y .glb/.gltf con
// reasignación al tiempo destino, escalado temporal y simplificación RDP.
// ============================================================================

import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ContextoAplicacion } from '../Contexto';
import {
  ClaveAnimacion, GrupoPista, OpcionesImportacionAnimacion, PistaAnimacion,
  ResultadoImportacion, VistaPreviaImportacion
} from '../Tipos';
import { NOMBRES_HUESOS, NOMBRES_HUESOS_LEGIBLES } from '../Nucleo/GestorModelos';
import { GenerarId, LeerArchivoTexto, Limitar } from '../Utilidades';
import { ComandoImportarAnimacion } from './ComandosAnimacion';
import { ImportadorVmd } from './ImportadorVmd';

/** Estrategia común para cualquier formato de animación importable. */
export interface EstrategiaImportacion {
  readonly NombreFormato: string;
  readonly Extensiones: string[];
  PuedeImportar(archivo: File): boolean;
  Previsualizar(archivo: File, ctx: ContextoAplicacion): Promise<VistaPreviaImportacion>;
  Importar(archivo: File, opciones: OpcionesImportacionAnimacion, ctx: ContextoAplicacion): Promise<ResultadoImportacion>;
}

/** Mapa de equivalencias normalizadas (Mixamo / CMU / BVH / VRM) → hueso VRM. */
const ALIAS_HUESOS_MOCAP: Record<string, string> = {
  hips: 'hips', pelvis: 'hips', root: 'hips',
  spine: 'spine', spine0: 'spine', abdomen: 'spine', lowerback: 'spine',
  chest: 'chest', spine1: 'chest', torso: 'chest',
  upperchest: 'upperChest', spine2: 'upperChest', ribcage: 'upperChest',
  neck: 'neck', neck1: 'neck',
  head: 'head',
  leftshoulder: 'leftShoulder', lcollar: 'leftShoulder', leftclavicle: 'leftShoulder',
  leftupperarm: 'leftUpperArm', leftarm: 'leftUpperArm', lshldr: 'leftUpperArm', leftshoulderarm: 'leftUpperArm',
  leftlowerarm: 'leftLowerArm', leftforearm: 'leftLowerArm', lforearm: 'leftLowerArm', leftelbow: 'leftLowerArm',
  lefthand: 'leftHand', lhand: 'leftHand', leftwrist: 'leftHand',
  rightshoulder: 'rightShoulder', rcollar: 'rightShoulder', rightclavicle: 'rightShoulder',
  rightupperarm: 'rightUpperArm', rightarm: 'rightUpperArm', rshldr: 'rightUpperArm', rightshoulderarm: 'rightUpperArm',
  rightlowerarm: 'rightLowerArm', rightforearm: 'rightLowerArm', rforearm: 'rightLowerArm', rightelbow: 'rightLowerArm',
  righthand: 'rightHand', rhand: 'rightHand', rightwrist: 'rightHand',
  leftupperleg: 'leftUpperLeg', leftupleg: 'leftUpperLeg', lthigh: 'leftUpperLeg', lefthip: 'leftUpperLeg', leftthigh: 'leftUpperLeg',
  leftlowerleg: 'leftLowerLeg', leftleg: 'leftLowerLeg', lshin: 'leftLowerLeg', leftknee: 'leftLowerLeg', leftshin: 'leftLowerLeg',
  leftfoot: 'leftFoot', lfoot: 'leftFoot', leftankle: 'leftFoot',
  lefttoes: 'leftToes', lefttoebase: 'leftToes', ltoe: 'leftToes', lefttoe: 'leftToes',
  rightupperleg: 'rightUpperLeg', rightupleg: 'rightUpperLeg', rthigh: 'rightUpperLeg', righthip: 'rightUpperLeg', rightthigh: 'rightUpperLeg',
  rightlowerleg: 'rightLowerLeg', rightleg: 'rightLowerLeg', rshin: 'rightLowerLeg', rightknee: 'rightLowerLeg', rightshin: 'rightLowerLeg',
  rightfoot: 'rightFoot', rfoot: 'rightFoot', rightankle: 'rightFoot',
  righttoes: 'rightToes', righttoebase: 'rightToes', rtoe: 'rightToes', righttoe: 'rightToes'
};

function NormalizarNombreHueso(raw: string): string | null {
  const Exacto = NOMBRES_HUESOS.find((H) => H.toLowerCase() === raw.toLowerCase());
  if (Exacto) return Exacto;

  const SinPrefijo = raw
    .replace(/^mixamorig[\d]*[:_]?/i, '')
    .replace(/^armature[|_/:]/i, '')
    .replace(/^bip\d*[_\s]*/i, '')
    .replace(/\.quaternion$|\.position$/i, '');

  const Limpio = SinPrefijo.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ALIAS_HUESOS_MOCAP[Limpio]) return ALIAS_HUESOS_MOCAP[Limpio];

  for (const Hueso of NOMBRES_HUESOS) {
    if (Limpio.endsWith(Hueso.toLowerCase())) return Hueso;
  }
  return null;
}

function TransformarPistasImportadas(
  pistas: PistaAnimacion[],
  opciones: OpcionesImportacionAnimacion,
  ctx: ContextoAplicacion,
  normalizarAlInicio: boolean
): { Pistas: PistaAnimacion[]; ClavesOriginales: number; ClavesFinales: number; DuracionClip: number } {
  const Escala = Limitar(opciones.EscalaTiempo || 1, 0.1, 8);
  let TiempoMin = Infinity;
  if (normalizarAlInicio) {
    for (const P of pistas) {
      for (const C of P.Claves) {
        if (C.Tiempo < TiempoMin) TiempoMin = C.Tiempo;
      }
    }
  }
  if (!Number.isFinite(TiempoMin)) TiempoMin = 0;

  let ClavesOriginales = 0;
  let ClavesFinales = 0;
  let MaxRelativo = 0;
  const Prefijo = ctx.Animacion.NombreGrupo(opciones.GrupoDestino);
  const Resultado: PistaAnimacion[] = [];

  for (const P of pistas) {
    ClavesOriginales += P.Claves.length;
    const ClavesReescaladas: ClaveAnimacion[] = P.Claves.map((C) => {
      const Rel = Math.max(0, (C.Tiempo - TiempoMin) * Escala);
      if (Rel > MaxRelativo) MaxRelativo = Rel;
      return {
        Id: GenerarId(),
        Tiempo: Math.max(0, opciones.TiempoInicio + Rel),
        Valor: [...C.Valor],
        Interpolacion: C.Interpolacion ?? ctx.Estado.InterpolacionPorDefecto
      };
    }).sort((A, B) => A.Tiempo - B.Tiempo);

    const Finales = opciones.Simplificar
      ? ctx.Animacion.SimplificarClaves(ClavesReescaladas, opciones.ToleranciaSimplificacion)
      : ClavesReescaladas;

    ClavesFinales += Finales.length;
    const EsPorPers = P.Tipo === 'HuesoRotacion' || P.Tipo === 'HuesoPosicion' || P.Tipo === 'Expresion';
    const DestPersId = EsPorPers
      ? (P.PersonajeId ?? opciones.PersonajeId ?? ctx.Modelos.PersonajeActivoId ?? undefined)
      : undefined;
    const PersObj = DestPersId ? ctx.Modelos.ObtenerPersonaje(DestPersId) : null;
    const PrefijoPers = PersObj && ctx.Modelos.Personajes.length > 1
      ? `[${PersObj.Nombre.replace(/\.vrm$/i, '').slice(0, 12)}] `
      : '';
    const NombreObjetivo = P.Tipo === 'HuesoPosicion'
      ? `Posición ${NOMBRES_HUESOS_LEGIBLES[P.Objetivo] ?? P.Objetivo}`
      : (NOMBRES_HUESOS_LEGIBLES[P.Objetivo] ?? P.Objetivo);

    Resultado.push({
      Id: GenerarId(),
      Nombre: `${PrefijoPers}${Prefijo} · ${NombreObjetivo}`,
      Tipo: P.Tipo,
      Objetivo: P.Objetivo,
      Grupo: opciones.GrupoDestino,
      ...(DestPersId ? { PersonajeId: DestPersId } : {}),
      Claves: Finales
    });
  }

  return {
    Pistas: Resultado,
    ClavesOriginales,
    ClavesFinales,
    DuracionClip: MaxRelativo / Escala
  };
}

/** Caché por archivo para no re-parsear entre vista previa e importación final. */
interface EntradaCacheImportacion {
  clip?: THREE.AnimationClip;
  vrmRef?: unknown;
  json?: any;
  bvh?: { clip: THREE.AnimationClip; skeleton: THREE.Skeleton };
  gltfClip?: THREE.AnimationClip;
}

const CacheArchivosImportacion = new WeakMap<File, EntradaCacheImportacion>();

function ObtenerEntradaCache(archivo: File): EntradaCacheImportacion {
  let Entrada = CacheArchivosImportacion.get(archivo);
  if (!Entrada) {
    Entrada = {};
    CacheArchivosImportacion.set(archivo, Entrada);
  }
  return Entrada;
}

// ----------------------------------------------------------------------------
// Estrategia 1: VRMA (.vrma)
// ----------------------------------------------------------------------------

class ImportadorVrma implements EstrategiaImportacion {
  public readonly NombreFormato = 'VRMA (VRM Animation)';
  public readonly Extensiones = ['.vrma'];

  public PuedeImportar(archivo: File): boolean {
    return archivo.name.toLowerCase().endsWith('.vrma');
  }

  private async ObtenerClip(archivo: File, ctx: ContextoAplicacion, personajeId?: string): Promise<THREE.AnimationClip> {
    const Pers = ctx.Modelos.ObtenerPersonaje(personajeId);
    if (!Pers) {
      throw new Error('Carga primero un modelo VRM antes de importar un archivo .vrma.');
    }
    const Cache = ObtenerEntradaCache(archivo);
    if (!Cache.clip || Cache.vrmRef !== Pers.Vrm) {
      Cache.clip = await ctx.Modelos.CargarAnimacionVrma(archivo, Pers.Id);
      Cache.vrmRef = Pers.Vrm;
    }
    return Cache.clip;
  }

  public async Previsualizar(archivo: File, ctx: ContextoAplicacion): Promise<VistaPreviaImportacion> {
    const Clip = await this.ObtenerClip(archivo, ctx);
    const Duracion = Math.max(0.1, Clip.duration);
    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Duracion,
      TotalPistas: Clip.tracks.length,
      TotalClavesEstimado: Math.round(Duracion * 24) * Math.max(1, Clip.tracks.length)
    };
  }

  public async Importar(
    archivo: File,
    opciones: OpcionesImportacionAnimacion,
    ctx: ContextoAplicacion
  ): Promise<ResultadoImportacion> {
    const Clip = await this.ObtenerClip(archivo, ctx, opciones.PersonajeId);
    const PistasHorneadas = ctx.Animacion.HornearClip(
      Clip,
      opciones.FpsMuestreo,
      opciones.GrupoDestino,
      false,
      opciones.PersonajeId
    );
    const Res = TransformarPistasImportadas(PistasHorneadas, opciones, ctx, false);
    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Pistas: Res.Pistas,
      DuracionClip: Math.max(0.1, Clip.duration),
      ClavesOriginales: Res.ClavesOriginales,
      ClavesFinales: Res.ClavesFinales
    };
  }
}

// ----------------------------------------------------------------------------
// Estrategia 2: JSON nativo de pistas / poses (.json)
// ----------------------------------------------------------------------------

class ImportadorJson implements EstrategiaImportacion {
  public readonly NombreFormato = 'Animación / Pose JSON';
  public readonly Extensiones = ['.json'];

  public PuedeImportar(archivo: File): boolean {
    return archivo.name.toLowerCase().endsWith('.json');
  }

  private async ObtenerDatos(archivo: File): Promise<any> {
    const Cache = ObtenerEntradaCache(archivo);
    if (!Cache.json) {
      Cache.json = JSON.parse(await LeerArchivoTexto(archivo));
    }
    return Cache.json;
  }

  public async Previsualizar(archivo: File): Promise<VistaPreviaImportacion> {
    const Datos = await this.ObtenerDatos(archivo);
    if (!Array.isArray(Datos.Pistas)) {
      throw new Error('El archivo JSON no contiene un arreglo de "Pistas" válido.');
    }
    const Pistas = Datos.Pistas as PistaAnimacion[];
    let TMin = Infinity;
    let TMax = 0;
    let TotalClaves = 0;
    for (const P of Pistas) {
      TotalClaves += P.Claves?.length ?? 0;
      for (const C of P.Claves ?? []) {
        if (C.Tiempo < TMin) TMin = C.Tiempo;
        if (C.Tiempo > TMax) TMax = C.Tiempo;
      }
    }
    const Duracion = Number.isFinite(TMin) ? Math.max(0.25, TMax - TMin) : (Datos.Duracion ?? 1);
    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Duracion,
      TotalPistas: Pistas.length,
      TotalClavesEstimado: TotalClaves
    };
  }

  public async Importar(
    archivo: File,
    opciones: OpcionesImportacionAnimacion,
    ctx: ContextoAplicacion
  ): Promise<ResultadoImportacion> {
    const Datos = await this.ObtenerDatos(archivo);
    if (!Array.isArray(Datos.Pistas)) {
      throw new Error('Formato JSON no reconocido.');
    }
    const PistasCrudas = Datos.Pistas as PistaAnimacion[];
    const Res = TransformarPistasImportadas(PistasCrudas, opciones, ctx, true);
    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Pistas: Res.Pistas,
      DuracionClip: Math.max(0.25, Res.DuracionClip),
      ClavesOriginales: Res.ClavesOriginales,
      ClavesFinales: Res.ClavesFinales
    };
  }
}

// ----------------------------------------------------------------------------
// Estrategia 3: BVH Mocap (.bvh)
// ----------------------------------------------------------------------------

function ExtraerPistasDesdeClip(
  clip: THREE.AnimationClip,
  fpsMuestreo: number,
  grupo: GrupoPista,
  escalaPosicion: number
): PistaAnimacion[] {
  const Duracion = Math.max(0.05, clip.duration);
  const Muestras = Math.max(2, Math.round(Duracion * fpsMuestreo) + 1);
  const Pistas: PistaAnimacion[] = [];
  const Euler = new THREE.Euler();
  const Quat = new THREE.Quaternion();
  const HuesosYaMapeados = new Set<string>();

  for (const Track of clip.tracks) {
    const Partes = Track.name.split('.');
    const Propiedad = Partes[Partes.length - 1];
    const NombreCrudo = Partes.slice(0, -1).join('.');
    const HuesoVrm = NormalizarNombreHueso(NombreCrudo);
    if (!HuesoVrm) continue;

    if (Propiedad === 'quaternion' && !HuesosYaMapeados.has(`rot:${HuesoVrm}`)) {
      HuesosYaMapeados.add(`rot:${HuesoVrm}`);
      const Interpolante = Track.createInterpolant();
      const Claves: ClaveAnimacion[] = [];

      for (let I = 0; I < Muestras; I++) {
        const T = Math.min(Duracion, I / fpsMuestreo);
        const V = Interpolante.evaluate(T);
        Quat.set(V[0], V[1], V[2], V[3]).normalize();
        Euler.setFromQuaternion(Quat, 'XYZ');
        Claves.push({ Id: GenerarId(), Tiempo: T, Valor: [Euler.x, Euler.y, Euler.z], Interpolacion: 'Suave' });
      }

      const Varia = Claves.some((C) =>
        Math.abs(C.Valor[0] - Claves[0].Valor[0]) > 0.01 ||
        Math.abs(C.Valor[1] - Claves[0].Valor[1]) > 0.01 ||
        Math.abs(C.Valor[2] - Claves[0].Valor[2]) > 0.01
      );
      if (Varia) {
        Pistas.push({
          Id: GenerarId(),
          Nombre: `${grupo} · ${NOMBRES_HUESOS_LEGIBLES[HuesoVrm] ?? HuesoVrm}`,
          Tipo: 'HuesoRotacion',
          Objetivo: HuesoVrm,
          Grupo: grupo,
          Claves
        });
      }
    } else if (Propiedad === 'position' && HuesoVrm === 'hips' && !HuesosYaMapeados.has('pos:hips')) {
      HuesosYaMapeados.add('pos:hips');
      const Interpolante = Track.createInterpolant();
      const Claves: ClaveAnimacion[] = [];
      const V0 = Interpolante.evaluate(0);
      const X0 = V0[0];
      const Z0 = V0[2];

      for (let I = 0; I < Muestras; I++) {
        const T = Math.min(Duracion, I / fpsMuestreo);
        const V = Interpolante.evaluate(T);
        Claves.push({
          Id: GenerarId(),
          Tiempo: T,
          Valor: [(V[0] - X0) * escalaPosicion, V[1] * escalaPosicion, (V[2] - Z0) * escalaPosicion],
          Interpolacion: 'Suave'
        });
      }

      const Varia = Claves.some((C) =>
        Math.abs(C.Valor[0] - Claves[0].Valor[0]) > 0.005 ||
        Math.abs(C.Valor[1] - Claves[0].Valor[1]) > 0.005 ||
        Math.abs(C.Valor[2] - Claves[0].Valor[2]) > 0.005
      );
      if (Varia) {
        Pistas.push({
          Id: GenerarId(),
          Nombre: `${grupo} · Posición cadera`,
          Tipo: 'HuesoPosicion',
          Objetivo: 'hips',
          Grupo: grupo,
          Claves
        });
      }
    }
  }
  return Pistas;
}

class ImportadorBvh implements EstrategiaImportacion {
  public readonly NombreFormato = 'Biovision Hierarchy (BVH)';
  public readonly Extensiones = ['.bvh'];

  public PuedeImportar(archivo: File): boolean {
    return archivo.name.toLowerCase().endsWith('.bvh');
  }

  private async ObtenerBvh(archivo: File): Promise<{ clip: THREE.AnimationClip; skeleton: THREE.Skeleton }> {
    const Cache = ObtenerEntradaCache(archivo);
    if (!Cache.bvh) {
      const Texto = await LeerArchivoTexto(archivo);
      Cache.bvh = new BVHLoader().parse(Texto);
    }
    return Cache.bvh;
  }

  public async Previsualizar(archivo: File): Promise<VistaPreviaImportacion> {
    const { clip } = await this.ObtenerBvh(archivo);
    const Duracion = Math.max(0.1, clip.duration);
    const Pistas = ExtraerPistasDesdeClip(clip, 12, 'Importado', 1);
    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Duracion,
      TotalPistas: Pistas.length,
      TotalClavesEstimado: Math.round(Duracion * 24) * Math.max(1, Pistas.length)
    };
  }

  public async Importar(
    archivo: File,
    opciones: OpcionesImportacionAnimacion,
    ctx: ContextoAplicacion
  ): Promise<ResultadoImportacion> {
    const { clip, skeleton } = await this.ObtenerBvh(archivo);

    // Estimar escala de unidades (cm/pulgadas -> metros) midiendo la caja del esqueleto en reposo
    let MinY = Infinity;
    let MaxY = -Infinity;
    skeleton.bones[0]?.updateWorldMatrix(true, true);
    const Tmp = new THREE.Vector3();
    for (const Hueso of skeleton.bones) {
      Hueso.getWorldPosition(Tmp);
      if (Tmp.y < MinY) MinY = Tmp.y;
      if (Tmp.y > MaxY) MaxY = Tmp.y;
    }
    const AlturaBvh = MaxY - MinY;
    const Escala = AlturaBvh > 4 ? 1.55 / AlturaBvh : 1;

    const Crudas = ExtraerPistasDesdeClip(clip, opciones.FpsMuestreo, opciones.GrupoDestino, Escala);
    if (Crudas.length === 0) {
      throw new Error('No se pudieron mapear huesos humanoides desde este archivo BVH.');
    }
    const Res = TransformarPistasImportadas(Crudas, opciones, ctx, false);
    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Pistas: Res.Pistas,
      DuracionClip: Math.max(0.1, clip.duration),
      ClavesOriginales: Res.ClavesOriginales,
      ClavesFinales: Res.ClavesFinales
    };
  }
}

// ----------------------------------------------------------------------------
// Estrategia 4: GLTF / GLB con animaciones embebidas (.glb, .gltf)
// ----------------------------------------------------------------------------

class ImportadorGltfAnimacion implements EstrategiaImportacion {
  public readonly NombreFormato = 'Animación GLTF / GLB';
  public readonly Extensiones = ['.glb', '.gltf'];

  public PuedeImportar(archivo: File): boolean {
    const N = archivo.name.toLowerCase();
    return N.endsWith('.glb') || N.endsWith('.gltf');
  }

  private async ObtenerClip(archivo: File): Promise<THREE.AnimationClip> {
    const Cache = ObtenerEntradaCache(archivo);
    if (!Cache.gltfClip) {
      const Gltf = await new GLTFLoader().parseAsync(await archivo.arrayBuffer(), '');
      if (!Gltf.animations || Gltf.animations.length === 0) {
        throw new Error('El archivo GLB/GLTF no contiene clips de animación.');
      }
      Cache.gltfClip = Gltf.animations[0];
    }
    return Cache.gltfClip;
  }

  public async Previsualizar(archivo: File): Promise<VistaPreviaImportacion> {
    const Clip = await this.ObtenerClip(archivo);
    const Pistas = ExtraerPistasDesdeClip(Clip, 12, 'Importado', 1);
    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Duracion: Math.max(0.1, Clip.duration),
      TotalPistas: Pistas.length,
      TotalClavesEstimado: Math.round(Math.max(0.1, Clip.duration) * 24) * Math.max(1, Pistas.length)
    };
  }

  public async Importar(
    archivo: File,
    opciones: OpcionesImportacionAnimacion,
    ctx: ContextoAplicacion
  ): Promise<ResultadoImportacion> {
    const Clip = await this.ObtenerClip(archivo);
    const Crudas = ExtraerPistasDesdeClip(Clip, opciones.FpsMuestreo, opciones.GrupoDestino, 1);
    if (Crudas.length === 0) {
      throw new Error('No se encontraron huesos humanoides reconocibles en el clip.');
    }
    const Res = TransformarPistasImportadas(Crudas, opciones, ctx, false);
    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Pistas: Res.Pistas,
      DuracionClip: Math.max(0.1, Clip.duration),
      ClavesOriginales: Res.ClavesOriginales,
      ClavesFinales: Res.ClavesFinales
    };
  }
}

// ----------------------------------------------------------------------------
// Facade: ServicioImportacion
// ----------------------------------------------------------------------------

/**
 * Orquesta las estrategias de importación de animaciones y registra el resultado en HistorialComandos.
 */
export class ServicioImportacion {
  private readonly Estrategias: EstrategiaImportacion[] = [
    new ImportadorVrma(),
    new ImportadorVmd(),
    new ImportadorJson(),
    new ImportadorBvh(),
    new ImportadorGltfAnimacion()
  ];

  public EsFormatoSoportado(archivo: File): boolean {
    return this.Estrategias.some((E) => E.PuedeImportar(archivo));
  }

  private ResolverEstrategia(archivo: File): EstrategiaImportacion {
    const Estrategia = this.Estrategias.find((E) => E.PuedeImportar(archivo));
    if (!Estrategia) {
      throw new Error(`Formato no soportado: ${archivo.name}`);
    }
    return Estrategia;
  }

  public async Previsualizar(archivo: File, ctx: ContextoAplicacion): Promise<VistaPreviaImportacion> {
    return this.ResolverEstrategia(archivo).Previsualizar(archivo, ctx);
  }

  public async ImportarConHistorial(
    archivo: File,
    opciones: OpcionesImportacionAnimacion,
    ctx: ContextoAplicacion
  ): Promise<ResultadoImportacion> {
    const Estrategia = this.ResolverEstrategia(archivo);
    const Resultado = await Estrategia.Importar(archivo, opciones, ctx);
    const Comando = new ComandoImportarAnimacion(
      ctx.Animacion,
      Resultado.Pistas,
      opciones,
      Resultado.DuracionClip,
      archivo.name
    );
    ctx.Historial.Ejecutar(Comando);
    return Resultado;
  }
}

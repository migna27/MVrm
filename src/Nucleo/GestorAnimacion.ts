// ============================================================================
// GestorAnimacion.ts — Sistema de animación por fotogramas clave optimizado
// Administra las pistas, caché ordenado, búsqueda binaria O(log K), estrategias
// de interpolación, simplificación RDP, navegación y horneado de clips.
// ============================================================================

import * as THREE from 'three';
import {
  ClaveAnimacion, PistaAnimacion, TipoObjetivoPista, GrupoPista,
  TipoInterpolacion, RangoBucle, PRIORIDAD_GRUPOS, DatosProyecto
} from '../Tipos';
import { BusEventos } from '../Arquitectura/BusEventos';
import { EvaluarInterpolacion } from '../Arquitectura/EstrategiasInterpolacion';
import { GenerarId, Limitar } from '../Utilidades';
import { GestorModelos, NOMBRES_HUESOS_LEGIBLES } from './GestorModelos';
import { GestorEscena } from './GestorEscena';

const EPSILON_CLAVE = 0.004; // Diferencia mínima de tiempo para horneado denso
export const TOLERANCIA_SOBRESCRITURA = 0.015; // Ventana (15 ms) para detectar clave existente en el cabezal

const PARES_ESPEJO: [string, string][] = [
  ['leftShoulder', 'rightShoulder'],
  ['leftUpperArm', 'rightUpperArm'],
  ['leftLowerArm', 'rightLowerArm'],
  ['leftHand', 'rightHand'],
  ['leftUpperLeg', 'rightUpperLeg'],
  ['leftLowerLeg', 'rightLowerLeg'],
  ['leftFoot', 'rightFoot'],
  ['leftToes', 'rightToes']
];

const HUESOS_CENTRALES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'];

export class GestorAnimacion {
  private _Pistas: PistaAnimacion[] = [];
  private _PistasOrdenadasCache: PistaAnimacion[] = [];
  private _PistasSucias = true;

  // Objetos temporales reutilizables para evitar asignaciones por cuadro (0 GC)
  private readonly _QuatA = new THREE.Quaternion();
  private readonly _QuatB = new THREE.Quaternion();
  private readonly _EulerA = new THREE.Euler();
  private readonly _EulerB = new THREE.Euler();
  private readonly _Vec3 = new THREE.Vector3();
  private readonly _HuesosRestablecer = new Set<string>();
  private readonly _ExpresionesRestablecer = new Set<string>();
  private readonly _HuesosConPosicion = new Set<string>();
  private readonly _ResetHuesosPorPers = new Map<string, Set<string>>();
  private readonly _ResetPosPorPers = new Map<string, Set<string>>();
  private readonly _ResetExpPorPers = new Map<string, Set<string>>();
  private readonly _UltimosValoresEfectos = new Map<string, number>();

  public Duracion = 10;          // Duración total de la línea de tiempo (s)
  public TiempoActual = 0;       // Cabezal de reproducción (s)
  public Reproduciendo = false;
  public EnBucle = true;

  /** Callback heredado cuando cambian las pistas (se mantiene por compatibilidad). */
  public AlCambiarPistas: () => void = () => {};

  constructor(
    private Modelos: GestorModelos,
    private Escena: GestorEscena,
    private Bus?: BusEventos
  ) {}

  /** Lista de pistas del proyecto; asignar un arreglo invalida la caché ordenada. */
  public get Pistas(): PistaAnimacion[] {
    return this._Pistas;
  }

  public set Pistas(nuevas: PistaAnimacion[]) {
    this._Pistas = Array.isArray(nuevas) ? nuevas : [];
    this._PistasSucias = true;
  }

  /** Marca la caché como sucia y notifica tanto al callback como al BusEventos. */
  public NotificarCambioPistas(motivo?: string): void {
    this._PistasSucias = true;
    this.AlCambiarPistas();
    this.Bus?.Emitir('pistas:cambiadas', { motivo });
  }

  /** Devuelve las pistas ordenadas por prioridad usando la caché si sigue vigente. */
  public ObtenerPistasOrdenadas(): readonly PistaAnimacion[] {
    if (this._PistasSucias || this._PistasOrdenadasCache.length !== this._Pistas.length) {
      this._PistasOrdenadasCache = [...this._Pistas].sort(
        (A, B) => PRIORIDAD_GRUPOS.indexOf(A.Grupo) - PRIORIDAD_GRUPOS.indexOf(B.Grupo)
      );
      this._PistasSucias = false;
    }
    return this._PistasOrdenadasCache;
  }

  // --------------------------------------------------------------------------
  // Administración de pistas y claves
  // --------------------------------------------------------------------------

  /** Nombre legible prefijado por grupo. */
  public NombreGrupo(Grupo: GrupoPista): string {
    switch (Grupo) {
      case 'SeguimientoCuerpo': return 'Cuerpo';
      case 'SeguimientoRostro': return 'Rostro';
      case 'Preajuste': return 'Preajuste';
      case 'Importado': return 'Importado';
      case 'GrabacionVMC': return 'VMC';
      default: return 'Manual';
    }
  }

  private EsTipoPorPersonaje(Tipo: TipoObjetivoPista): boolean {
    return Tipo === 'HuesoRotacion' || Tipo === 'HuesoPosicion' || Tipo === 'Expresion';
  }

  private ResolverPersonajeId(Tipo: TipoObjetivoPista, PersonajeId?: string): string | undefined {
    if (!this.EsTipoPorPersonaje(Tipo)) return undefined;
    return PersonajeId ?? this.Modelos.PersonajeActivoId ?? this.Modelos.Personajes[0]?.Id ?? undefined;
  }

  private CoincidePersonaje(Pista: PistaAnimacion, PersonajeId?: string): boolean {
    if (!this.EsTipoPorPersonaje(Pista.Tipo)) return true;
    const Destino = PersonajeId ?? this.Modelos.PersonajeActivoId ?? this.Modelos.Personajes[0]?.Id;
    const PistaPers = Pista.PersonajeId ?? this.Modelos.Personajes[0]?.Id;
    if (!Destino || !PistaPers) return true;
    return PistaPers === Destino;
  }

  /** Busca una pista sin crearla. */
  public BuscarPista(
    Tipo: TipoObjetivoPista,
    Objetivo: string,
    Grupo: GrupoPista,
    PersonajeId?: string
  ): PistaAnimacion | undefined {
    return this._Pistas.find(
      (P) => P.Tipo === Tipo && P.Objetivo === Objetivo && P.Grupo === Grupo && this.CoincidePersonaje(P, PersonajeId)
    );
  }

  /** Busca (o crea) la pista para un objetivo, grupo y personaje dados. */
  public ObtenerOCrearPista(
    Tipo: TipoObjetivoPista,
    Objetivo: string,
    Grupo: GrupoPista,
    PersonajeId?: string
  ): PistaAnimacion {
    const DestId = this.ResolverPersonajeId(Tipo, PersonajeId);
    let Pista = this.BuscarPista(Tipo, Objetivo, Grupo, DestId);
    if (!Pista) {
      const NombreLegible = NOMBRES_HUESOS_LEGIBLES[Objetivo] ?? Objetivo;
      const Pers = DestId ? this.Modelos.ObtenerPersonaje(DestId) : null;
      const PrefijoPers = Pers && this.Modelos.Personajes.length > 1
        ? `[${Pers.Nombre.replace(/\.vrm$/i, '').slice(0, 12)}] `
        : '';
      Pista = {
        Id: GenerarId(),
        Nombre: `${PrefijoPers}${this.NombreGrupo(Grupo)} · ${NombreLegible}`,
        Tipo,
        Objetivo,
        Grupo,
        ...(DestId ? { PersonajeId: DestId } : {}),
        Claves: []
      };
      this._Pistas.push(Pista);
      this._PistasSucias = true;
    }
    return Pista;
  }

  /** Busca la clave más cercana al tiempo dado dentro de la tolerancia indicada. */
  public BuscarClaveEnTiempo(
    Pista: PistaAnimacion,
    Tiempo: number,
    Tolerancia = TOLERANCIA_SOBRESCRITURA
  ): ClaveAnimacion | undefined {
    let Mejor: ClaveAnimacion | undefined;
    let MejorDist = Tolerancia;
    for (const C of Pista.Claves) {
      const Dist = Math.abs(C.Tiempo - Tiempo);
      if (Dist <= MejorDist) {
        MejorDist = Dist;
        Mejor = C;
      }
    }
    return Mejor;
  }

  /** Lista todas las pistas y claves que coinciden en un instante dado. */
  public ObtenerClavesEnTiempo(
    Tiempo: number,
    Grupo?: GrupoPista,
    Tolerancia = TOLERANCIA_SOBRESCRITURA
  ): Array<{ Pista: PistaAnimacion; Clave: ClaveAnimacion }> {
    const Resultado: Array<{ Pista: PistaAnimacion; Clave: ClaveAnimacion }> = [];
    for (const Pista of this._Pistas) {
      if (Grupo && Pista.Grupo !== Grupo) continue;
      const Clave = this.BuscarClaveEnTiempo(Pista, Tiempo, Tolerancia);
      if (Clave) Resultado.push({ Pista, Clave });
    }
    return Resultado;
  }

  /** Indica si existe al menos una clave en el tiempo especificado. */
  public ExisteClaveEnTiempo(
    Tiempo: number,
    Grupo?: GrupoPista,
    Tolerancia = TOLERANCIA_SOBRESCRITURA
  ): boolean {
    for (const Pista of this._Pistas) {
      if (Grupo && Pista.Grupo !== Grupo) continue;
      if (this.BuscarClaveEnTiempo(Pista, Tiempo, Tolerancia)) return true;
    }
    return false;
  }

  /**
   * Inserta o sobrescribe una clave en la pista indicada, informando si hubo
   * sobrescritura y conservando copia de la clave anterior para deshacer.
   */
  public GuardarClave(
    Pista: PistaAnimacion,
    Tiempo: number,
    Valor: number[],
    Interpolacion: TipoInterpolacion = 'Suave',
    Tolerancia = TOLERANCIA_SOBRESCRITURA
  ): { Clave: ClaveAnimacion; Sobrescrita: boolean; Anterior: ClaveAnimacion | null } {
    const T = Limitar(Tiempo, 0, this.Duracion);
    const Existente = this.BuscarClaveEnTiempo(Pista, T, Tolerancia);
    if (Existente) {
      const Anterior: ClaveAnimacion = {
        Id: Existente.Id,
        Tiempo: Existente.Tiempo,
        Valor: [...Existente.Valor],
        Interpolacion: Existente.Interpolacion
      };
      Existente.Valor = [...Valor];
      if (Interpolacion) Existente.Interpolacion = Interpolacion;
      this.NotificarCambioPistas('clave-sobrescrita');
      return { Clave: Existente, Sobrescrita: true, Anterior };
    }

    const Clave: ClaveAnimacion = {
      Id: GenerarId(),
      Tiempo: T,
      Valor: [...Valor],
      Interpolacion
    };
    Pista.Claves.push(Clave);
    Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
    this.NotificarCambioPistas('clave-insertada');
    return { Clave, Sobrescrita: false, Anterior: null };
  }

  /** Inserta o reemplaza una clave en la pista indicada (compatibilidad directa). */
  public AgregarClave(Pista: PistaAnimacion, Tiempo: number, Valor: number[]): ClaveAnimacion {
    const T = Limitar(Tiempo, 0, this.Duracion);
    let Clave = Pista.Claves.find((C) => Math.abs(C.Tiempo - T) < EPSILON_CLAVE);
    if (Clave) {
      Clave.Valor = [...Valor];
    } else {
      Clave = { Id: GenerarId(), Tiempo: T, Valor: [...Valor] };
      Pista.Claves.push(Clave);
      Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
    }
    this.NotificarCambioPistas('clave-agregada');
    return Clave;
  }

  /** Actualiza tiempo, valor o interpolación de una clave puntual. */
  public EstablecerPropiedadesClave(
    PistaId: string,
    ClaveId: string,
    Cambios: { Tiempo?: number; Valor?: number[]; Interpolacion?: TipoInterpolacion }
  ): boolean {
    const Pista = this._Pistas.find((P) => P.Id === PistaId);
    if (!Pista || Pista.Bloqueada) return false;
    const Clave = Pista.Claves.find((C) => C.Id === ClaveId);
    if (!Clave) return false;

    if (Cambios.Tiempo !== undefined) {
      Clave.Tiempo = Limitar(Cambios.Tiempo, 0, this.Duracion);
      Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
    }
    if (Cambios.Valor !== undefined) {
      Clave.Valor = [...Cambios.Valor];
    }
    if (Cambios.Interpolacion !== undefined) {
      Clave.Interpolacion = Cambios.Interpolacion;
    }
    this.NotificarCambioPistas('clave-editada');
    return true;
  }

  /** Mueve una clave a un nuevo tiempo manteniendo el orden de la pista. */
  public MoverClave(Pista: PistaAnimacion, ClaveId: string, NuevoTiempo: number): void {
    if (Pista.Bloqueada) return;
    const Clave = Pista.Claves.find((C) => C.Id === ClaveId);
    if (!Clave) return;
    Clave.Tiempo = Limitar(NuevoTiempo, 0, this.Duracion);
    Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
    this.NotificarCambioPistas('clave-movida');
  }

  /** Elimina una clave; si la pista queda vacía también se elimina. */
  public EliminarClave(PistaId: string, ClaveId: string): void {
    const Pista = this._Pistas.find((P) => P.Id === PistaId);
    if (!Pista || Pista.Bloqueada) return;
    Pista.Claves = Pista.Claves.filter((C) => C.Id !== ClaveId);
    if (Pista.Claves.length === 0) {
      this._Pistas = this._Pistas.filter((P) => P.Id !== PistaId);
    }
    this.NotificarCambioPistas('clave-eliminada');
  }

  /** Elimina una pista completa por su id. */
  public EliminarPista(PistaId: string): void {
    this._Pistas = this._Pistas.filter((P) => P.Id !== PistaId);
    this.NotificarCambioPistas('pista-eliminada');
  }

  /** Elimina todas las pistas de un grupo (p. ej. seguimiento anterior). */
  public EliminarPistasPorGrupo(Grupo: GrupoPista): void {
    this._Pistas = this._Pistas.filter((P) => P.Grupo !== Grupo);
    this.NotificarCambioPistas('grupo-eliminado');
  }

  /** Agrega un conjunto de pistas generadas (preajustes, importación, tracking). */
  public AgregarPistas(Nuevas: PistaAnimacion[]): void {
    for (const Nueva of Nuevas) {
      const Existente = this._Pistas.find(
        (P) =>
          P.Tipo === Nueva.Tipo &&
          P.Objetivo === Nueva.Objetivo &&
          P.Grupo === Nueva.Grupo &&
          this.CoincidePersonaje(P, Nueva.PersonajeId)
      );
      if (Existente) {
        for (const Clave of Nueva.Claves) {
          const Exist = Existente.Claves.find((C) => Math.abs(C.Tiempo - Clave.Tiempo) < EPSILON_CLAVE);
          if (Exist) {
            Exist.Valor = [...Clave.Valor];
            if (Clave.Interpolacion) Exist.Interpolacion = Clave.Interpolacion;
          } else {
            Existente.Claves.push({
              Id: Clave.Id || GenerarId(),
              Tiempo: Limitar(Clave.Tiempo, 0, this.Duracion),
              Valor: [...Clave.Valor],
              Interpolacion: Clave.Interpolacion
            });
          }
        }
        Existente.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
      } else {
        this._Pistas.push({
          ...Nueva,
          Claves: [...Nueva.Claves].sort((A, B) => A.Tiempo - B.Tiempo)
        });
      }
    }
    this.NotificarCambioPistas('pistas-agregadas');
  }

  /** Inserta claves de la pose actual para todos los huesos y expresiones del personaje activo. */
  public InsertarPoseCompleta(
    Tiempo: number,
    Interpolacion: TipoInterpolacion = 'Suave',
    PersonajeId?: string
  ): { Insertadas: number; Sobrescritas: number } {
    const P = this.Modelos.ObtenerPersonaje(PersonajeId);
    if (!P) return { Insertadas: 0, Sobrescritas: 0 };
    let Insertadas = 0;
    let Sobrescritas = 0;

    const Principales = new Set(this.Modelos.ObtenerHuesosDisponibles(P.Id));
    for (const Nombre of this.Modelos.ObtenerTodosHuesosDisponibles(P.Id)) {
      const Euler = this.Modelos.ObtenerRotacionHueso(Nombre, P.Id);
      const PistaExist = this.BuscarPista('HuesoRotacion', Nombre, 'Manual', P.Id);
      if (!Principales.has(Nombre) && !PistaExist && Math.abs(Euler.x) + Math.abs(Euler.y) + Math.abs(Euler.z) < 0.005) {
        continue;
      }
      const Pista = PistaExist ?? this.ObtenerOCrearPista('HuesoRotacion', Nombre, 'Manual', P.Id);
      const Res = this.GuardarClave(Pista, Tiempo, [Euler.x, Euler.y, Euler.z], Interpolacion);
      if (Res.Sobrescrita) Sobrescritas++; else Insertadas++;
    }
    const PosCadera = this.Modelos.ObtenerPosicionHueso('hips', P.Id);
    const PistaPos = this.ObtenerOCrearPista('HuesoPosicion', 'hips', 'Manual', P.Id);
    const ResPos = this.GuardarClave(PistaPos, Tiempo, [PosCadera.x, PosCadera.y, PosCadera.z], Interpolacion);
    if (ResPos.Sobrescrita) Sobrescritas++; else Insertadas++;

    for (const Expresion of this.Modelos.ObtenerExpresiones(P.Id)) {
      const Peso = this.Modelos.ObtenerValorExpresion(Expresion, P.Id);
      const PistaExistente = this.BuscarPista('Expresion', Expresion, 'Manual', P.Id);
      if (Peso > 0.001 || (PistaExistente && this.BuscarClaveEnTiempo(PistaExistente, Tiempo))) {
        const Pista = PistaExistente ?? this.ObtenerOCrearPista('Expresion', Expresion, 'Manual', P.Id);
        const ResExp = this.GuardarClave(Pista, Tiempo, [Peso], Interpolacion);
        if (ResExp.Sobrescrita) Sobrescritas++; else Insertadas++;
      }
    }
    return { Insertadas, Sobrescritas };
  }

  /** Lee el valor actual en vivo del visor/escena para cualquier objetivo de pista. */
  public ObtenerValorActualObjetivo(Tipo: TipoObjetivoPista, Objetivo: string, PersonajeId?: string): number[] | null {
    switch (Tipo) {
      case 'HuesoRotacion': {
        if (!this.Modelos.ObtenerNodoHueso(Objetivo, PersonajeId)) return null;
        const E = this.Modelos.ObtenerRotacionHueso(Objetivo, PersonajeId);
        return [E.x, E.y, E.z];
      }
      case 'HuesoPosicion': {
        if (!this.Modelos.ObtenerNodoHueso(Objetivo, PersonajeId)) return null;
        const P = this.Modelos.ObtenerPosicionHueso(Objetivo, PersonajeId);
        return [P.x, P.y, P.z];
      }
      case 'Expresion': {
        if (!this.Modelos.ObtenerPersonaje(PersonajeId)) return null;
        return [this.Modelos.ObtenerValorExpresion(Objetivo, PersonajeId)];
      }
      case 'CamaraPosicion': {
        const P = this.Escena.Camara.position;
        return [P.x, P.y, P.z];
      }
      case 'CamaraObjetivo': {
        const T = this.Escena.Controles.target;
        return [T.x, T.y, T.z];
      }
      case 'CamaraFOV':
        return [this.Escena.Camara.fov];
      case 'CamaraRoll':
        return [this.Escena.RollCamara];
      case 'Efecto':
      case 'Luz': {
        if (Objetivo === 'Exposicion') return [this.Escena.Renderer.toneMappingExposure];
        if (Objetivo === 'LuzDireccional') return [this.Escena.LuzDireccional.intensity];
        if (Objetivo === 'LuzAmbiental') return [this.Escena.LuzAmbiental.intensity];
        if (Objetivo === 'LuzPersonaje') return [this.Escena.IntensidadLuzPersonaje];
        if (Objetivo === 'BloomFuerza') return [this.Escena.BloomFuerza];
        if (Objetivo === 'DofApertura') return [this.Escena.DofApertura];
        if (Objetivo === 'DofDistancia') return [this.Escena.DofDistancia];
        if (Objetivo === 'Temperatura') return [this.Escena.Temperatura];
        if (Objetivo === 'Saturacion') return [this.Escena.Saturacion];
        if (Objetivo === 'Contraste') return [this.Escena.Contraste];
        if (Objetivo === 'LensDirtIntensidad') return [this.Escena.LensDirtIntensidad];
        if (Objetivo === 'NieblaDensidad') {
          const Fog = this.Escena.Escena.fog as THREE.FogExp2 | null;
          return [Fog?.density ?? 0];
        }
        if (this._UltimosValoresEfectos.has(Objetivo)) {
          return [this._UltimosValoresEfectos.get(Objetivo)!];
        }
        const Pista = this._Pistas.find((P) => P.Tipo === Tipo && P.Objetivo === Objetivo && P.Claves.length > 0);
        if (Pista) {
          const Val = this.InterpolarPista(Pista, this.TiempoActual);
          if (Val) return [...Val];
        }
        const Defecto: Record<string, number> = {
          BloomRadio: 0.6,
          BloomUmbral: 0.85,
          RGBShift: 0.0025,
          RuidoIntensidad: 0.35,
          VignetaOscuridad: 0.45
        };
        return [Defecto[Objetivo] ?? 0];
      }
    }
  }

  /** Busca el tiempo de la clave inmediatamente anterior al tiempo dado. */
  public BuscarTiempoClaveAnterior(Tiempo: number, Grupo?: GrupoPista): number | null {
    const Umbral = Tiempo - 0.005;
    let Mejor: number | null = null;
    for (const Pista of this._Pistas) {
      if (Grupo && Pista.Grupo !== Grupo) continue;
      for (const C of Pista.Claves) {
        if (C.Tiempo < Umbral && (Mejor === null || C.Tiempo > Mejor)) {
          Mejor = C.Tiempo;
        }
      }
    }
    return Mejor;
  }

  /** Busca el tiempo de la clave inmediatamente posterior al tiempo dado. */
  public BuscarTiempoClaveSiguiente(Tiempo: number, Grupo?: GrupoPista): number | null {
    const Umbral = Tiempo + 0.005;
    let Mejor: number | null = null;
    for (const Pista of this._Pistas) {
      if (Grupo && Pista.Grupo !== Grupo) continue;
      for (const C of Pista.Claves) {
        if (C.Tiempo > Umbral && (Mejor === null || C.Tiempo < Mejor)) {
          Mejor = C.Tiempo;
        }
      }
    }
    return Mejor;
  }

  /**
   * Simplifica una secuencia ordenada de claves aplicando Ramer-Douglas-Peucker (RDP)
   * sobre el error temporal-espacial para reducir claves redundantes sin deformar la curva.
   */
  public SimplificarClaves(Claves: ClaveAnimacion[], Tolerancia = 0.015): ClaveAnimacion[] {
    if (Claves.length <= 2) return Claves.map((C) => ({ ...C, Valor: [...C.Valor] }));
    const Ordenadas = [...Claves].sort((A, B) => A.Tiempo - B.Tiempo);
    const Conservar = new Uint8Array(Ordenadas.length);
    Conservar[0] = 1;
    Conservar[Ordenadas.length - 1] = 1;

    const EvaluarRango = (Inicio: number, Fin: number) => {
      if (Fin - Inicio <= 1) return;
      const A = Ordenadas[Inicio];
      const B = Ordenadas[Fin];
      const Span = B.Tiempo - A.Tiempo;
      let MaxError = -1;
      let MaxIndice = -1;

      for (let I = Inicio + 1; I < Fin; I++) {
        const K = Ordenadas[I];
        if (K.Interpolacion === 'Escalon' || A.Interpolacion === 'Escalon') {
          Conservar[I] = 1;
          continue;
        }
        const U = Span > 1e-6 ? (K.Tiempo - A.Tiempo) / Span : 0;
        let SumaSq = 0;
        const Dim = Math.min(A.Valor.length, B.Valor.length, K.Valor.length);
        for (let D = 0; D < Dim; D++) {
          const Est = A.Valor[D] + (B.Valor[D] - A.Valor[D]) * U;
          const Diff = K.Valor[D] - Est;
          SumaSq += Diff * Diff;
        }
        const Error = Math.sqrt(SumaSq);
        if (Error > MaxError) {
          MaxError = Error;
          MaxIndice = I;
        }
      }

      if (MaxIndice >= 0 && MaxError > Tolerancia) {
        Conservar[MaxIndice] = 1;
        EvaluarRango(Inicio, MaxIndice);
        EvaluarRango(MaxIndice, Fin);
      }
    };

    EvaluarRango(0, Ordenadas.length - 1);
    const Salida: ClaveAnimacion[] = [];
    for (let I = 0; I < Ordenadas.length; I++) {
      if (Conservar[I]) {
        Salida.push({
          ...Ordenadas[I],
          Valor: [...Ordenadas[I].Valor]
        });
      }
    }
    return Salida;
  }

  /** Espeja horizontalmente (Izquierda ↔ Derecha) la pose actual del modelo VRM. */
  public EspejarPoseActual(): boolean {
    if (!this.Modelos.Vrm) return false;
    const QIzq = new THREE.Quaternion();
    const QDer = new THREE.Quaternion();

    for (const [HuesoIzq, HuesoDer] of PARES_ESPEJO) {
      const NodoIzq = this.Modelos.ObtenerNodoHueso(HuesoIzq);
      const NodoDer = this.Modelos.ObtenerNodoHueso(HuesoDer);
      if (NodoIzq && NodoDer) {
        QIzq.copy(NodoIzq.quaternion);
        QDer.copy(NodoDer.quaternion);
        // Reflexión simétrica respecto al plano YZ: conserva rotación X y niega Y, Z
        NodoIzq.quaternion.set(QDer.x, -QDer.y, -QDer.z, QDer.w);
        NodoDer.quaternion.set(QIzq.x, -QIzq.y, -QIzq.z, QIzq.w);
      }
    }

    for (const HuesoCentro of HUESOS_CENTRALES) {
      const Nodo = this.Modelos.ObtenerNodoHueso(HuesoCentro);
      if (Nodo) {
        Nodo.quaternion.set(
          Nodo.quaternion.x,
          -Nodo.quaternion.y,
          -Nodo.quaternion.z,
          Nodo.quaternion.w
        );
      }
    }

    const Cadera = this.Modelos.ObtenerNodoHueso('hips');
    if (Cadera) Cadera.position.x = -Cadera.position.x;
    return true;
  }

  // --------------------------------------------------------------------------
  // Evaluación de la animación (búsqueda binaria O(log K) + cero asignaciones)
  // --------------------------------------------------------------------------

  private BuscarIndiceSegmento(Claves: ClaveAnimacion[], Tiempo: number): number {
    let Bajo = 0;
    let Alto = Claves.length - 2;
    while (Bajo <= Alto) {
      const Medio = (Bajo + Alto) >> 1;
      if (Claves[Medio + 1].Tiempo <= Tiempo) {
        Bajo = Medio + 1;
      } else if (Claves[Medio].Tiempo > Tiempo) {
        Alto = Medio - 1;
      } else {
        return Medio;
      }
    }
    return Limitar(Bajo, 0, Claves.length - 2);
  }

  /** Interpola el valor de una pista en un tiempo dado (devuelve null si vacía). */
  private InterpolarPista(Pista: PistaAnimacion, Tiempo: number): number[] | null {
    const Claves = Pista.Claves;
    const N = Claves.length;
    if (N === 0) return null;
    if (N === 1 || Tiempo <= Claves[0].Tiempo) return Claves[0].Valor;
    if (Tiempo >= Claves[N - 1].Tiempo) return Claves[N - 1].Valor;

    const Indice = this.BuscarIndiceSegmento(Claves, Tiempo);
    const A = Claves[Indice];
    const B = Claves[Indice + 1];
    const Alfa = EvaluarInterpolacion(
      (Tiempo - A.Tiempo) / Math.max(1e-6, B.Tiempo - A.Tiempo),
      A.Interpolacion
    );
    const Resultado = new Array<number>(A.Valor.length);
    for (let I = 0; I < A.Valor.length; I++) {
      Resultado[I] = A.Valor[I] + (B.Valor[I] - A.Valor[I]) * Alfa;
    }
    return Resultado;
  }

  /**
   * Evalúa todas las pistas activas (no silenciadas) en un tiempo dado y aplica
   * el resultado al personaje correspondiente, luces, efectos o cámara.
   */
  public EvaluarEn(Tiempo: number): void {
    const PistasOrdenadas = this.ObtenerPistasOrdenadas();
    if (PistasOrdenadas.length === 0) return;

    this._ResetHuesosPorPers.clear();
    this._ResetPosPorPers.clear();
    this._ResetExpPorPers.clear();
    const PersDefault = this.Modelos.Personajes[0]?.Id ?? '__default__';

    const AgregarSet = (Mapa: Map<string, Set<string>>, LlavePers: string, Valor: string) => {
      let S = Mapa.get(LlavePers);
      if (!S) {
        S = new Set<string>();
        Mapa.set(LlavePers, S);
      }
      S.add(Valor);
    };

    for (const Pista of PistasOrdenadas) {
      if (Pista.Silenciada || Pista.Claves.length === 0) continue;
      const KeyPers = Pista.PersonajeId ?? PersDefault;
      if (Pista.Tipo === 'Expresion') {
        AgregarSet(this._ResetExpPorPers, KeyPers, Pista.Objetivo);
      } else if (Pista.Tipo === 'HuesoRotacion' || Pista.Tipo === 'HuesoPosicion') {
        AgregarSet(this._ResetHuesosPorPers, KeyPers, Pista.Objetivo);
        if (Pista.Tipo === 'HuesoPosicion') AgregarSet(this._ResetPosPorPers, KeyPers, Pista.Objetivo);
      }
    }

    for (const [KeyPers, Huesos] of this._ResetHuesosPorPers) {
      const Pers = this.Modelos.ObtenerPersonaje(KeyPers === '__default__' ? undefined : KeyPers);
      if (!Pers) continue;
      const HuesosPos = this._ResetPosPorPers.get(KeyPers);
      for (const Nombre of Huesos) {
        const Reposo = Pers.PoseReposo.get(Nombre);
        const Nodo = this.Modelos.ObtenerNodoHueso(Nombre, Pers.Id);
        if (Reposo && Nodo) {
          Nodo.quaternion.copy(Reposo.Rotacion);
          if (HuesosPos?.has(Nombre)) {
            Nodo.position.copy(Reposo.Posicion);
          }
        }
      }
    }

    for (const [KeyPers, Expresiones] of this._ResetExpPorPers) {
      const PersId = KeyPers === '__default__' ? undefined : KeyPers;
      if (!this.Modelos.ObtenerPersonaje(PersId)) continue;
      for (const Nombre of Expresiones) {
        this.Modelos.EstablecerExpresion(Nombre, 0, PersId);
      }
    }

    for (const Pista of PistasOrdenadas) {
      if (Pista.Silenciada || Pista.Claves.length === 0) continue;

      if (Pista.Tipo === 'HuesoRotacion') {
        const Nodo = this.Modelos.ObtenerNodoHueso(Pista.Objetivo, Pista.PersonajeId);
        if (!Nodo) continue;
        const Claves = Pista.Claves;
        const N = Claves.length;

        if (N === 1 || Tiempo <= Claves[0].Tiempo) {
          const V = Claves[0].Valor;
          this._EulerA.set(V[0], V[1], V[2]);
          Nodo.quaternion.setFromEuler(this._EulerA);
        } else if (Tiempo >= Claves[N - 1].Tiempo) {
          const V = Claves[N - 1].Valor;
          this._EulerA.set(V[0], V[1], V[2]);
          Nodo.quaternion.setFromEuler(this._EulerA);
        } else {
          const Indice = this.BuscarIndiceSegmento(Claves, Tiempo);
          const A = Claves[Indice];
          const B = Claves[Indice + 1];
          const Alfa = EvaluarInterpolacion(
            (Tiempo - A.Tiempo) / Math.max(1e-6, B.Tiempo - A.Tiempo),
            A.Interpolacion
          );
          this._EulerA.set(A.Valor[0], A.Valor[1], A.Valor[2]);
          this._EulerB.set(B.Valor[0], B.Valor[1], B.Valor[2]);
          this._QuatA.setFromEuler(this._EulerA);
          this._QuatB.setFromEuler(this._EulerB);
          this._QuatA.slerp(this._QuatB, Alfa);
          Nodo.quaternion.copy(this._QuatA);
        }
        continue;
      }

      const Valor = this.InterpolarPista(Pista, Tiempo);
      if (!Valor) continue;

      if (Pista.Tipo === 'HuesoPosicion') {
        if (!this.Modelos.ObtenerPersonaje(Pista.PersonajeId)) continue;
        this._Vec3.set(Valor[0], Valor[1], Valor[2]);
        this.Modelos.EstablecerPosicionHueso(Pista.Objetivo, this._Vec3, Pista.PersonajeId);
      } else if (Pista.Tipo === 'Expresion') {
        if (!this.Modelos.ObtenerPersonaje(Pista.PersonajeId)) continue;
        this.Modelos.EstablecerExpresion(Pista.Objetivo, Limitar(Valor[0], 0, 1), Pista.PersonajeId);
      } else if (Pista.Tipo === 'Efecto' || Pista.Tipo === 'Luz') {
        this.AplicarEfectoLuz(Pista.Objetivo, Valor[0]);
      } else if (Pista.Tipo === 'CamaraPosicion') {
        this.Escena.Camara.position.set(Valor[0], Valor[1], Valor[2]);
      } else if (Pista.Tipo === 'CamaraObjetivo') {
        this.Escena.Controles.target.set(Valor[0], Valor[1], Valor[2]);
      } else if (Pista.Tipo === 'CamaraFOV') {
        this.Escena.Camara.fov = Valor[0];
        this.Escena.Camara.updateProjectionMatrix();
      } else if (Pista.Tipo === 'CamaraRoll') {
        this.Escena.EstablecerRollCamara(Valor[0]);
      }
    }
  }

  private AplicarEfectoLuz(Objetivo: string, Valor: number): void {
    if (!this.Escena) return;
    this._UltimosValoresEfectos.set(Objetivo, Valor);
    switch (Objetivo) {
      case 'Exposicion': this.Escena.EstablecerExposicion(Valor); break;
      case 'LuzDireccional': this.Escena.EstablecerLuzDireccional(Valor); break;
      case 'LuzAmbiental': this.Escena.EstablecerLuzAmbiental(Valor); break;
      case 'LuzPersonaje': this.Escena.EstablecerLuzPersonaje(this.Escena.LuzPersonajeActiva, Valor); break;
      case 'BloomFuerza':
        this.Escena.BloomFuerza = Valor;
        this.Escena.EstablecerBloom(this.Escena.BloomActivo, Valor);
        break;
      case 'BloomRadio': this.Escena.EstablecerBloom(this.Escena.BloomActivo, undefined, Valor); break;
      case 'BloomUmbral': this.Escena.EstablecerBloom(this.Escena.BloomActivo, undefined, undefined, Valor); break;
      case 'DofApertura': this.Escena.EstablecerDOF(this.Escena.DofActivo, { Apertura: Valor }); break;
      case 'DofDistancia': this.Escena.EstablecerDOF(this.Escena.DofActivo, { Distancia: Valor }); break;
      case 'Temperatura': this.Escena.EstablecerColorGrading(this.Escena.ColorGradingActivo, { Temperatura: Valor }); break;
      case 'Saturacion': this.Escena.EstablecerColorGrading(this.Escena.ColorGradingActivo, { Saturacion: Valor }); break;
      case 'Contraste': this.Escena.EstablecerColorGrading(this.Escena.ColorGradingActivo, { Contraste: Valor }); break;
      case 'LensDirtIntensidad': this.Escena.EstablecerLensDirt(this.Escena.LensDirtActivo, undefined, Valor); break;
      case 'NieblaDensidad': {
        const Fog = this.Escena.Escena.fog as THREE.FogExp2 | null;
        if (Fog) Fog.density = Math.max(0, Valor);
        break;
      }
      case 'RGBShift': this.Escena.EstablecerAberracionCromatica(this.Escena.AberracionCromaticaActiva, Valor); break;
      case 'RuidoIntensidad': this.Escena.EstablecerRuido(this.Escena.RuidoActivo, Valor); break;
      case 'VignetaOscuridad': this.Escena.EstablecerVigneta(this.Escena.VignetaActiva, Valor); break;
    }
  }

  // --------------------------------------------------------------------------
  // Reproducción
  // --------------------------------------------------------------------------

  public Reproducir(): void {
    this.Reproduciendo = true;
    this.Bus?.Emitir('reproduccion:cambiada', { reproduciendo: true });
  }

  public Pausar(): void {
    this.Reproduciendo = false;
    this.Bus?.Emitir('reproduccion:cambiada', { reproduciendo: false });
  }

  public Detener(): void {
    this.Reproduciendo = false;
    this.TiempoActual = 0;
    this.Bus?.Emitir('reproduccion:cambiada', { reproduciendo: false });
    this.Bus?.Emitir('tiempo:cambiado', { tiempo: 0, fuente: 'usuario' });
  }

  /** Avanza el cabezal según delta, velocidad y rango de bucle opcional. */
  public Avanzar(Delta: number, Velocidad = 1, RangoBucle?: RangoBucle): void {
    const InicioBucle = RangoBucle?.Activo ? Limitar(RangoBucle.Inicio, 0, this.Duracion) : 0;
    const FinBucle = RangoBucle?.Activo
      ? Limitar(Math.max(InicioBucle + 0.05, RangoBucle.Fin), 0, this.Duracion)
      : this.Duracion;

    this.TiempoActual += Delta * Velocidad;
    if (this.TiempoActual > FinBucle) {
      if (this.EnBucle) {
        const Longitud = Math.max(1e-4, FinBucle - InicioBucle);
        this.TiempoActual = InicioBucle + ((this.TiempoActual - InicioBucle) % Longitud);
      } else {
        this.TiempoActual = FinBucle;
        this.Reproduciendo = false;
        this.Bus?.Emitir('reproduccion:cambiada', { reproduciendo: false });
      }
    } else if (RangoBucle?.Activo && this.TiempoActual < InicioBucle) {
      this.TiempoActual = InicioBucle;
    }
  }

  public EstablecerTiempo(Tiempo: number, Fuente: 'reproduccion' | 'usuario' | 'comando' = 'usuario'): void {
    this.TiempoActual = Limitar(Tiempo, 0, this.Duracion);
    this.Bus?.Emitir('tiempo:cambiado', { tiempo: this.TiempoActual, fuente: Fuente });
  }

  // --------------------------------------------------------------------------
  // Horneado de clips importados (VRMA / BVH / GLTF) a claves editables
  // --------------------------------------------------------------------------

  /**
   * Muestrea un AnimationClip a una tasa fija y genera pistas de claves
   * editables para los huesos y expresiones que realmente cambian.
   */
  public HornearClip(
    Clip: THREE.AnimationClip,
    Fps: number,
    Grupo: GrupoPista,
    ActualizarDuracion = true,
    PersonajeId?: string
  ): PistaAnimacion[] {
    const Pers = this.Modelos.ObtenerPersonaje(PersonajeId);
    if (!Pers) return [];
    const Raiz = Pers.Vrm.scene;
    const Mezclador = new THREE.AnimationMixer(Raiz);
    const Accion = Mezclador.clipAction(Clip);
    Accion.play();

    const DuracionClip = Math.max(0.05, Clip.duration);
    const Muestras = Math.max(2, Math.round(DuracionClip * Fps) + 1);
    const SerieHuesos = new Map<string, number[][]>();
    const SeriePosicion = new Map<string, number[][]>();
    const SerieExpresiones = new Map<string, number[]>();
    const Tiempos: number[] = [];

    for (let I = 0; I < Muestras; I++) {
      const T = Math.min(DuracionClip, I / Fps);
      Tiempos.push(T);
      Mezclador.setTime(T);

      for (const Nombre of this.Modelos.ObtenerTodosHuesosDisponibles(Pers.Id)) {
        const Nodo = this.Modelos.ObtenerNodoHueso(Nombre, Pers.Id)!;
        const Euler = new THREE.Euler().setFromQuaternion(Nodo.quaternion, 'XYZ');
        if (!SerieHuesos.has(Nombre)) SerieHuesos.set(Nombre, []);
        SerieHuesos.get(Nombre)!.push([Euler.x, Euler.y, Euler.z]);
        if (Nombre === 'hips') {
          if (!SeriePosicion.has(Nombre)) SeriePosicion.set(Nombre, []);
          SeriePosicion.get(Nombre)!.push([Nodo.position.x, Nodo.position.y, Nodo.position.z]);
        }
      }
      for (const Expresion of this.Modelos.ObtenerExpresiones(Pers.Id)) {
        if (!SerieExpresiones.has(Expresion)) SerieExpresiones.set(Expresion, []);
        SerieExpresiones.get(Expresion)!.push(this.Modelos.ObtenerValorExpresion(Expresion, Pers.Id));
      }
    }

    Mezclador.stopAllAction();
    Mezclador.uncacheRoot(Raiz);
    this.Modelos.RestablecerPose(Pers.Id);

    const Pistas: PistaAnimacion[] = [];
    const HayVariacion = (Serie: number[][], Umbral: number) =>
      Serie.some((V) => V.some((X, J) => Math.abs(X - Serie[0][J]) > Umbral));

    const PrefijoPers = this.Modelos.Personajes.length > 1
      ? `[${Pers.Nombre.replace(/\.vrm$/i, '').slice(0, 12)}] `
      : '';

    for (const [Nombre, Serie] of SerieHuesos) {
      if (!HayVariacion(Serie, 0.01)) continue;
      Pistas.push({
        Id: GenerarId(),
        Nombre: `${PrefijoPers}${this.NombreGrupo(Grupo)} · ${NOMBRES_HUESOS_LEGIBLES[Nombre] ?? Nombre}`,
        Tipo: 'HuesoRotacion', Objetivo: Nombre, Grupo, PersonajeId: Pers.Id,
        Claves: Tiempos.map((T, I) => ({ Id: GenerarId(), Tiempo: T, Valor: Serie[I], Interpolacion: 'Suave' }))
      });
    }
    for (const [Nombre, Serie] of SeriePosicion) {
      if (!HayVariacion(Serie, 0.005)) continue;
      Pistas.push({
        Id: GenerarId(),
        Nombre: `${PrefijoPers}${this.NombreGrupo(Grupo)} · Posición cadera`,
        Tipo: 'HuesoPosicion', Objetivo: Nombre, Grupo, PersonajeId: Pers.Id,
        Claves: Tiempos.map((T, I) => ({ Id: GenerarId(), Tiempo: T, Valor: Serie[I], Interpolacion: 'Suave' }))
      });
    }
    for (const [Nombre, Serie] of SerieExpresiones) {
      if (!HayVariacion(Serie.map((V) => [V]), 0.02)) continue;
      Pistas.push({
        Id: GenerarId(),
        Nombre: `${PrefijoPers}${this.NombreGrupo(Grupo)} · ${Nombre}`,
        Tipo: 'Expresion', Objetivo: Nombre, Grupo, PersonajeId: Pers.Id,
        Claves: Tiempos.map((T, I) => ({ Id: GenerarId(), Tiempo: T, Valor: [Serie[I]], Interpolacion: 'Suave' }))
      });
    }

    if (ActualizarDuracion && Clip.duration > this.Duracion) {
      this.Duracion = Math.ceil(Clip.duration);
    }
    return Pistas;
  }

  // --------------------------------------------------------------------------
  // Serialización (guardar / abrir proyecto y animación)
  // --------------------------------------------------------------------------

  public ExportarJSON(): string {
    return JSON.stringify({ Version: 1, Duracion: this.Duracion, Pistas: this._Pistas }, null, 2);
  }

  public ImportarJSON(Texto: string): void {
    const Datos = JSON.parse(Texto);
    if (!Array.isArray(Datos.Pistas)) throw new Error('Formato de animación no válido.');
    this._Pistas = Datos.Pistas as PistaAnimacion[];
    if (typeof Datos.Duracion === 'number') this.Duracion = Datos.Duracion;
    this.NotificarCambioPistas('json-importado');
  }

  public Limpiar(): void {
    this._Pistas = [];
    this.TiempoActual = 0;
    this.Duracion = 10;
    this.Reproduciendo = false;
    this._UltimosValoresEfectos.clear();
    this.NotificarCambioPistas('limpiar');
  }

  public ObtenerDatosProyecto(): Partial<DatosProyecto> {
    return { Version: 1, Duracion: this.Duracion, Pistas: this._Pistas };
  }
}

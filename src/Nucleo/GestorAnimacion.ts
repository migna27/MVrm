// ============================================================================
// GestorAnimacion.ts — Etapa 2: Sistema de animación por fotogramas clave
// Administra las pistas, la evaluación de la animación en un tiempo dado,
// el horneado de clips importados a claves editables y la reproducción.
// ============================================================================

import * as THREE from 'three';
import {
  ClaveAnimacion, PistaAnimacion, TipoObjetivoPista, GrupoPista,
  PRIORIDAD_GRUPOS, DatosProyecto
} from '../Tipos';
import { GenerarId, InterpolacionSuave, Limitar } from '../Utilidades';
import { GestorModelos, NOMBRES_HUESOS_LEGIBLES } from './GestorModelos';
import { GestorEscena } from './GestorEscena';

const EPSILON_CLAVE = 0.004; // Diferencia mínima de tiempo para fusionar claves

export class GestorAnimacion {
  public Pistas: PistaAnimacion[] = [];
  public Duracion = 10;          // Duración total de la línea de tiempo (s)
  public TiempoActual = 0;       // Cabezal de reproducción (s)
  public Reproduciendo = false;
  public EnBucle = true;

  /** Se dispara cuando cambian las pistas (agregar, mover o eliminar claves). */
  public AlCambiarPistas: () => void = () => {};

  constructor(private Modelos: GestorModelos, private Escena: GestorEscena) {}

  // --------------------------------------------------------------------------
  // Administración de pistas y claves
  // --------------------------------------------------------------------------

  /** Busca (o crea) la pista para un objetivo y grupo dados. */
  public ObtenerOCrearPista(Tipo: TipoObjetivoPista, Objetivo: string, Grupo: GrupoPista): PistaAnimacion {
    let Pista = this.Pistas.find((P) => P.Tipo === Tipo && P.Objetivo === Objetivo && P.Grupo === Grupo);
    if (!Pista) {
      const NombreLegible = NOMBRES_HUESOS_LEGIBLES[Objetivo] ?? Objetivo;
      Pista = {
        Id: GenerarId(),
        Nombre: `${this.NombreGrupo(Grupo)} · ${NombreLegible}`,
        Tipo, Objetivo, Grupo, Claves: []
      };
      this.Pistas.push(Pista);
    }
    return Pista;
  }

  private NombreGrupo(Grupo: GrupoPista): string {
    switch (Grupo) {
      case 'SeguimientoCuerpo': return 'Cuerpo';
      case 'SeguimientoRostro': return 'Rostro';
      case 'Preajuste': return 'Preajuste';
      case 'Importado': return 'Importado';
      default: return 'Manual';
    }
  }

  /** Inserta o reemplaza una clave en la pista indicada. */
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
    this.AlCambiarPistas();
    return Clave;
  }

  /** Mueve una clave a un nuevo tiempo manteniendo el orden de la pista. */
  public MoverClave(Pista: PistaAnimacion, ClaveId: string, NuevoTiempo: number): void {
    const Clave = Pista.Claves.find((C) => C.Id === ClaveId);
    if (!Clave) return;
    Clave.Tiempo = Limitar(NuevoTiempo, 0, this.Duracion);
    Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
    this.AlCambiarPistas();
  }

  /** Elimina una clave; si la pista queda vacía también se elimina. */
  public EliminarClave(PistaId: string, ClaveId: string): void {
    const Pista = this.Pistas.find((P) => P.Id === PistaId);
    if (!Pista) return;
    Pista.Claves = Pista.Claves.filter((C) => C.Id !== ClaveId);
    if (Pista.Claves.length === 0) {
      this.Pistas = this.Pistas.filter((P) => P.Id !== PistaId);
    }
    this.AlCambiarPistas();
  }

  /** Elimina una pista completa por su id. */
  public EliminarPista(PistaId: string): void {
    this.Pistas = this.Pistas.filter((P) => P.Id !== PistaId);
    this.AlCambiarPistas();
  }

  /** Elimina todas las pistas de un grupo (p. ej. seguimiento anterior). */
  public EliminarPistasPorGrupo(Grupo: GrupoPista): void {
    this.Pistas = this.Pistas.filter((P) => P.Grupo !== Grupo);
    this.AlCambiarPistas();
  }

  /** Agrega un conjunto de pistas generadas (preajustes, importación, tracking). */
  public AgregarPistas(Nuevas: PistaAnimacion[]): void {
    for (const Nueva of Nuevas) {
      const Existente = this.Pistas.find(
        (P) => P.Tipo === Nueva.Tipo && P.Objetivo === Nueva.Objetivo && P.Grupo === Nueva.Grupo
      );
      if (Existente) {
        for (const Clave of Nueva.Claves) this.AgregarClave(Existente, Clave.Tiempo, Clave.Valor);
      } else {
        this.Pistas.push(Nueva);
      }
    }
    this.AlCambiarPistas();
  }

  /** Inserta claves de la pose actual para todos los huesos y expresiones. */
  public InsertarPoseCompleta(Tiempo: number): void {
    if (!this.Modelos.Vrm) return;
    for (const Nombre of this.Modelos.ObtenerHuesosDisponibles()) {
      const Euler = this.Modelos.ObtenerRotacionHueso(Nombre);
      const Pista = this.ObtenerOCrearPista('HuesoRotacion', Nombre, 'Manual');
      this.AgregarClave(Pista, Tiempo, [Euler.x, Euler.y, Euler.z]);
    }
    const PosCadera = this.Modelos.ObtenerPosicionHueso('hips');
    const PistaPos = this.ObtenerOCrearPista('HuesoPosicion', 'hips', 'Manual');
    this.AgregarClave(PistaPos, Tiempo, [PosCadera.x, PosCadera.y, PosCadera.z]);
    for (const Expresion of this.Modelos.ObtenerExpresiones()) {
      const Peso = this.Modelos.ObtenerValorExpresion(Expresion);
      if (Peso > 0.001) {
        const Pista = this.ObtenerOCrearPista('Expresion', Expresion, 'Manual');
        this.AgregarClave(Pista, Tiempo, [Peso]);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Evaluación de la animación
  // --------------------------------------------------------------------------

  /** Interpola el valor de una pista en un tiempo dado (devuelve null si vacía). */
  private InterpolarPista(Pista: PistaAnimacion, Tiempo: number): number[] | null {
    const Claves = Pista.Claves;
    if (Claves.length === 0) return null;
    if (Tiempo <= Claves[0].Tiempo) return Claves[0].Valor;
    if (Tiempo >= Claves[Claves.length - 1].Tiempo) return Claves[Claves.length - 1].Valor;

    let Indice = 0;
    while (Indice < Claves.length - 1 && Claves[Indice + 1].Tiempo < Tiempo) Indice++;
    const A = Claves[Indice];
    const B = Claves[Indice + 1];
    const Alfa = InterpolacionSuave((Tiempo - A.Tiempo) / Math.max(1e-6, B.Tiempo - A.Tiempo));
    return A.Valor.map((V, I) => V + (B.Valor[I] - V) * Alfa);
  }

  /**
   * Evalúa todas las pistas en un tiempo y aplica el resultado al modelo.
   * Los objetivos con pista se restablecen primero a la pose de reposo para
   * que la evaluación sea determinista al desplazarse por la línea de tiempo.
   */
  public EvaluarEn(Tiempo: number): void {
    if (!this.Modelos.Vrm) return;

    // Ordenar por prioridad de grupo: los de mayor prioridad se aplican al final
    const PistasOrdenadas = [...this.Pistas].sort(
      (A, B) => PRIORIDAD_GRUPOS.indexOf(A.Grupo) - PRIORIDAD_GRUPOS.indexOf(B.Grupo)
    );

    // Restablecer los objetivos animados a su pose de reposo
    const HuesosRestablecer = new Set<string>();
    const ExpresionesRestablecer = new Set<string>();
    for (const Pista of PistasOrdenadas) {
      if (Pista.Tipo === 'Expresion') ExpresionesRestablecer.add(Pista.Objetivo);
      else HuesosRestablecer.add(Pista.Objetivo);
    }
    for (const Nombre of HuesosRestablecer) {
      const Reposo = this.Modelos.PoseReposo.get(Nombre);
      const Nodo = this.Modelos.ObtenerNodoHueso(Nombre);
      if (Reposo && Nodo) {
        Nodo.quaternion.copy(Reposo.Rotacion);
        if (PistasOrdenadas.some((P) => P.Tipo === 'HuesoPosicion' && P.Objetivo === Nombre)) {
          Nodo.position.copy(Reposo.Posicion);
        }
      }
    }
    for (const Nombre of ExpresionesRestablecer) this.Modelos.EstablecerExpresion(Nombre, 0);

    // Aplicar los valores interpolados
    const CuaternionA = new THREE.Quaternion();
    const CuaternionB = new THREE.Quaternion();
    const EulerA = new THREE.Euler();
    const EulerB = new THREE.Euler();

    for (const Pista of PistasOrdenadas) {
      // Para rotaciones se interpola en cuaterniones para evitar saltos
      if (Pista.Tipo === 'HuesoRotacion' && Pista.Claves.length >= 2) {
        const Claves = Pista.Claves;
        let Valor: number[] | null = null;
        if (Tiempo <= Claves[0].Tiempo) Valor = Claves[0].Valor;
        else if (Tiempo >= Claves[Claves.length - 1].Tiempo) Valor = Claves[Claves.length - 1].Valor;
        else {
          let Indice = 0;
          while (Indice < Claves.length - 1 && Claves[Indice + 1].Tiempo < Tiempo) Indice++;
          const A = Claves[Indice];
          const B = Claves[Indice + 1];
          const Alfa = InterpolacionSuave((Tiempo - A.Tiempo) / Math.max(1e-6, B.Tiempo - A.Tiempo));
          EulerA.set(A.Valor[0], A.Valor[1], A.Valor[2]);
          EulerB.set(B.Valor[0], B.Valor[1], B.Valor[2]);
          CuaternionA.setFromEuler(EulerA);
          CuaternionB.setFromEuler(EulerB);
          CuaternionA.slerp(CuaternionB, Alfa);
          this.Modelos.ObtenerNodoHueso(Pista.Objetivo)?.quaternion.copy(CuaternionA);
          continue;
        }
        if (Valor) {
          EulerA.set(Valor[0], Valor[1], Valor[2]);
          this.Modelos.EstablecerRotacionHueso(Pista.Objetivo, EulerA);
        }
        continue;
      }

      const Valor = this.InterpolarPista(Pista, Tiempo);
      if (!Valor) continue;
      if (Pista.Tipo === 'HuesoPosicion') {
        this.Modelos.EstablecerPosicionHueso(Pista.Objetivo, new THREE.Vector3(Valor[0], Valor[1], Valor[2]));
      } else if (Pista.Tipo === 'Expresion') {
        this.Modelos.EstablecerExpresion(Pista.Objetivo, Limitar(Valor[0], 0, 1));
      } else if (Pista.Tipo === 'Efecto' || Pista.Tipo === 'Luz') {
        this.AplicarEfectoLuz(Pista.Objetivo, Valor[0]);
      } else if (Pista.Tipo === 'CamaraPosicion') {
        this.Escena.Camara.position.set(Valor[0], Valor[1], Valor[2]);
      } else if (Pista.Tipo === 'CamaraObjetivo') {
        this.Escena.Controles.target.set(Valor[0], Valor[1], Valor[2]);
      } else if (Pista.Tipo === 'CamaraFOV') {
        this.Escena.Camara.fov = Valor[0];
        this.Escena.Camara.updateProjectionMatrix();
      }
    }
  }

  private AplicarEfectoLuz(Objetivo: string, Valor: number): void {
    if (!this.Escena) return;
    switch (Objetivo) {
      case 'Exposicion': this.Escena.EstablecerExposicion(Valor); break;
      case 'LuzDireccional': this.Escena.EstablecerLuzDireccional(Valor); break;
      case 'LuzAmbiental': this.Escena.EstablecerLuzAmbiental(Valor); break;
      case 'BloomFuerza': 
        this.Escena.BloomFuerza = Valor;
        this.Escena.EstablecerBloom(this.Escena.BloomActivo, Valor); 
        break;
      case 'BloomRadio': this.Escena.EstablecerBloom(this.Escena.BloomActivo, undefined, Valor); break;
      case 'BloomUmbral': this.Escena.EstablecerBloom(this.Escena.BloomActivo, undefined, undefined, Valor); break;
      case 'RGBShift': this.Escena.EstablecerAberracionCromatica(this.Escena.AberracionCromaticaActiva, Valor); break;
      case 'RuidoIntensidad': this.Escena.EstablecerRuido(this.Escena.RuidoActivo, Valor); break;
      case 'VignetaOscuridad': this.Escena.EstablecerVigneta(this.Escena.VignetaActiva, Valor); break;
    }
  }

  // --------------------------------------------------------------------------
  // Reproducción
  // --------------------------------------------------------------------------

  public Reproducir(): void { this.Reproduciendo = true; }
  public Pausar(): void { this.Reproduciendo = false; }

  public Detener(): void {
    this.Reproduciendo = false;
    this.TiempoActual = 0;
  }

  /** Avanza el cabezal según el delta del reloj; respeta el bucle. */
  public Avanzar(Delta: number): void {
    this.TiempoActual += Delta;
    if (this.TiempoActual > this.Duracion) {
      this.TiempoActual = this.EnBucle ? this.TiempoActual % this.Duracion : this.Duracion;
      if (!this.EnBucle) this.Reproduciendo = false;
    }
  }

  public EstablecerTiempo(Tiempo: number): void {
    this.TiempoActual = Limitar(Tiempo, 0, this.Duracion);
  }

  // --------------------------------------------------------------------------
  // Horneado de clips importados (VRMA) a claves editables
  // --------------------------------------------------------------------------

  /**
   * Muestrea un AnimationClip a una tasa fija y genera pistas de claves
   * editables para los huesos y expresiones que realmente cambian.
   */
  public HornearClip(Clip: THREE.AnimationClip, Fps: number, Grupo: GrupoPista): PistaAnimacion[] {
    if (!this.Modelos.Vrm) return [];
    const Raiz = this.Modelos.Vrm.scene;
    const Mezclador = new THREE.AnimationMixer(Raiz);
    const Accion = Mezclador.clipAction(Clip);
    Accion.play();

    const Muestras = Math.max(2, Math.round(Clip.duration * Fps) + 1);
    const SerieHuesos = new Map<string, number[][]>();
    const SeriePosicion = new Map<string, number[][]>();
    const SerieExpresiones = new Map<string, number[]>();
    const Tiempos: number[] = [];

    for (let I = 0; I < Muestras; I++) {
      const T = Math.min(Clip.duration, I / Fps);
      Tiempos.push(T);
      Mezclador.setTime(T);

      for (const Nombre of this.Modelos.ObtenerHuesosDisponibles()) {
        const Nodo = this.Modelos.ObtenerNodoHueso(Nombre)!;
        const Euler = new THREE.Euler().setFromQuaternion(Nodo.quaternion, 'XYZ');
        if (!SerieHuesos.has(Nombre)) SerieHuesos.set(Nombre, []);
        SerieHuesos.get(Nombre)!.push([Euler.x, Euler.y, Euler.z]);
        if (Nombre === 'hips') {
          if (!SeriePosicion.has(Nombre)) SeriePosicion.set(Nombre, []);
          SeriePosicion.get(Nombre)!.push([Nodo.position.x, Nodo.position.y, Nodo.position.z]);
        }
      }
      for (const Expresion of this.Modelos.ObtenerExpresiones()) {
        if (!SerieExpresiones.has(Expresion)) SerieExpresiones.set(Expresion, []);
        SerieExpresiones.get(Expresion)!.push(this.Modelos.ObtenerValorExpresion(Expresion));
      }
    }

    Mezclador.stopAllAction();
    Mezclador.uncacheRoot(Raiz);
    this.Modelos.RestablecerPose();

    // Solo se generan pistas para las series con variación real
    const Pistas: PistaAnimacion[] = [];
    const HayVariacion = (Serie: number[][], Umbral: number) =>
      Serie.some((V) => V.some((X, J) => Math.abs(X - Serie[0][J]) > Umbral));

    for (const [Nombre, Serie] of SerieHuesos) {
      if (!HayVariacion(Serie, 0.01)) continue;
      Pistas.push({
        Id: GenerarId(),
        Nombre: `${this.NombreGrupo(Grupo)} · ${NOMBRES_HUESOS_LEGIBLES[Nombre] ?? Nombre}`,
        Tipo: 'HuesoRotacion', Objetivo: Nombre, Grupo,
        Claves: Tiempos.map((T, I) => ({ Id: GenerarId(), Tiempo: T, Valor: Serie[I] }))
      });
    }
    for (const [Nombre, Serie] of SeriePosicion) {
      if (!HayVariacion(Serie, 0.005)) continue;
      Pistas.push({
        Id: GenerarId(),
        Nombre: `${this.NombreGrupo(Grupo)} · Posición cadera`,
        Tipo: 'HuesoPosicion', Objetivo: Nombre, Grupo,
        Claves: Tiempos.map((T, I) => ({ Id: GenerarId(), Tiempo: T, Valor: Serie[I] }))
      });
    }
    for (const [Nombre, Serie] of SerieExpresiones) {
      if (!HayVariacion(Serie.map((V) => [V]), 0.02)) continue;
      Pistas.push({
        Id: GenerarId(),
        Nombre: `${this.NombreGrupo(Grupo)} · ${Nombre}`,
        Tipo: 'Expresion', Objetivo: Nombre, Grupo,
        Claves: Tiempos.map((T, I) => ({ Id: GenerarId(), Tiempo: T, Valor: [Serie[I]] }))
      });
    }

    // La duración de la línea de tiempo cubre al clip importado
    if (Clip.duration > this.Duracion) this.Duracion = Math.ceil(Clip.duration);
    return Pistas;
  }

  // --------------------------------------------------------------------------
  // Serialización (guardar / abrir proyecto y animación)
  // --------------------------------------------------------------------------

  public ExportarJSON(): string {
    return JSON.stringify({ Version: 1, Duracion: this.Duracion, Pistas: this.Pistas }, null, 2);
  }

  public ImportarJSON(Texto: string): void {
    const Datos = JSON.parse(Texto);
    if (!Array.isArray(Datos.Pistas)) throw new Error('Formato de animación no válido.');
    this.Pistas = Datos.Pistas as PistaAnimacion[];
    if (typeof Datos.Duracion === 'number') this.Duracion = Datos.Duracion;
    this.AlCambiarPistas();
  }

  public Limpiar(): void {
    this.Pistas = [];
    this.TiempoActual = 0;
    this.Duracion = 10;
    this.Reproduciendo = false;
    this.AlCambiarPistas();
  }

  public ObtenerDatosProyecto(): Partial<DatosProyecto> {
    return { Version: 1, Duracion: this.Duracion, Pistas: this.Pistas };
  }
}

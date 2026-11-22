// ============================================================================
// ComandosAnimacion.ts — Comandos concretos para creación, edición,
// sobrescritura, eliminación, simplificación e importación de keyframes.
// ============================================================================

import {
  ClaveAnimacion, GrupoPista, OpcionesImportacionAnimacion, PistaAnimacion,
  SeleccionClave, TipoInterpolacion, TipoObjetivoPista
} from '../Tipos';
import { GestorAnimacion, TOLERANCIA_SOBRESCRITURA } from '../Nucleo/GestorAnimacion';
import { Comando, ComandoLote } from './HistorialComandos';
import { ContenidoPortapapeles, EstadoEstudio } from './EstadoEstudio';
import { GenerarId, Limitar } from '../Utilidades';

function ClonarClave(c: ClaveAnimacion): ClaveAnimacion {
  return {
    Id: c.Id,
    Tiempo: c.Tiempo,
    Valor: [...c.Valor],
    Interpolacion: c.Interpolacion
  };
}

function ClonarPista(p: PistaAnimacion): PistaAnimacion {
  return {
    ...p,
    Claves: p.Claves.map(ClonarClave)
  };
}

/**
 * Inserta o sobrescribe una clave puntual en una pista (creando la pista si no existe).
 */
export class ComandoGuardarClave implements Comando {
  public readonly Descripcion: string;
  public FueSobrescritura = false;
  public ClaveResultanteId = '';

  private PistaCreadaId: string | null = null;
  private ClaveAnterior: ClaveAnimacion | null = null;
  private PistaDestinoId: string | null = null;

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly Tipo: TipoObjetivoPista,
    private readonly Objetivo: string,
    private readonly Grupo: GrupoPista,
    private readonly Tiempo: number,
    private readonly Valor: number[],
    private readonly Interpolacion: TipoInterpolacion = 'Suave',
    private readonly Tolerancia: number = TOLERANCIA_SOBRESCRITURA
  ) {
    this.Descripcion = `Clave en ${Objetivo} (${Tiempo.toFixed(2)}s)`;
  }

  public Ejecutar(): void {
    const ExistiaAntes = this.Anim.BuscarPista(this.Tipo, this.Objetivo, this.Grupo);
    const Pista = ExistiaAntes ?? this.Anim.ObtenerOCrearPista(this.Tipo, this.Objetivo, this.Grupo);
    if (!ExistiaAntes) {
      this.PistaCreadaId = Pista.Id;
    }
    this.PistaDestinoId = Pista.Id;

    const Res = this.Anim.GuardarClave(Pista, this.Tiempo, this.Valor, this.Interpolacion, this.Tolerancia);
    this.FueSobrescritura = Res.Sobrescrita;
    this.ClaveAnterior = Res.Anterior ? ClonarClave(Res.Anterior) : null;
    this.ClaveResultanteId = Res.Clave.Id;
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    if (this.PistaCreadaId) {
      this.Anim.EliminarPista(this.PistaCreadaId);
      this.PistaCreadaId = null;
      this.Anim.EvaluarEn(this.Anim.TiempoActual);
      return;
    }

    const Pista = this.Anim.Pistas.find((P) => P.Id === this.PistaDestinoId);
    if (Pista) {
      if (this.ClaveAnterior) {
        const ClaveActual = Pista.Claves.find((C) => C.Id === this.ClaveResultanteId);
        if (ClaveActual) {
          ClaveActual.Tiempo = this.ClaveAnterior.Tiempo;
          ClaveActual.Valor = [...this.ClaveAnterior.Valor];
          ClaveActual.Interpolacion = this.ClaveAnterior.Interpolacion;
        } else {
          Pista.Claves.push(ClonarClave(this.ClaveAnterior));
        }
        Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
      } else {
        Pista.Claves = Pista.Claves.filter((C) => C.Id !== this.ClaveResultanteId);
      }
    }
    this.Anim.NotificarCambioPistas('deshacer-guardar-clave');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Modifica tiempo, valor o estrategia de interpolación de una clave existente.
 */
export class ComandoModificarClave implements Comando {
  public readonly Descripcion: string;
  private ClaveAntes: ClaveAnimacion | null = null;
  private ClaveDespues: ClaveAnimacion | null = null;

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly PistaId: string,
    private readonly ClaveId: string,
    private readonly Cambios: { Tiempo?: number; Valor?: number[]; Interpolacion?: TipoInterpolacion },
    snapshotPrevio?: ClaveAnimacion
  ) {
    this.Descripcion = 'Editar propiedades de clave';
    if (snapshotPrevio) {
      this.ClaveAntes = ClonarClave(snapshotPrevio);
    }
  }

  public Ejecutar(): void {
    const Pista = this.Anim.Pistas.find((P) => P.Id === this.PistaId);
    const Clave = Pista?.Claves.find((C) => C.Id === this.ClaveId);
    if (!Pista || !Clave || Pista.Bloqueada) return;

    if (!this.ClaveAntes) {
      this.ClaveAntes = ClonarClave(Clave);
    }

    if (this.ClaveDespues) {
      Clave.Tiempo = this.ClaveDespues.Tiempo;
      Clave.Valor = [...this.ClaveDespues.Valor];
      Clave.Interpolacion = this.ClaveDespues.Interpolacion;
      Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
      this.Anim.NotificarCambioPistas('rehacer-editar-clave');
    } else {
      this.Anim.EstablecerPropiedadesClave(this.PistaId, this.ClaveId, this.Cambios);
      this.ClaveDespues = ClonarClave(Clave);
    }
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    if (!this.ClaveAntes) return;
    const Pista = this.Anim.Pistas.find((P) => P.Id === this.PistaId);
    const Clave = Pista?.Claves.find((C) => C.Id === this.ClaveId);
    if (Pista && Clave) {
      if (!this.ClaveDespues) this.ClaveDespues = ClonarClave(Clave);
      Clave.Tiempo = this.ClaveAntes.Tiempo;
      Clave.Valor = [...this.ClaveAntes.Valor];
      Clave.Interpolacion = this.ClaveAntes.Interpolacion;
      Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
      this.Anim.NotificarCambioPistas('deshacer-editar-clave');
      this.Anim.EvaluarEn(this.Anim.TiempoActual);
    }
  }
}

/**
 * Elimina una o varias claves seleccionadas en una sola acción reversible.
 */
export class ComandoEliminarClaves implements Comando {
  public readonly Descripcion: string;
  public ClavesEliminadas = 0;

  private SnapshotPistasAntes: PistaAnimacion[] = [];
  private SeleccionAntes: SeleccionClave[] = [];

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly Seleccion: SeleccionClave[],
    private readonly Estado?: EstadoEstudio
  ) {
    this.Descripcion = Seleccion.length > 1
      ? `Eliminar ${Seleccion.length} claves`
      : 'Eliminar clave';
  }

  public Ejecutar(): void {
    this.SnapshotPistasAntes = this.Anim.Pistas.map(ClonarPista);
    this.SeleccionAntes = this.Seleccion.map((S) => ({ ...S }));

    const PorPista = new Map<string, Set<string>>();
    for (const S of this.Seleccion) {
      let Conjunto = PorPista.get(S.PistaId);
      if (!Conjunto) {
        Conjunto = new Set();
        PorPista.set(S.PistaId, Conjunto);
      }
      Conjunto.add(S.ClaveId);
    }

    let Eliminadas = 0;
    const SiguientesPistas: PistaAnimacion[] = [];

    for (const Pista of this.Anim.Pistas) {
      const Ids = PorPista.get(Pista.Id);
      if (!Ids || Pista.Bloqueada) {
        SiguientesPistas.push(Pista);
        continue;
      }
      const Antes = Pista.Claves.length;
      Pista.Claves = Pista.Claves.filter((C) => !Ids.has(C.Id));
      Eliminadas += Antes - Pista.Claves.length;
      if (Pista.Claves.length > 0) {
        SiguientesPistas.push(Pista);
      }
    }

    this.ClavesEliminadas = Eliminadas;
    this.Anim.Pistas = SiguientesPistas;
    if (this.Estado) {
      const Restantes = this.Estado.SeleccionClaves.filter((S) => !PorPista.get(S.PistaId)?.has(S.ClaveId));
      this.Estado.EstablecerSeleccion(Restantes);
    }
    this.Anim.NotificarCambioPistas('eliminar-claves');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    this.Anim.Pistas = this.SnapshotPistasAntes.map(ClonarPista);
    if (this.Estado) {
      this.Estado.EstablecerSeleccion(this.SeleccionAntes);
    }
    this.Anim.NotificarCambioPistas('deshacer-eliminar-claves');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Mueve una o varias claves en el tiempo guardando instantáneas completas por pista.
 */
export class ComandoMoverClaves implements Comando {
  public readonly Descripcion: string;
  private ClavesAntes = new Map<string, ClaveAnimacion[]>();
  private ClavesDespues = new Map<string, ClaveAnimacion[]>();

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly Movimientos: Array<{
      PistaId: string;
      ClaveId: string;
      TiempoAnterior: number;
      TiempoNuevo: number;
    }>,
    clavesAntes?: Map<string, ClaveAnimacion[]>
  ) {
    this.Descripcion = Movimientos.length > 1
      ? `Mover ${Movimientos.length} claves`
      : 'Mover clave';
    if (clavesAntes) {
      for (const [Id, Claves] of clavesAntes) {
        this.ClavesAntes.set(Id, Claves.map(ClonarClave));
      }
    }
  }

  public CapturarDespues(): void {
    this.ClavesDespues.clear();
    for (const PistaId of this.ClavesAntes.keys()) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === PistaId);
      if (Pista) {
        this.ClavesDespues.set(PistaId, Pista.Claves.map(ClonarClave));
      }
    }
  }

  public Ejecutar(): void {
    if (this.ClavesDespues.size > 0) {
      for (const [PistaId, Claves] of this.ClavesDespues) {
        const Pista = this.Anim.Pistas.find((P) => P.Id === PistaId);
        if (Pista && !Pista.Bloqueada) {
          Pista.Claves = Claves.map(ClonarClave);
        }
      }
      this.Anim.NotificarCambioPistas('mover-claves');
      this.Anim.EvaluarEn(this.Anim.TiempoActual);
      return;
    }

    const PorPista = new Map<string, typeof this.Movimientos>();
    for (const M of this.Movimientos) {
      let Lista = PorPista.get(M.PistaId);
      if (!Lista) {
        Lista = [];
        PorPista.set(M.PistaId, Lista);
      }
      Lista.push(M);
    }

    for (const [PistaId, Lista] of PorPista) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === PistaId);
      if (!Pista || Pista.Bloqueada) continue;
      if (!this.ClavesAntes.has(PistaId)) {
        this.ClavesAntes.set(PistaId, Pista.Claves.map(ClonarClave));
      }
      for (const M of Lista) {
        const Clave = Pista.Claves.find((C) => C.Id === M.ClaveId);
        if (Clave) Clave.Tiempo = Limitar(M.TiempoNuevo, 0, this.Anim.Duracion);
      }
      Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
      this.ClavesDespues.set(PistaId, Pista.Claves.map(ClonarClave));
    }
    this.Anim.NotificarCambioPistas('mover-claves');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    if (this.ClavesDespues.size === 0) {
      this.CapturarDespues();
    }
    for (const [PistaId, Claves] of this.ClavesAntes) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === PistaId);
      if (Pista) {
        Pista.Claves = Claves.map(ClonarClave);
      }
    }
    this.Anim.NotificarCambioPistas('deshacer-mover-claves');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Inserta o sobrescribe toda la pose actual del modelo VRM como una acción atómica.
 */
export class ComandoInsertarPose implements Comando {
  public readonly Descripcion: string;
  public Insertadas = 0;
  public Sobrescritas = 0;

  private SnapshotAntes: PistaAnimacion[] | null = null;
  private SnapshotDespues: PistaAnimacion[] | null = null;

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly Tiempo: number,
    private readonly Interpolacion: TipoInterpolacion = 'Suave'
  ) {
    this.Descripcion = `Pose completa (${Tiempo.toFixed(2)}s)`;
  }

  public Ejecutar(): void {
    if (!this.SnapshotAntes) {
      this.SnapshotAntes = this.Anim.Pistas.map(ClonarPista);
    }
    if (this.SnapshotDespues) {
      this.Anim.Pistas = this.SnapshotDespues.map(ClonarPista);
      this.Anim.NotificarCambioPistas('rehacer-pose');
      this.Anim.EvaluarEn(this.Anim.TiempoActual);
      return;
    }

    const Res = this.Anim.InsertarPoseCompleta(this.Tiempo, this.Interpolacion);
    this.Insertadas = Res.Insertadas;
    this.Sobrescritas = Res.Sobrescritas;
    this.SnapshotDespues = this.Anim.Pistas.map(ClonarPista);
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    if (!this.SnapshotAntes) return;
    this.Anim.Pistas = this.SnapshotAntes.map(ClonarPista);
    this.Anim.NotificarCambioPistas('deshacer-pose');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Elimina una pista específica o todas las pistas de una capa/grupo.
 */
export class ComandoEliminarPista implements Comando {
  public readonly Descripcion: string;
  private SnapshotAntes: PistaAnimacion[] = [];

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly Objetivo: { tipo: 'pista'; pistaId: string; nombre: string } | { tipo: 'grupo'; grupo: GrupoPista },
    private readonly Estado?: EstadoEstudio
  ) {
    this.Descripcion = Objetivo.tipo === 'pista'
      ? `Eliminar pista "${Objetivo.nombre}"`
      : `Eliminar capa "${Objetivo.grupo}"`;
  }

  public Ejecutar(): void {
    this.SnapshotAntes = this.Anim.Pistas.map(ClonarPista);
    if (this.Objetivo.tipo === 'pista') {
      const PistaId = this.Objetivo.pistaId;
      this.Anim.EliminarPista(PistaId);
      if (this.Estado) {
        this.Estado.EstablecerSeleccion(
          this.Estado.SeleccionClaves.filter((S) => S.PistaId !== PistaId)
        );
      }
    } else {
      const Grupo = this.Objetivo.grupo;
      const IdsGrupo = new Set(this.Anim.Pistas.filter((P) => P.Grupo === Grupo).map((P) => P.Id));
      this.Anim.EliminarPistasPorGrupo(Grupo);
      if (this.Estado) {
        this.Estado.EstablecerSeleccion(
          this.Estado.SeleccionClaves.filter((S) => !IdsGrupo.has(S.PistaId))
        );
      }
    }
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    this.Anim.Pistas = this.SnapshotAntes.map(ClonarPista);
    this.Anim.NotificarCambioPistas('deshacer-eliminar-pista');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Integra pistas importadas soportando fusión, sobrescritura de rango o reemplazo de capa.
 */
export class ComandoImportarAnimacion implements Comando {
  public readonly Descripcion: string;
  private SnapshotAntes: PistaAnimacion[] = [];
  private DuracionAntes = 10;

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly NuevasPistas: PistaAnimacion[],
    private readonly Opciones: OpcionesImportacionAnimacion,
    private readonly DuracionClip: number,
    NombreArchivo: string
  ) {
    this.Descripcion = `Importar animación "${NombreArchivo}"`;
  }

  public Ejecutar(): void {
    this.SnapshotAntes = this.Anim.Pistas.map(ClonarPista);
    this.DuracionAntes = this.Anim.Duracion;

    const ClonesNuevas = this.NuevasPistas.map(ClonarPista);
    let MaxTiempo = 0;
    for (const P of ClonesNuevas) {
      for (const C of P.Claves) {
        if (C.Tiempo > MaxTiempo) MaxTiempo = C.Tiempo;
      }
    }
    if (MaxTiempo > this.Anim.Duracion) {
      this.Anim.Duracion = Limitar(Math.ceil(MaxTiempo), 1, 600);
    }

    if (this.Opciones.Modo === 'ReemplazarGrupo') {
      this.Anim.Pistas = this.Anim.Pistas.filter((P) => P.Grupo !== this.Opciones.GrupoDestino);
      this.Anim.AgregarPistas(ClonesNuevas);
    } else if (this.Opciones.Modo === 'SobrescribirRango') {
      const Ini = Math.max(0, this.Opciones.TiempoInicio - 0.002);
      const Fin = this.Opciones.TiempoInicio + Math.max(0.05, this.DuracionClip * this.Opciones.EscalaTiempo) + 0.002;
      for (const Nueva of ClonesNuevas) {
        const Existente = this.Anim.BuscarPista(Nueva.Tipo, Nueva.Objetivo, Nueva.Grupo);
        if (Existente && !Existente.Bloqueada) {
          Existente.Claves = Existente.Claves.filter((C) => C.Tiempo < Ini || C.Tiempo > Fin);
        }
      }
      this.Anim.AgregarPistas(ClonesNuevas);
    } else {
      this.Anim.AgregarPistas(ClonesNuevas);
    }

    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    this.Anim.Pistas = this.SnapshotAntes.map(ClonarPista);
    this.Anim.Duracion = this.DuracionAntes;
    this.Anim.NotificarCambioPistas('deshacer-importar');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Optimiza claves redundantes de una lista de pistas con RDP.
 */
export class ComandoSimplificarPistas implements Comando {
  public readonly Descripcion: string;
  public ClavesAntesTotal = 0;
  public ClavesDespuesTotal = 0;

  private SnapshotsAntes = new Map<string, ClaveAnimacion[]>();

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly PistaIds: string[],
    private readonly Tolerancia = 0.015
  ) {
    this.Descripcion = `Simplificar ${PistaIds.length} pista(s)`;
  }

  public Ejecutar(): void {
    this.SnapshotsAntes.clear();
    this.ClavesAntesTotal = 0;
    this.ClavesDespuesTotal = 0;

    for (const Id of this.PistaIds) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === Id);
      if (!Pista || Pista.Bloqueada) continue;
      this.SnapshotsAntes.set(Id, Pista.Claves.map(ClonarClave));
      this.ClavesAntesTotal += Pista.Claves.length;
      Pista.Claves = this.Anim.SimplificarClaves(Pista.Claves, this.Tolerancia);
      this.ClavesDespuesTotal += Pista.Claves.length;
    }

    this.Anim.NotificarCambioPistas('simplificar-pistas');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    for (const [Id, Claves] of this.SnapshotsAntes) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === Id);
      if (Pista) Pista.Claves = Claves.map(ClonarClave);
    }
    this.Anim.NotificarCambioPistas('deshacer-simplificar');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Desplaza todas las claves de un conjunto de pistas en el tiempo.
 */
export class ComandoDesplazarPistas implements Comando {
  public readonly Descripcion: string;
  private SnapshotsAntes = new Map<string, ClaveAnimacion[]>();

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly PistaIds: string[],
    private readonly DeltaSegundos: number
  ) {
    const Signo = DeltaSegundos >= 0 ? '+' : '';
    this.Descripcion = `Desplazar pistas (${Signo}${DeltaSegundos.toFixed(2)}s)`;
  }

  public Ejecutar(): void {
    this.SnapshotsAntes.clear();
    for (const Id of this.PistaIds) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === Id);
      if (!Pista || Pista.Bloqueada) continue;
      this.SnapshotsAntes.set(Id, Pista.Claves.map(ClonarClave));
      for (const C of Pista.Claves) {
        C.Tiempo = Limitar(C.Tiempo + this.DeltaSegundos, 0, this.Anim.Duracion);
      }
      Pista.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
    }
    this.Anim.NotificarCambioPistas('desplazar-pistas');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    for (const [Id, Claves] of this.SnapshotsAntes) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === Id);
      if (Pista) Pista.Claves = Claves.map(ClonarClave);
    }
    this.Anim.NotificarCambioPistas('deshacer-desplazar');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Cambia la estrategia de interpolación para un lote de claves seleccionadas.
 */
export class ComandoCambiarInterpolacionLote implements Comando {
  public readonly Descripcion: string;
  private Previos: Array<{ PistaId: string; ClaveId: string; Interpolacion: TipoInterpolacion | undefined }> = [];

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly Seleccion: SeleccionClave[],
    private readonly NuevaInterpolacion: TipoInterpolacion
  ) {
    this.Descripcion = `Curva "${NuevaInterpolacion}" en ${Seleccion.length} clave(s)`;
  }

  public Ejecutar(): void {
    this.Previos = [];
    for (const Sel of this.Seleccion) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === Sel.PistaId);
      const Clave = Pista?.Claves.find((C) => C.Id === Sel.ClaveId);
      if (!Pista || !Clave || Pista.Bloqueada) continue;
      this.Previos.push({ PistaId: Sel.PistaId, ClaveId: Sel.ClaveId, Interpolacion: Clave.Interpolacion });
      Clave.Interpolacion = this.NuevaInterpolacion;
    }
    this.Anim.NotificarCambioPistas('interpolacion-lote');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    for (const Prev of this.Previos) {
      const Pista = this.Anim.Pistas.find((P) => P.Id === Prev.PistaId);
      const Clave = Pista?.Claves.find((C) => C.Id === Prev.ClaveId);
      if (Clave) Clave.Interpolacion = Prev.Interpolacion;
    }
    this.Anim.NotificarCambioPistas('deshacer-interpolacion-lote');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

/**
 * Pega claves desde el portapapeles interno alineadas al TiempoDestino.
 */
export class ComandoPegarClaves implements Comando {
  public readonly Descripcion: string;
  public ClavesPegadas: SeleccionClave[] = [];

  private SnapshotAntes: PistaAnimacion[] = [];
  private SeleccionAntes: SeleccionClave[] = [];

  constructor(
    private readonly Anim: GestorAnimacion,
    private readonly Portapapeles: ContenidoPortapapeles,
    private readonly TiempoDestino: number,
    private readonly Estado?: EstadoEstudio
  ) {
    this.Descripcion = `Pegar ${Portapapeles.Claves.length} clave(s) en ${TiempoDestino.toFixed(2)}s`;
  }

  public Ejecutar(): void {
    this.SnapshotAntes = this.Anim.Pistas.map(ClonarPista);
    this.SeleccionAntes = this.Estado ? this.Estado.SeleccionClaves.map((S) => ({ ...S })) : [];
    this.ClavesPegadas = [];

    for (const Item of this.Portapapeles.Claves) {
      const Pista = this.Anim.ObtenerOCrearPista(Item.Tipo, Item.Objetivo, Item.Grupo);
      if (Pista.Bloqueada) continue;
      const T = Limitar(this.TiempoDestino + Item.DeltaTiempo, 0, this.Anim.Duracion);
      const Res = this.Anim.GuardarClave(Pista, T, Item.Valor, Item.Interpolacion, 0.008);
      this.ClavesPegadas.push({ PistaId: Pista.Id, ClaveId: Res.Clave.Id });
    }

    if (this.Estado && this.ClavesPegadas.length > 0) {
      this.Estado.EstablecerSeleccion(this.ClavesPegadas);
    }
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }

  public Deshacer(): void {
    this.Anim.Pistas = this.SnapshotAntes.map(ClonarPista);
    if (this.Estado) {
      this.Estado.EstablecerSeleccion(this.SeleccionAntes);
    }
    this.Anim.NotificarCambioPistas('deshacer-pegar');
    this.Anim.EvaluarEn(this.Anim.TiempoActual);
  }
}

export { ComandoLote };

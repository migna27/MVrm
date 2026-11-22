// ============================================================================
// LineaTiempo.ts — Línea de tiempo interactiva de estudio (optimizada)
// Incluye render por dirty-flag, caché de filas y onda de audio, culling
// por búsqueda binaria O(log K), filas resumen Dope-Sheet por capa,
// multiselección (caja/Shift), Alt+Arrastre para duplicar, controles M/Lock/Clave
// y soporte para menú contextual.
// ============================================================================

import { ContextoAplicacion } from '../Contexto';
import {
  ClaveAnimacion, PistaAnimacion, COLORES_GRUPO, PRIORIDAD_GRUPOS,
  GrupoPista, SeleccionClave, TipoInterpolacion
} from '../Tipos';
import { ClavePortapapeles } from '../Arquitectura/EstadoEstudio';
import {
  ComandoEliminarClaves, ComandoGuardarClave, ComandoLote,
  ComandoMoverClaves, ComandoPegarClaves
} from '../Arquitectura/ComandosAnimacion';
import { FormatearTiempo, GenerarId, Limitar } from '../Utilidades';

const ALTO_REGLA = 30;
const ALTO_FILA = 28;
const ALTO_FILA_AUDIO = 46;
const ANCHO_ETIQUETAS = 224;
const RADIO_CLAVE = 6;
const COLOR_SOBRESCRIBIR = '#fbbf24';

type ModoArrastre =
  | 'Ninguno'
  | 'Buscar'
  | 'MoverClaves'
  | 'SeleccionCaja'
  | 'Paneo'
  | 'BucleInicio'
  | 'BucleFin';

export interface ObjetivoContextoTimeline {
  Tipo: 'clave' | 'pista' | 'grupo' | 'vacio';
  Tiempo: number;
  Pista?: PistaAnimacion;
  Clave?: ClaveAnimacion;
  Grupo?: GrupoPista;
}

interface FilaTimeline {
  TipoFila: 'Grupo' | 'Pista';
  Grupo: GrupoPista;
  Pista?: PistaAnimacion;
}

interface ResumenGrupo {
  TotalPistas: number;
  TotalClaves: number;
  TiempoMin: number;
  TiempoMax: number;
  TiemposUnicos: number[];
  Silenciadas: number;
  Bloqueadas: number;
}

interface MovimientoInicial {
  PistaId: string;
  ClaveId: string;
  TiempoInicial: number;
}

interface HoverInfo {
  X: number;
  Y: number;
  PistaNombre: string;
  Tiempo: number;
  Interpolacion: TipoInterpolacion;
  ResumenValor: string;
}

export class LineaTiempo {
  public PxPorSegundo = 80;
  public AlAbrirMenuContextual?: (evento: MouseEvent, objetivo: ObjetivoContextoTimeline) => void;
  public AlSoltarArchivo?: (archivo: File, tiempo: number) => void;
  public AlCambiarZoom?: (pxPorSegundo: number) => void;

  private Contexto2D: CanvasRenderingContext2D;
  private DesplazamientoX = 0;
  private DesplazamientoY = 0;
  private Modo: ModoArrastre = 'Ninguno';

  // Estado de rendimiento (dirty-flag + caches)
  private Sucio = true;
  private FilasSucias = true;
  private RafProgramado = false;
  private AudioCacheSucio = true;
  private FilasCache: FilaTimeline[] = [];
  private ResumenGrupos = new Map<GrupoPista, ResumenGrupo>();
  private Desuscripciones: (() => void)[] = [];

  // Caché offscreen de forma de onda del audio
  private CanvasAudio: HTMLCanvasElement | null = null;
  private FirmaAudioCache = '';

  // Estado de interacción / arrastre
  private MouseInicioX = 0;
  private MouseInicioY = 0;
  private MouseActualX = 0;
  private MouseActualY = 0;
  private DespInicioX = 0;
  private DespInicioY = 0;
  private TiempoAnclaArrastre = 0;
  private MovimientosActivos: MovimientoInicial[] = [];
  private ClavesAntesArrastre = new Map<string, ClaveAnimacion[]>();
  private PistasAntesDuplicado: PistaAnimacion[] | null = null;
  private DuplicadoEnCurso = false;
  private SeMovioEnArrastre = false;
  private AltEnArrastre = false;
  private HoverClave: HoverInfo | null = null;

  constructor(private Lienzo: HTMLCanvasElement, private Contexto: ContextoAplicacion) {
    this.Contexto2D = Lienzo.getContext('2d')!;
    this.SuscribirEventos();
    this.VincularEventos();
    new ResizeObserver(() => this.SolicitarDibujo()).observe(Lienzo.parentElement!);
  }

  /** Compatibilidad para consultas de selección única heredadas. */
  public get Seleccion(): SeleccionClave | null {
    return this.Contexto.Estado?.SeleccionPrincipal ?? null;
  }

  private SuscribirEventos(): void {
    const Bus = this.Contexto.Bus;
    if (!Bus) return;
    this.Desuscripciones.push(
      Bus.Suscribir('pistas:cambiadas', () => {
        this.FilasSucias = true;
        this.SolicitarDibujo();
      }),
      Bus.Suscribir('tiempo:cambiado', () => {
        this.SolicitarDibujo();
      }),
      Bus.Suscribir('seleccion:cambiada', () => {
        this.SolicitarDibujo();
      }),
      Bus.Suscribir('audio:cambiado', () => {
        this.AudioCacheSucio = true;
        this.SolicitarDibujo();
      }),
      Bus.Suscribir('estudio:configuracion', () => {
        this.FilasSucias = true;
        this.SolicitarDibujo();
      }),
      Bus.Suscribir('proyecto:cargado', () => {
        this.FilasSucias = true;
        this.AudioCacheSucio = true;
        this.SolicitarDibujo();
      })
    );
  }

  public Destruir(): void {
    for (const Desuscribir of this.Desuscripciones) Desuscribir();
    this.Desuscripciones = [];
  }

  /** Programa un único redibujado coalescido en el próximo frame de animación. */
  public SolicitarDibujo(): void {
    this.Sucio = true;
    if (this.RafProgramado) return;
    this.RafProgramado = true;
    requestAnimationFrame(() => {
      this.RafProgramado = false;
      if (this.Sucio) {
        this.Sucio = false;
        this.Dibujar();
      }
    });
  }

  // --------------------------------------------------------------------------
  // Caché de filas y resúmenes de capa (Dope-Sheet)
  // --------------------------------------------------------------------------

  private AsegurarFilasCache(): FilaTimeline[] {
    if (!this.FilasSucias) return this.FilasCache;
    this.FilasSucias = false;

    const Pistas = this.Contexto.Animacion.Pistas;
    const Filtro = (this.Contexto.Estado?.FiltroPistas ?? '').trim().toLowerCase();
    const Expandidos = this.Contexto.Estado?.GruposExpandidos ?? { Manual: true, Preajuste: true, Importado: true };

    const PistasFiltradas = Filtro
      ? Pistas.filter((P) =>
          P.Nombre.toLowerCase().includes(Filtro) ||
          P.Objetivo.toLowerCase().includes(Filtro) ||
          P.Grupo.toLowerCase().includes(Filtro)
        )
      : Pistas;

    const Filas: FilaTimeline[] = [];
    this.ResumenGrupos.clear();

    // Mostrar capas manuales/editables arriba para acceso inmediato
    const OrdenVisual = [...PRIORIDAD_GRUPOS].reverse();
    for (const Grupo of OrdenVisual) {
      const PistasGrupo = PistasFiltradas.filter((P) => P.Grupo === Grupo);
      if (PistasGrupo.length === 0) continue;

      const ConjuntoTiempos = new Set<number>();
      let TotalClaves = 0;
      let TMin = Infinity;
      let TMax = -Infinity;
      let Silenciadas = 0;
      let Bloqueadas = 0;

      for (const P of PistasGrupo) {
        if (P.Silenciada) Silenciadas++;
        if (P.Bloqueada) Bloqueadas++;
        for (const C of P.Claves) {
          TotalClaves++;
          if (C.Tiempo < TMin) TMin = C.Tiempo;
          if (C.Tiempo > TMax) TMax = C.Tiempo;
          ConjuntoTiempos.add(Math.round(C.Tiempo * 50) / 50);
        }
      }

      this.ResumenGrupos.set(Grupo, {
        TotalPistas: PistasGrupo.length,
        TotalClaves,
        TiempoMin: Number.isFinite(TMin) ? TMin : 0,
        TiempoMax: Number.isFinite(TMax) ? TMax : 0,
        TiemposUnicos: [...ConjuntoTiempos].sort((A, B) => A - B),
        Silenciadas,
        Bloqueadas
      });

      Filas.push({ TipoFila: 'Grupo', Grupo });
      if (Expandidos[Grupo]) {
        for (const Pista of PistasGrupo) {
          Filas.push({ TipoFila: 'Pista', Grupo, Pista });
        }
      }
    }

    this.FilasCache = Filas;
    return Filas;
  }

  // --------------------------------------------------------------------------
  // Conversión tiempo ↔ píxeles y búsqueda binaria visual
  // --------------------------------------------------------------------------

  private TiempoAPixeles(Tiempo: number): number {
    return ANCHO_ETIQUETAS + Tiempo * this.PxPorSegundo - this.DesplazamientoX;
  }

  private PixelesATiempo(X: number): number {
    return (X - ANCHO_ETIQUETAS + this.DesplazamientoX) / this.PxPorSegundo;
  }

  private AlturaTotal(): number {
    const Filas = this.AsegurarFilasCache();
    const FilasAudio = this.Contexto.Audio.Buffer ? 1 : 0;
    return ALTO_REGLA + Filas.length * ALTO_FILA + FilasAudio * ALTO_FILA_AUDIO + 16;
  }

  private BuscarPrimerIndiceVisible(Claves: ClaveAnimacion[], TiempoInicio: number): number {
    let Bajo = 0;
    let Alto = Claves.length - 1;
    let Respuesta = Claves.length;
    while (Bajo <= Alto) {
      const Medio = (Bajo + Alto) >> 1;
      if (Claves[Medio].Tiempo >= TiempoInicio) {
        Respuesta = Medio;
        Alto = Medio - 1;
      } else {
        Bajo = Medio + 1;
      }
    }
    return Math.max(0, Respuesta - 1);
  }

  // --------------------------------------------------------------------------
  // Operaciones públicas de edición y navegación
  // --------------------------------------------------------------------------

  public AjustarVista(): void {
    const AnchoDisponible = Math.max(120, this.Lienzo.clientWidth - ANCHO_ETIQUETAS - 28);
    const Duracion = Math.max(1, this.Contexto.Animacion.Duracion);
    this.PxPorSegundo = Limitar(AnchoDisponible / Duracion, 12, 480);
    this.DesplazamientoX = 0;
    this.DesplazamientoY = 0;
    this.AlCambiarZoom?.(this.PxPorSegundo);
    this.SolicitarDibujo();
  }

  /** Elimina todas las claves seleccionadas (con historial Undo/Redo). */
  public EliminarSeleccion(): void {
    const Estado = this.Contexto.Estado;
    const Seleccion = Estado ? [...Estado.SeleccionClaves] : [];
    if (Seleccion.length === 0) return;

    const Cmd = new ComandoEliminarClaves(this.Contexto.Animacion, Seleccion, Estado);
    if (this.Contexto.Historial) {
      this.Contexto.Historial.Ejecutar(Cmd);
    } else {
      Cmd.Ejecutar();
    }
    if (Cmd.ClavesEliminadas > 0) {
      this.Contexto.NotificarEstado(
        `${Cmd.ClavesEliminadas} clave(s) eliminada(s).`,
        'info',
        true
      );
    } else {
      this.Contexto.NotificarEstado('La pista está bloqueada; desbloquéala para eliminar claves.', 'aviso');
    }
  }

  /** Copia las claves seleccionadas al portapapeles interno del estudio. */
  public CopiarSeleccion(): number {
    const Estado = this.Contexto.Estado;
    const Anim = this.Contexto.Animacion;
    if (!Estado || Estado.SeleccionClaves.length === 0) return 0;

    const Pares: Array<{ Pista: PistaAnimacion; Clave: ClaveAnimacion }> = [];
    let MinT = Infinity;

    for (const Sel of Estado.SeleccionClaves) {
      const Pista = Anim.Pistas.find((P) => P.Id === Sel.PistaId);
      const Clave = Pista?.Claves.find((C) => C.Id === Sel.ClaveId);
      if (Pista && Clave) {
        Pares.push({ Pista, Clave });
        if (Clave.Tiempo < MinT) MinT = Clave.Tiempo;
      }
    }
    if (Pares.length === 0) return 0;

    const Claves: ClavePortapapeles[] = Pares.map(({ Pista, Clave }) => ({
      Tipo: Pista.Tipo,
      Objetivo: Pista.Objetivo,
      Grupo: Pista.Grupo,
      DeltaTiempo: Clave.Tiempo - MinT,
      Valor: [...Clave.Valor],
      Interpolacion: Clave.Interpolacion ?? 'Suave'
    }));

    Estado.Portapapeles = { Claves, TiempoOrigen: MinT };
    this.Contexto.NotificarEstado(`${Claves.length} clave(s) copiadas.`, 'info');
    return Claves.length;
  }

  /** Pega las claves copiadas alineadas al cabezal actual (o tiempo indicado). */
  public PegarEnCabezal(TiempoDestino?: number): void {
    const Estado = this.Contexto.Estado;
    if (!Estado?.Portapapeles || Estado.Portapapeles.Claves.length === 0) {
      this.Contexto.NotificarEstado('No hay claves copiadas en el portapapeles.', 'aviso');
      return;
    }
    const T = TiempoDestino ?? this.Contexto.Animacion.TiempoActual;
    const Cmd = new ComandoPegarClaves(this.Contexto.Animacion, Estado.Portapapeles, T, Estado);
    if (this.Contexto.Historial) {
      this.Contexto.Historial.Ejecutar(Cmd);
    } else {
      Cmd.Ejecutar();
    }
    this.Contexto.NotificarEstado(
      `${Cmd.ClavesPegadas.length} clave(s) pegadas en ${FormatearTiempo(T)}.`,
      'exito',
      true
    );
  }

  /** Duplica las claves seleccionadas directamente hacia el cabezal actual. */
  public DuplicarSeleccionAlCabezal(): void {
    const N = this.CopiarSeleccion();
    if (N === 0) return;
    const Estado = this.Contexto.Estado;
    const Anim = this.Contexto.Animacion;
    let Destino = Anim.TiempoActual;
    if (Estado?.Portapapeles && Math.abs(Destino - Estado.Portapapeles.TiempoOrigen) < 0.02) {
      Destino = Math.min(Anim.Duracion, Destino + 0.25);
    }
    this.PegarEnCabezal(Destino);
  }

  /** Selecciona todas las claves visibles actualmente en el timeline. */
  public SeleccionarTodas(): void {
    const Estado = this.Contexto.Estado;
    if (!Estado) return;
    const Filas = this.AsegurarFilasCache();
    const Todas: SeleccionClave[] = [];
    for (const F of Filas) {
      if (F.TipoFila !== 'Pista' || !F.Pista) continue;
      for (const C of F.Pista.Claves) {
        Todas.push({ PistaId: F.Pista.Id, ClaveId: C.Id });
      }
    }
    Estado.EstablecerSeleccion(Todas);
  }

  // --------------------------------------------------------------------------
  // Eventos de ratón e interacción
  // --------------------------------------------------------------------------

  private VincularEventos(): void {
    const Posicion = (E: MouseEvent) => {
      const Rect = this.Lienzo.getBoundingClientRect();
      return { X: E.clientX - Rect.left, Y: E.clientY - Rect.top };
    };

    this.Lienzo.addEventListener('mousedown', (E) => {
      const { X, Y } = Posicion(E);
      const Anim = this.Contexto.Animacion;
      const Estado = this.Contexto.Estado;

      this.MouseInicioX = X;
      this.MouseInicioY = Y;
      this.MouseActualX = X;
      this.MouseActualY = Y;
      this.SeMovioEnArrastre = false;

      // Botón central: paneo 2D libre
      if (E.button === 1) {
        E.preventDefault();
        this.Modo = 'Paneo';
        this.DespInicioX = this.DesplazamientoX;
        this.DespInicioY = this.DesplazamientoY;
        return;
      }

      if (E.button !== 0) return;

      // 1. Clic dentro de la columna de cabeceras izquierda
      if (X <= ANCHO_ETIQUETAS) {
        this.ManejarClicCabecera(X, Y);
        return;
      }

      // 2. Clic en la regla superior (manijas de rango de bucle o scrubbing)
      if (Y <= ALTO_REGLA) {
        if (Estado?.RangoBucle.Activo) {
          const XIni = this.TiempoAPixeles(Estado.RangoBucle.Inicio);
          const XFin = this.TiempoAPixeles(Estado.RangoBucle.Fin);
          if (Math.abs(X - XIni) <= 8) {
            this.Modo = 'BucleInicio';
            return;
          }
          if (Math.abs(X - XFin) <= 8) {
            this.Modo = 'BucleFin';
            return;
          }
        }
        this.Modo = 'Buscar';
        const T = Limitar(this.PixelesATiempo(X), 0, Anim.Duracion);
        Anim.EstablecerTiempo(T, 'usuario');
        Anim.EvaluarEn(Anim.TiempoActual);
        this.SolicitarDibujo();
        return;
      }

      // 3. Clic en una clave individual
      const Tocado = this.BuscarClaveEn(X, Y);
      if (Tocado) {
        if (E.shiftKey) {
          Estado?.AlternarSeleccion(Tocado.PistaId, Tocado.ClaveId);
        } else if (!Estado?.EstaSeleccionada(Tocado.PistaId, Tocado.ClaveId)) {
          Estado?.SeleccionarUna(Tocado.PistaId, Tocado.ClaveId);
        }
        this.IniciarArrastreClaves(X, E.altKey);
        return;
      }

      // 4. Clic en diamante resumen de capa (Dope-Sheet)
      const ResumenTocado = this.BuscarResumenGrupoEn(X, Y);
      if (ResumenTocado) {
        const ClavesCapa = Anim.ObtenerClavesEnTiempo(ResumenTocado.Tiempo, ResumenTocado.Grupo, 0.025)
          .map((Par) => ({ PistaId: Par.Pista.Id, ClaveId: Par.Clave.Id }));
        if (ClavesCapa.length > 0) {
          Estado?.EstablecerSeleccion(ClavesCapa);
          this.IniciarArrastreClaves(X, E.altKey);
          return;
        }
      }

      // 5. Clic en zona vacía: preparar caja de selección (o mover cabezal si no arrastra)
      this.Modo = 'SeleccionCaja';
      this.SolicitarDibujo();
    });

    this.Lienzo.addEventListener('dblclick', (E) => {
      const { X, Y } = Posicion(E);
      if (X <= ANCHO_ETIQUETAS || Y <= ALTO_REGLA) return;
      const Pista = this.BuscarPistaEnY(Y);
      if (!Pista) return;
      if (Pista.Bloqueada) {
        this.Contexto.NotificarEstado(`La pista "${Pista.Nombre}" está bloqueada.`, 'aviso');
        return;
      }
      const Tiempo = this.Contexto.Estado
        ? this.Contexto.Estado.AjustarTiempoConIman(this.PixelesATiempo(X), E.shiftKey)
        : Limitar(this.PixelesATiempo(X), 0, this.Contexto.Animacion.Duracion);
      const Valor = this.Contexto.Animacion.ObtenerValorActualObjetivo(Pista.Tipo, Pista.Objetivo);
      if (!Valor) return;

      const Interp = this.Contexto.Estado?.InterpolacionPorDefecto ?? 'Suave';
      const Cmd = new ComandoGuardarClave(
        this.Contexto.Animacion,
        Pista.Tipo,
        Pista.Objetivo,
        Pista.Grupo,
        Tiempo,
        Valor,
        Interp
      );
      if (this.Contexto.Historial) this.Contexto.Historial.Ejecutar(Cmd);
      else Cmd.Ejecutar();

      this.Contexto.Estado?.SeleccionarUna(Pista.Id, Cmd.ClaveResultanteId);
      this.Contexto.NotificarEstado(
        Cmd.FueSobrescritura
          ? `Clave sobrescrita en ${Pista.Nombre} (${FormatearTiempo(Tiempo)}).`
          : `Clave creada en ${Pista.Nombre} (${FormatearTiempo(Tiempo)}).`,
        'exito',
        true
      );
    });

    window.addEventListener('mousemove', (E) => {
      const { X, Y } = Posicion(E);
      const Anim = this.Contexto.Animacion;
      const Estado = this.Contexto.Estado;

      if (this.Modo === 'Ninguno') {
        this.ActualizarHover(X, Y);
        return;
      }

      this.MouseActualX = X;
      this.MouseActualY = Y;
      if (Math.hypot(X - this.MouseInicioX, Y - this.MouseInicioY) > 3) {
        this.SeMovioEnArrastre = true;
      }

      if (this.Modo === 'Buscar') {
        const T = Limitar(this.PixelesATiempo(X), 0, Anim.Duracion);
        Anim.EstablecerTiempo(T, 'usuario');
        Anim.EvaluarEn(Anim.TiempoActual);
        this.SolicitarDibujo();
      } else if (this.Modo === 'Paneo') {
        this.DesplazamientoX = Math.max(0, this.DespInicioX - (X - this.MouseInicioX));
        const MaxY = Math.max(0, this.AlturaTotal() - this.Lienzo.clientHeight);
        this.DesplazamientoY = Limitar(this.DespInicioY - (Y - this.MouseInicioY), 0, MaxY);
        this.SolicitarDibujo();
      } else if (this.Modo === 'BucleInicio' && Estado) {
        const T = Estado.AjustarTiempoConIman(this.PixelesATiempo(X), E.shiftKey);
        Estado.EstablecerRangoBucle({ Inicio: Math.min(T, Estado.RangoBucle.Fin - 0.1) }, Anim.Duracion);
        this.SolicitarDibujo();
      } else if (this.Modo === 'BucleFin' && Estado) {
        const T = Estado.AjustarTiempoConIman(this.PixelesATiempo(X), E.shiftKey);
        Estado.EstablecerRangoBucle({ Fin: Math.max(T, Estado.RangoBucle.Inicio + 0.1) }, Anim.Duracion);
        this.SolicitarDibujo();
      } else if (this.Modo === 'MoverClaves') {
        if (!this.SeMovioEnArrastre) return;

        // Duplicado bajo Alt+Arrastre en cuanto comienza un desplazamiento real
        if (this.AltEnArrastre && !this.DuplicadoEnCurso) {
          this.ActivarDuplicadoEnArrastre();
        }

        const TiempoCursor = this.PixelesATiempo(X);
        const DeltaRaw = TiempoCursor - this.TiempoAnclaArrastre;
        const TiempoDestinoAncla = Estado
          ? Estado.AjustarTiempoConIman(this.TiempoAnclaArrastre + DeltaRaw, E.shiftKey)
          : this.TiempoAnclaArrastre + DeltaRaw;
        const Delta = TiempoDestinoAncla - this.TiempoAnclaArrastre;

        const PistasTocadas = new Set<PistaAnimacion>();
        for (const M of this.MovimientosActivos) {
          const Pista = Anim.Pistas.find((P) => P.Id === M.PistaId);
          if (!Pista || Pista.Bloqueada) continue;
          const Clave = Pista.Claves.find((C) => C.Id === M.ClaveId);
          if (!Clave) continue;
          Clave.Tiempo = Limitar(M.TiempoInicial + Delta, 0, Anim.Duracion);
          PistasTocadas.add(Pista);
        }
        for (const P of PistasTocadas) {
          P.Claves.sort((A, B) => A.Tiempo - B.Tiempo);
        }
        Anim.NotificarCambioPistas('arrastre-claves');
        Anim.EvaluarEn(Anim.TiempoActual);
      } else if (this.Modo === 'SeleccionCaja') {
        this.SolicitarDibujo();
      }
    });

    window.addEventListener('mouseup', (E) => {
      if (this.Modo === 'Ninguno') return;
      const ModoAnterior = this.Modo;
      this.Modo = 'Ninguno';
      const Anim = this.Contexto.Animacion;
      const Estado = this.Contexto.Estado;

      if (ModoAnterior === 'SeleccionCaja') {
        if (!this.SeMovioEnArrastre) {
          if (!E.shiftKey) Estado?.LimpiarSeleccion();
          const T = Limitar(this.PixelesATiempo(this.MouseInicioX), 0, Anim.Duracion);
          Anim.EstablecerTiempo(T, 'usuario');
          Anim.EvaluarEn(Anim.TiempoActual);
        } else {
          this.AplicarSeleccionCaja(E.shiftKey);
        }
      } else if (ModoAnterior === 'MoverClaves' && this.SeMovioEnArrastre) {
        this.FinalizarArrastreClaves();
      }

      this.MovimientosActivos = [];
      this.ClavesAntesArrastre.clear();
      this.PistasAntesDuplicado = null;
      this.DuplicadoEnCurso = false;
      this.SolicitarDibujo();
    });

    // Rueda: zoom con Ctrl, paneo horizontal con Shift, desplazamiento vertical
    this.Lienzo.addEventListener('wheel', (E) => {
      E.preventDefault();
      const { X } = Posicion(E);
      if (E.ctrlKey || E.metaKey) {
        const Factor = E.deltaY < 0 ? 1.15 : 1 / 1.15;
        const TiempoEnCursor = this.PixelesATiempo(X);
        this.PxPorSegundo = Limitar(this.PxPorSegundo * Factor, 12, 480);
        this.DesplazamientoX = Math.max(0, TiempoEnCursor * this.PxPorSegundo - (X - ANCHO_ETIQUETAS));
        this.AlCambiarZoom?.(this.PxPorSegundo);
      } else if (E.shiftKey || Math.abs(E.deltaX) > Math.abs(E.deltaY)) {
        const Delta = Math.abs(E.deltaX) > 0 ? E.deltaX : E.deltaY;
        this.DesplazamientoX = Math.max(0, this.DesplazamientoX + Delta);
      } else {
        const MaxY = Math.max(0, this.AlturaTotal() - this.Lienzo.clientHeight);
        this.DesplazamientoY = Limitar(this.DesplazamientoY + E.deltaY, 0, MaxY);
      }
      this.SolicitarDibujo();
    }, { passive: false });

    // Arrastrar y soltar clips de efecto o archivos de animación
    this.Lienzo.addEventListener('dragover', (E) => {
      E.preventDefault();
      if (E.dataTransfer) E.dataTransfer.dropEffect = 'copy';
    });

    this.Lienzo.addEventListener('drop', (E) => {
      E.preventDefault();
      const { X } = Posicion(E);
      const TiempoSoltar = Limitar(this.PixelesATiempo(X), 0, this.Contexto.Animacion.Duracion);

      const Archivo = E.dataTransfer?.files?.[0];
      if (Archivo && this.AlSoltarArchivo) {
        this.AlSoltarArchivo(Archivo, TiempoSoltar);
        return;
      }

      const DatosTexto = E.dataTransfer?.getData('animador/arrastrar-efecto');
      if (!DatosTexto) return;
      try {
        const Datos = JSON.parse(DatosTexto) as { Tipo: 'Efecto' | 'Luz'; Objetivo: string; ValorBase: number };
        const Anim = this.Contexto.Animacion;
        const T0 = TiempoSoltar;
        const T1 = Math.min(Anim.Duracion, T0 + 1);
        const T2 = Math.min(Anim.Duracion, T0 + 3);
        const T3 = Math.min(Anim.Duracion, T0 + 4);

        const Subcomandos = [
          new ComandoGuardarClave(Anim, Datos.Tipo, Datos.Objetivo, 'Manual', T0, [0], 'Suave')
        ];
        if (T1 > T0) Subcomandos.push(new ComandoGuardarClave(Anim, Datos.Tipo, Datos.Objetivo, 'Manual', T1, [Datos.ValorBase], 'Suave'));
        if (T2 > T1) Subcomandos.push(new ComandoGuardarClave(Anim, Datos.Tipo, Datos.Objetivo, 'Manual', T2, [Datos.ValorBase], 'Suave'));
        if (T3 > T2) Subcomandos.push(new ComandoGuardarClave(Anim, Datos.Tipo, Datos.Objetivo, 'Manual', T3, [0], 'Suave'));

        const Lote = new ComandoLote(`Clip de efecto "${Datos.Objetivo}"`, Subcomandos);
        if (this.Contexto.Historial) this.Contexto.Historial.Ejecutar(Lote);
        else Lote.Ejecutar();

        this.Contexto.NotificarEstado(`Efecto "${Datos.Objetivo}" añadido en ${T0.toFixed(1)}s`, 'exito', true);
      } catch (err) {
        console.error('Error al parsear el efecto soltado', err);
      }
    });

    // Menú contextual unificado
    this.Lienzo.addEventListener('contextmenu', (E) => {
      E.preventDefault();
      const { X, Y } = Posicion(E);
      const Anim = this.Contexto.Animacion;
      const Tiempo = Limitar(this.PixelesATiempo(X), 0, Anim.Duracion);

      if (X <= ANCHO_ETIQUETAS) {
        const Fila = this.BuscarFilaEnY(Y);
        if (Fila?.TipoFila === 'Pista' && Fila.Pista) {
          this.AlAbrirMenuContextual?.(E, { Tipo: 'pista', Tiempo: Anim.TiempoActual, Pista: Fila.Pista, Grupo: Fila.Grupo });
        } else if (Fila?.TipoFila === 'Grupo') {
          this.AlAbrirMenuContextual?.(E, { Tipo: 'grupo', Tiempo: Anim.TiempoActual, Grupo: Fila.Grupo });
        }
        return;
      }

      const Tocado = this.BuscarClaveEn(X, Y);
      if (Tocado) {
        if (!this.Contexto.Estado?.EstaSeleccionada(Tocado.PistaId, Tocado.ClaveId)) {
          this.Contexto.Estado?.SeleccionarUna(Tocado.PistaId, Tocado.ClaveId);
        }
        const Pista = Anim.Pistas.find((P) => P.Id === Tocado.PistaId);
        const Clave = Pista?.Claves.find((C) => C.Id === Tocado.ClaveId);
        if (Pista && Clave) {
          this.AlAbrirMenuContextual?.(E, { Tipo: 'clave', Tiempo: Clave.Tiempo, Pista, Clave, Grupo: Pista.Grupo });
          return;
        }
      }

      const Pista = this.BuscarPistaEnY(Y);
      if (Pista) {
        this.AlAbrirMenuContextual?.(E, { Tipo: 'pista', Tiempo, Pista, Grupo: Pista.Grupo });
        return;
      }

      const Fila = this.BuscarFilaEnY(Y);
      if (Fila?.TipoFila === 'Grupo') {
        this.AlAbrirMenuContextual?.(E, { Tipo: 'grupo', Tiempo, Grupo: Fila.Grupo });
        return;
      }

      this.AlAbrirMenuContextual?.(E, { Tipo: 'vacio', Tiempo });
    });
  }

  private ManejarClicCabecera(X: number, Y: number): void {
    const Filas = this.AsegurarFilasCache();
    const Anim = this.Contexto.Animacion;
    const Estado = this.Contexto.Estado;

    for (let I = 0; I < Filas.length; I++) {
      const YFila = ALTO_REGLA + I * ALTO_FILA - this.DesplazamientoY;
      if (Y < YFila || Y > YFila + ALTO_FILA) continue;

      const Fila = Filas[I];
      if (Fila.TipoFila === 'Grupo') {
        // Botón Bloquear capa [ANCHO-26 .. ANCHO-8]
        if (X >= ANCHO_ETIQUETAS - 28 && X <= ANCHO_ETIQUETAS - 6) {
          const PistasGrupo = Anim.Pistas.filter((P) => P.Grupo === Fila.Grupo);
          const TodasBloqueadas = PistasGrupo.every((P) => P.Bloqueada);
          for (const P of PistasGrupo) P.Bloqueada = !TodasBloqueadas;
          Anim.NotificarCambioPistas('bloqueo-grupo');
          return;
        }
        // Botón Silenciar capa [ANCHO-50 .. ANCHO-30]
        if (X >= ANCHO_ETIQUETAS - 52 && X <= ANCHO_ETIQUETAS - 30) {
          const PistasGrupo = Anim.Pistas.filter((P) => P.Grupo === Fila.Grupo);
          const TodasSilenciadas = PistasGrupo.every((P) => P.Silenciada);
          for (const P of PistasGrupo) P.Silenciada = !TodasSilenciadas;
          Anim.NotificarCambioPistas('silencio-grupo');
          Anim.EvaluarEn(Anim.TiempoActual);
          return;
        }
        Estado?.AlternarGrupoExpandido(Fila.Grupo);
        this.FilasSucias = true;
        this.SolicitarDibujo();
        return;
      }

      const Pista = Fila.Pista!;
      // Botón Bloquear pista
      if (X >= ANCHO_ETIQUETAS - 28 && X <= ANCHO_ETIQUETAS - 6) {
        Pista.Bloqueada = !Pista.Bloqueada;
        Anim.NotificarCambioPistas('bloqueo-pista');
        return;
      }
      // Botón Silenciar pista
      if (X >= ANCHO_ETIQUETAS - 52 && X <= ANCHO_ETIQUETAS - 30) {
        Pista.Silenciada = !Pista.Silenciada;
        Anim.NotificarCambioPistas('silencio-pista');
        Anim.EvaluarEn(Anim.TiempoActual);
        return;
      }
      // Botón Clave rápida (Insertar o Sobrescribir en cabezal)
      if (X >= ANCHO_ETIQUETAS - 76 && X <= ANCHO_ETIQUETAS - 54) {
        if (Pista.Bloqueada) {
          this.Contexto.NotificarEstado(`La pista "${Pista.Nombre}" está bloqueada.`, 'aviso');
          return;
        }
        const Valor = Anim.ObtenerValorActualObjetivo(Pista.Tipo, Pista.Objetivo);
        if (!Valor) return;
        const Cmd = new ComandoGuardarClave(
          Anim,
          Pista.Tipo,
          Pista.Objetivo,
          Pista.Grupo,
          Anim.TiempoActual,
          Valor,
          Estado?.InterpolacionPorDefecto ?? 'Suave'
        );
        if (this.Contexto.Historial) this.Contexto.Historial.Ejecutar(Cmd);
        else Cmd.Ejecutar();
        Estado?.SeleccionarUna(Pista.Id, Cmd.ClaveResultanteId);
        this.Contexto.NotificarEstado(
          Cmd.FueSobrescritura
            ? `Sobrescrita clave de ${Pista.Objetivo} en ${FormatearTiempo(Anim.TiempoActual)}.`
            : `Clave insertada en ${Pista.Objetivo} (${FormatearTiempo(Anim.TiempoActual)}).`,
          'exito',
          true
        );
        return;
      }

      // Seleccionar hueso si corresponde
      if ((Pista.Tipo === 'HuesoRotacion' || Pista.Tipo === 'HuesoPosicion') && Estado) {
        Estado.HuesoSeleccionado = Pista.Objetivo;
      }
      return;
    }
  }

  private IniciarArrastreClaves(X: number, Alt: boolean): void {
    const Anim = this.Contexto.Animacion;
    const Estado = this.Contexto.Estado;
    const Seleccion = Estado ? Estado.SeleccionClaves : [];

    this.Modo = 'MoverClaves';
    this.AltEnArrastre = Alt;
    this.DuplicadoEnCurso = false;
    this.TiempoAnclaArrastre = this.PixelesATiempo(X);
    this.MovimientosActivos = [];
    this.ClavesAntesArrastre.clear();
    this.PistasAntesDuplicado = null;

    for (const Sel of Seleccion) {
      const Pista = Anim.Pistas.find((P) => P.Id === Sel.PistaId);
      const Clave = Pista?.Claves.find((C) => C.Id === Sel.ClaveId);
      if (!Pista || !Clave || Pista.Bloqueada) continue;
      if (!this.ClavesAntesArrastre.has(Pista.Id)) {
        this.ClavesAntesArrastre.set(
          Pista.Id,
          Pista.Claves.map((C) => ({ Id: C.Id, Tiempo: C.Tiempo, Valor: [...C.Valor], Interpolacion: C.Interpolacion }))
        );
      }
      this.MovimientosActivos.push({
        PistaId: Pista.Id,
        ClaveId: Clave.Id,
        TiempoInicial: Clave.Tiempo
      });
    }
    this.SolicitarDibujo();
  }

  private ActivarDuplicadoEnArrastre(): void {
    const Anim = this.Contexto.Animacion;
    const Estado = this.Contexto.Estado;
    this.DuplicadoEnCurso = true;
    this.PistasAntesDuplicado = Anim.Pistas.map((P) => ({
      ...P,
      Claves: P.Claves.map((C) => ({ ...C, Valor: [...C.Valor] }))
    }));

    const NuevasSelecciones: SeleccionClave[] = [];
    const NuevosMovimientos: MovimientoInicial[] = [];

    for (const M of this.MovimientosActivos) {
      const Pista = Anim.Pistas.find((P) => P.Id === M.PistaId);
      const Orig = Pista?.Claves.find((C) => C.Id === M.ClaveId);
      if (!Pista || !Orig || Pista.Bloqueada) continue;
      const Clon: ClaveAnimacion = {
        Id: GenerarId(),
        Tiempo: M.TiempoInicial,
        Valor: [...Orig.Valor],
        Interpolacion: Orig.Interpolacion
      };
      Pista.Claves.push(Clon);
      NuevasSelecciones.push({ PistaId: Pista.Id, ClaveId: Clon.Id });
      NuevosMovimientos.push({ PistaId: Pista.Id, ClaveId: Clon.Id, TiempoInicial: M.TiempoInicial });
    }

    this.MovimientosActivos = NuevosMovimientos;
    Estado?.EstablecerSeleccion(NuevasSelecciones);
  }

  private FinalizarArrastreClaves(): void {
    const Anim = this.Contexto.Animacion;
    if (this.DuplicadoEnCurso && this.PistasAntesDuplicado) {
      // Registrar clonación como comando atómico mediante lote/importación ligera usando snapshot
      const PistasDespues = Anim.Pistas.map((P) => ({
        ...P,
        Claves: P.Claves.map((C) => ({ ...C, Valor: [...C.Valor] }))
      }));
      const Antes = this.PistasAntesDuplicado;
      if (this.Contexto.Historial) {
        this.Contexto.Historial.RegistrarEjecutado({
          Descripcion: `Duplicar ${this.MovimientosActivos.length} clave(s)`,
          Ejecutar: () => {
            Anim.Pistas = PistasDespues.map((P) => ({ ...P, Claves: P.Claves.map((C) => ({ ...C, Valor: [...C.Valor] })) }));
            Anim.NotificarCambioPistas('rehacer-duplicar');
            Anim.EvaluarEn(Anim.TiempoActual);
          },
          Deshacer: () => {
            Anim.Pistas = Antes.map((P) => ({ ...P, Claves: P.Claves.map((C) => ({ ...C, Valor: [...C.Valor] })) }));
            Anim.NotificarCambioPistas('deshacer-duplicar');
            Anim.EvaluarEn(Anim.TiempoActual);
          }
        });
      }
      return;
    }

    if (this.MovimientosActivos.length === 0 || !this.Contexto.Historial) return;
    const Lista = this.MovimientosActivos.map((M) => {
      const Pista = Anim.Pistas.find((P) => P.Id === M.PistaId);
      const Clave = Pista?.Claves.find((C) => C.Id === M.ClaveId);
      return {
        PistaId: M.PistaId,
        ClaveId: M.ClaveId,
        TiempoAnterior: M.TiempoInicial,
        TiempoNuevo: Clave ? Clave.Tiempo : M.TiempoInicial
      };
    });
    const Cmd = new ComandoMoverClaves(Anim, Lista, this.ClavesAntesArrastre);
    Cmd.CapturarDespues();
    this.Contexto.Historial.RegistrarEjecutado(Cmd);
  }

  private AplicarSeleccionCaja(Aditiva: boolean): void {
    const XMin = Math.max(ANCHO_ETIQUETAS, Math.min(this.MouseInicioX, this.MouseActualX));
    const XMax = Math.max(this.MouseInicioX, this.MouseActualX);
    const YMin = Math.max(ALTO_REGLA, Math.min(this.MouseInicioY, this.MouseActualY));
    const YMax = Math.max(this.MouseInicioY, this.MouseActualY);

    const Filas = this.AsegurarFilasCache();
    const EnCaja: SeleccionClave[] = Aditiva && this.Contexto.Estado
      ? [...this.Contexto.Estado.SeleccionClaves]
      : [];

    for (let I = 0; I < Filas.length; I++) {
      if (Filas[I].TipoFila !== 'Pista') continue;
      const YCentro = ALTO_REGLA + I * ALTO_FILA + ALTO_FILA / 2 - this.DesplazamientoY;
      if (YCentro < YMin - RADIO_CLAVE || YCentro > YMax + RADIO_CLAVE) continue;
      const Pista = Filas[I].Pista!;
      for (const C of Pista.Claves) {
        const XC = this.TiempoAPixeles(C.Tiempo);
        if (XC >= XMin - RADIO_CLAVE && XC <= XMax + RADIO_CLAVE) {
          EnCaja.push({ PistaId: Pista.Id, ClaveId: C.Id });
        }
      }
    }

    this.Contexto.Estado?.EstablecerSeleccion(EnCaja);
  }

  private ActualizarHover(X: number, Y: number): void {
    const ClaveRef = X > ANCHO_ETIQUETAS && Y > ALTO_REGLA ? this.BuscarClaveEn(X, Y) : null;
    if (ClaveRef) {
      const Pista = this.Contexto.Animacion.Pistas.find((P) => P.Id === ClaveRef.PistaId);
      const Clave = Pista?.Claves.find((C) => C.Id === ClaveRef.ClaveId);
      if (Pista && Clave) {
        const Resumen = Clave.Valor.length === 1
          ? Clave.Valor[0].toFixed(2)
          : `${Clave.Valor.map((V) => V.toFixed(2)).join(', ')}`;
        this.HoverClave = {
          X, Y,
          PistaNombre: Pista.Nombre,
          Tiempo: Clave.Tiempo,
          Interpolacion: Clave.Interpolacion ?? 'Suave',
          ResumenValor: Resumen
        };
        this.Lienzo.style.cursor = 'grab';
        this.SolicitarDibujo();
        return;
      }
    }

    if (this.HoverClave !== null) {
      this.HoverClave = null;
      this.SolicitarDibujo();
    }

    if (Y <= ALTO_REGLA && X > ANCHO_ETIQUETAS) {
      const Estado = this.Contexto.Estado;
      if (Estado?.RangoBucle.Activo) {
        const XIni = this.TiempoAPixeles(Estado.RangoBucle.Inicio);
        const XFin = this.TiempoAPixeles(Estado.RangoBucle.Fin);
        if (Math.abs(X - XIni) <= 8 || Math.abs(X - XFin) <= 8) {
          this.Lienzo.style.cursor = 'ew-resize';
          return;
        }
      }
      this.Lienzo.style.cursor = 'col-resize';
    } else if (X <= ANCHO_ETIQUETAS) {
      this.Lienzo.style.cursor = 'pointer';
    } else {
      this.Lienzo.style.cursor = 'default';
    }
  }

  // --------------------------------------------------------------------------
  // Búsqueda espacial de elementos bajo el puntero
  // --------------------------------------------------------------------------

  private BuscarFilaEnY(Y: number): FilaTimeline | null {
    const Filas = this.AsegurarFilasCache();
    const Indice = Math.floor((Y - ALTO_REGLA + this.DesplazamientoY) / ALTO_FILA);
    if (Indice < 0 || Indice >= Filas.length) return null;
    return Filas[Indice];
  }

  private BuscarPistaEnY(Y: number): PistaAnimacion | null {
    const Fila = this.BuscarFilaEnY(Y);
    return Fila?.TipoFila === 'Pista' ? (Fila.Pista ?? null) : null;
  }

  private BuscarResumenGrupoEn(X: number, Y: number): { Grupo: GrupoPista; Tiempo: number } | null {
    if (X <= ANCHO_ETIQUETAS || Y <= ALTO_REGLA) return null;
    const Filas = this.AsegurarFilasCache();
    for (let I = 0; I < Filas.length; I++) {
      if (Filas[I].TipoFila !== 'Grupo') continue;
      const YFilaCentro = ALTO_REGLA + I * ALTO_FILA + ALTO_FILA / 2 - this.DesplazamientoY;
      if (Math.abs(Y - YFilaCentro) > ALTO_FILA / 2) continue;
      const Resumen = this.ResumenGrupos.get(Filas[I].Grupo);
      if (!Resumen) continue;
      for (const T of Resumen.TiemposUnicos) {
        if (Math.abs(X - this.TiempoAPixeles(T)) <= RADIO_CLAVE + 2) {
          return { Grupo: Filas[I].Grupo, Tiempo: T };
        }
      }
    }
    return null;
  }

  private BuscarClaveEn(X: number, Y: number): SeleccionClave | null {
    if (X <= ANCHO_ETIQUETAS || Y <= ALTO_REGLA) return null;
    const Filas = this.AsegurarFilasCache();
    for (let I = 0; I < Filas.length; I++) {
      if (Filas[I].TipoFila !== 'Pista') continue;
      const Pista = Filas[I].Pista!;
      const YFilaCentro = ALTO_REGLA + I * ALTO_FILA + ALTO_FILA / 2 - this.DesplazamientoY;
      if (Math.abs(Y - YFilaCentro) > ALTO_FILA / 2) continue;
      for (const Clave of Pista.Claves) {
        if (Math.abs(X - this.TiempoAPixeles(Clave.Tiempo)) <= RADIO_CLAVE + 3) {
          return { PistaId: Pista.Id, ClaveId: Clave.Id };
        }
      }
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Dibujo optimizado en Canvas 2D
  // --------------------------------------------------------------------------

  public Dibujar(): void {
    const Ancho = this.Lienzo.clientWidth;
    const Alto = this.Lienzo.clientHeight;
    if (Ancho <= 0 || Alto <= 0) return;

    const Dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.Lienzo.width !== Ancho * Dpr || this.Lienzo.height !== Alto * Dpr) {
      this.Lienzo.width = Ancho * Dpr;
      this.Lienzo.height = Alto * Dpr;
    }

    const C = this.Contexto2D;
    C.setTransform(Dpr, 0, 0, Dpr, 0, 0);

    const Anim = this.Contexto.Animacion;
    const Filas = this.AsegurarFilasCache();
    const TInicio = Math.max(0, this.PixelesATiempo(ANCHO_ETIQUETAS));
    const TFin = this.PixelesATiempo(Ancho);

    // Fondo general oscuro
    C.fillStyle = '#0d1017';
    C.fillRect(0, 0, Ancho, Alto);

    // Estado vacío amigable cuando no hay pistas
    if (Filas.length === 0 && !this.Contexto.Audio.Buffer) {
      this.DibujarRegla(C, Ancho, Alto, Anim.Duracion, TInicio, TFin);
      this.DibujarEstadoVacio(C, Ancho, Alto);
    } else {
      this.DibujarRejillaVertical(C, Ancho, Alto, TInicio, TFin);

      for (let I = 0; I < Filas.length; I++) {
        const YFila = ALTO_REGLA + I * ALTO_FILA - this.DesplazamientoY;
        if (YFila + ALTO_FILA < ALTO_REGLA || YFila > Alto) continue;
        if (Filas[I].TipoFila === 'Pista') {
          this.DibujarFilaPista(C, Filas[I].Pista!, YFila, Ancho, Anim.Duracion, I, TInicio, TFin);
        } else {
          this.DibujarFilaGrupoDopeSheet(C, Filas[I].Grupo, YFila, Ancho, TInicio, TFin);
        }
      }

      if (this.Contexto.Audio.Buffer) {
        const YAudio = ALTO_REGLA + Filas.length * ALTO_FILA - this.DesplazamientoY;
        if (YAudio + ALTO_FILA_AUDIO > ALTO_REGLA && YAudio < Alto) {
          this.DibujarFilaAudio(C, YAudio, Ancho);
        }
      }

      // Zona fuera de la duración de la animación
      const XFin = this.TiempoAPixeles(Anim.Duracion);
      if (XFin < Ancho) {
        C.fillStyle = 'rgba(4, 6, 10, 0.45)';
        C.fillRect(Math.max(XFin, ANCHO_ETIQUETAS), ALTO_REGLA, Ancho - Math.max(XFin, ANCHO_ETIQUETAS), Alto - ALTO_REGLA);
      }

      this.DibujarRangoBucle(C, Alto);
      this.DibujarRegla(C, Ancho, Alto, Anim.Duracion, TInicio, TFin);
    }

    // Caja de selección activa
    if (this.Modo === 'SeleccionCaja' && this.SeMovioEnArrastre) {
      const BX = Math.min(this.MouseInicioX, this.MouseActualX);
      const BY = Math.min(this.MouseInicioY, this.MouseActualY);
      const BW = Math.abs(this.MouseActualX - this.MouseInicioX);
      const BH = Math.abs(this.MouseActualY - this.MouseInicioY);
      C.fillStyle = 'rgba(76, 201, 255, 0.14)';
      C.fillRect(BX, BY, BW, BH);
      C.strokeStyle = '#4cc9ff';
      C.lineWidth = 1;
      C.strokeRect(BX + 0.5, BY + 0.5, BW, BH);
    }

    // Cabezal de reproducción
    this.DibujarCabezal(C, Anim.TiempoActual, Alto);

    // Columna de cabeceras (siempre encima del área temporal)
    C.fillStyle = '#121620';
    C.fillRect(0, 0, ANCHO_ETIQUETAS, Alto);
    C.strokeStyle = '#262d3d';
    C.beginPath();
    C.moveTo(ANCHO_ETIQUETAS + 0.5, 0);
    C.lineTo(ANCHO_ETIQUETAS + 0.5, Alto);
    C.stroke();

    this.DibujarEtiquetas(C, Filas, Alto);

    // Tooltip flotante sobre clave
    if (this.HoverClave && this.Modo === 'Ninguno') {
      this.DibujarTooltipClave(C, this.HoverClave, Ancho, Alto);
    }
  }

  private DibujarEstadoVacio(C: CanvasRenderingContext2D, Ancho: number, Alto: number): void {
    const CX = ANCHO_ETIQUETAS + (Ancho - ANCHO_ETIQUETAS) / 2;
    const CY = ALTO_REGLA + (Alto - ALTO_REGLA) / 2;
    C.fillStyle = '#8b95ab';
    C.font = '12px Segoe UI, system-ui, sans-serif';
    C.textAlign = 'center';
    C.fillText('Sin pistas todavía. Usa "Insertar pose" (K), un preajuste o "Importar animación…"', CX, CY - 4);
    C.fillStyle = '#5e687e';
    C.font = '11px Segoe UI, system-ui, sans-serif';
    C.fillText('Consejo: también puedes arrastrar archivos .vrma, .bvh, .json o efectos aquí.', CX, CY + 16);
    C.textAlign = 'left';
  }

  private ObtenerPasoRegla(): number {
    const Pasos = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    return Pasos.find((P) => P * this.PxPorSegundo >= 68) ?? 60;
  }

  private DibujarRejillaVertical(
    C: CanvasRenderingContext2D, Ancho: number, Alto: number, TInicio: number, TFin: number
  ): void {
    const Paso = this.ObtenerPasoRegla();
    C.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    C.lineWidth = 1;
    C.beginPath();
    for (let T = Math.floor(TInicio / Paso) * Paso; T <= TFin; T += Paso) {
      const X = Math.round(this.TiempoAPixeles(T)) + 0.5;
      if (X <= ANCHO_ETIQUETAS || X > Ancho) continue;
      C.moveTo(X, ALTO_REGLA);
      C.lineTo(X, Alto);
    }
    C.stroke();
  }

  private DibujarRangoBucle(C: CanvasRenderingContext2D, Alto: number): void {
    const Rango = this.Contexto.Estado?.RangoBucle;
    if (!Rango?.Activo) return;
    const XIni = Math.max(ANCHO_ETIQUETAS, this.TiempoAPixeles(Rango.Inicio));
    const XFin = this.TiempoAPixeles(Rango.Fin);
    if (XFin <= XIni) return;

    C.fillStyle = 'rgba(74, 222, 128, 0.07)';
    C.fillRect(XIni, ALTO_REGLA, XFin - XIni, Alto - ALTO_REGLA);

    C.strokeStyle = 'rgba(74, 222, 128, 0.45)';
    C.setLineDash([4, 3]);
    C.beginPath();
    C.moveTo(XIni, ALTO_REGLA); C.lineTo(XIni, Alto);
    C.moveTo(XFin, ALTO_REGLA); C.lineTo(XFin, Alto);
    C.stroke();
    C.setLineDash([]);
  }

  private DibujarRegla(
    C: CanvasRenderingContext2D, Ancho: number, _Alto: number, Duracion: number, TInicio: number, TFin: number
  ): void {
    C.fillStyle = '#151924';
    C.fillRect(ANCHO_ETIQUETAS, 0, Ancho - ANCHO_ETIQUETAS, ALTO_REGLA);

    const Rango = this.Contexto.Estado?.RangoBucle;
    if (Rango?.Activo) {
      const XIni = Math.max(ANCHO_ETIQUETAS, this.TiempoAPixeles(Rango.Inicio));
      const XFin = this.TiempoAPixeles(Rango.Fin);
      if (XFin > XIni) {
        C.fillStyle = 'rgba(74, 222, 128, 0.28)';
        C.fillRect(XIni, 0, XFin - XIni, 7);
        C.fillStyle = '#4ade80';
        C.fillRect(XIni - 3, 0, 6, 12);
        C.fillRect(XFin - 3, 0, 6, 12);
      }
    }

    const Paso = this.ObtenerPasoRegla();
    const SubPaso = Paso / 4;
    C.strokeStyle = '#333b4d';
    C.fillStyle = '#9aa4b8';
    C.font = '10px Segoe UI, system-ui, sans-serif';
    C.textAlign = 'left';

    for (let T = Math.floor(TInicio / SubPaso) * SubPaso; T <= TFin; T += SubPaso) {
      const X = Math.round(this.TiempoAPixeles(T)) + 0.5;
      if (X < ANCHO_ETIQUETAS) continue;
      const EsMayor = Math.abs((T / Paso) - Math.round(T / Paso)) < 0.01;
      C.beginPath();
      C.moveTo(X, ALTO_REGLA - (EsMayor ? 10 : 5));
      C.lineTo(X, ALTO_REGLA);
      C.stroke();
      if (EsMayor) {
        C.fillText(FormatearTiempo(Math.max(0, T)), X + 4, ALTO_REGLA - 13);
      }
    }

    // Marca del fin de la animación
    const XFinDur = this.TiempoAPixeles(Duracion);
    if (XFinDur >= ANCHO_ETIQUETAS && XFinDur <= Ancho) {
      C.strokeStyle = '#4cc9ff';
      C.setLineDash([4, 3]);
      C.beginPath();
      C.moveTo(XFinDur, 0);
      C.lineTo(XFinDur, ALTO_REGLA);
      C.stroke();
      C.setLineDash([]);
    }

    C.strokeStyle = '#262d3d';
    C.beginPath();
    C.moveTo(ANCHO_ETIQUETAS, ALTO_REGLA + 0.5);
    C.lineTo(Ancho, ALTO_REGLA + 0.5);
    C.stroke();
  }

  private DibujarFilaGrupoDopeSheet(
    C: CanvasRenderingContext2D, Grupo: GrupoPista, YFila: number, Ancho: number, TInicio: number, TFin: number
  ): void {
    C.fillStyle = '#141925';
    C.fillRect(ANCHO_ETIQUETAS, YFila, Ancho - ANCHO_ETIQUETAS, ALTO_FILA);

    const Color = COLORES_GRUPO[Grupo];
    const Resumen = this.ResumenGrupos.get(Grupo);
    if (Resumen && Resumen.TotalClaves > 0) {
      const XIni = Math.max(ANCHO_ETIQUETAS, this.TiempoAPixeles(Resumen.TiempoMin));
      const XFin = Math.min(Ancho, this.TiempoAPixeles(Resumen.TiempoMax));
      if (XFin > XIni) {
        C.fillStyle = Color + '22';
        C.strokeStyle = Color + '55';
        C.beginPath();
        C.roundRect(XIni, YFila + 5, Math.max(8, XFin - XIni), ALTO_FILA - 10, 4);
        C.fill();
        C.stroke();
      }

      const YCentro = YFila + ALTO_FILA / 2;
      for (const T of Resumen.TiemposUnicos) {
        if (T < TInicio - 0.1 || T > TFin + 0.1) continue;
        const X = this.TiempoAPixeles(T);
        C.fillStyle = Color + 'cc';
        C.beginPath();
        C.moveTo(X, YCentro - 4.5);
        C.lineTo(X + 4.5, YCentro);
        C.lineTo(X, YCentro + 4.5);
        C.lineTo(X - 4.5, YCentro);
        C.closePath();
        C.fill();
      }
    }

    C.strokeStyle = '#222836';
    C.beginPath();
    C.moveTo(ANCHO_ETIQUETAS, YFila + ALTO_FILA + 0.5);
    C.lineTo(Ancho, YFila + ALTO_FILA + 0.5);
    C.stroke();
  }

  private DibujarFilaPista(
    C: CanvasRenderingContext2D,
    Pista: PistaAnimacion,
    YFila: number,
    Ancho: number,
    Duracion: number,
    IndiceAlterno: number,
    TInicio: number,
    TFin: number
  ): void {
    C.fillStyle = IndiceAlterno % 2 === 0 ? '#11151f' : '#131823';
    C.fillRect(ANCHO_ETIQUETAS, YFila, Ancho - ANCHO_ETIQUETAS, ALTO_FILA);

    const Color = COLORES_GRUPO[Pista.Grupo];
    const YCentro = YFila + ALTO_FILA / 2;

    if (Pista.Silenciada) C.globalAlpha = 0.42;

    // Línea base tenue hasta el fin de la animación
    C.strokeStyle = '#1f2534';
    C.beginPath();
    C.moveTo(ANCHO_ETIQUETAS, YCentro);
    C.lineTo(Math.min(Ancho, this.TiempoAPixeles(Duracion)), YCentro);
    C.stroke();

    const EsEscalar = Pista.Tipo === 'Efecto' || Pista.Tipo === 'Luz' || Pista.Tipo === 'Expresion';
    let MaxValor = 1;
    if (EsEscalar && Pista.Claves.length > 0) {
      MaxValor = 0;
      for (const K of Pista.Claves) {
        const Abs = Math.abs(K.Valor[0] ?? 0);
        if (Abs > MaxValor) MaxValor = Abs;
      }
      if (MaxValor < 0.001) MaxValor = 1;
    }

    const IndiceIni = Pista.Claves.length > 0 ? this.BuscarPrimerIndiceVisible(Pista.Claves, TInicio) : 0;

    // Curva de automatización para pistas escalares (solo rango visible)
    if (EsEscalar && Pista.Claves.length >= 2) {
      let IndiceFin = IndiceIni;
      while (IndiceFin < Pista.Claves.length - 1 && Pista.Claves[IndiceFin].Tiempo <= TFin) {
        IndiceFin++;
      }

      if (IndiceFin > IndiceIni) {
        C.beginPath();
        const X0 = this.TiempoAPixeles(Pista.Claves[IndiceIni].Tiempo);
        C.moveTo(X0, YFila + ALTO_FILA);
        for (let I = IndiceIni; I <= IndiceFin; I++) {
          const K = Pista.Claves[I];
          const X = this.TiempoAPixeles(K.Tiempo);
          const VNorm = Math.abs(K.Valor[0] ?? 0) / MaxValor;
          const YK = YFila + ALTO_FILA - VNorm * (ALTO_FILA - 8) - 4;
          C.lineTo(X, YK);
        }
        const XUltimo = this.TiempoAPixeles(Pista.Claves[IndiceFin].Tiempo);
        C.lineTo(XUltimo, YFila + ALTO_FILA);
        C.fillStyle = Color + '33';
        C.fill();

        C.strokeStyle = Color;
        C.lineWidth = 1.5;
        C.beginPath();
        for (let I = IndiceIni; I <= IndiceFin; I++) {
          const K = Pista.Claves[I];
          const X = this.TiempoAPixeles(K.Tiempo);
          const VNorm = Math.abs(K.Valor[0] ?? 0) / MaxValor;
          const YK = YFila + ALTO_FILA - VNorm * (ALTO_FILA - 8) - 4;
          if (I === IndiceIni) C.moveTo(X, YK);
          else C.lineTo(X, YK);
        }
        C.stroke();
        C.lineWidth = 1;
      }
    }

    // Dibujo de keyframes visibles por búsqueda binaria
    for (let I = IndiceIni; I < Pista.Claves.length; I++) {
      const Clave = Pista.Claves[I];
      if (Clave.Tiempo > TFin + 0.08) break;
      const X = this.TiempoAPixeles(Clave.Tiempo);
      if (X < ANCHO_ETIQUETAS - 8 || X > Ancho + 8) continue;

      let YDibujo = YCentro;
      if (EsEscalar) {
        const VNorm = Math.abs(Clave.Valor[0] ?? 0) / MaxValor;
        YDibujo = YFila + ALTO_FILA - VNorm * (ALTO_FILA - 8) - 4;
      }

      const Seleccionada = this.Contexto.Estado?.EstaSeleccionada(Pista.Id, Clave.Id) ?? false;
      this.DibujarIconoClave(C, X, YDibujo, Color, Clave.Interpolacion ?? 'Suave', Seleccionada);
    }

    C.globalAlpha = 1;

    C.strokeStyle = '#1b202c';
    C.beginPath();
    C.moveTo(ANCHO_ETIQUETAS, YFila + ALTO_FILA + 0.5);
    C.lineTo(Ancho, YFila + ALTO_FILA + 0.5);
    C.stroke();
  }

  private DibujarIconoClave(
    C: CanvasRenderingContext2D,
    X: number,
    Y: number,
    Color: string,
    Tipo: TipoInterpolacion,
    Seleccionada: boolean
  ): void {
    const R = Seleccionada ? RADIO_CLAVE + 1 : RADIO_CLAVE;
    C.fillStyle = Seleccionada ? '#ffffff' : Color;
    C.beginPath();

    if (Tipo === 'Lineal') {
      C.arc(X, Y, R - 1, 0, Math.PI * 2);
    } else if (Tipo === 'Escalon') {
      C.rect(X - R + 1, Y - R + 1, (R - 1) * 2, (R - 1) * 2);
    } else if (Tipo === 'EntradaSuave') {
      C.moveTo(X - R + 1, Y - R);
      C.lineTo(X + R, Y);
      C.lineTo(X - R + 1, Y + R);
      C.closePath();
    } else if (Tipo === 'SalidaSuave') {
      C.moveTo(X + R - 1, Y - R);
      C.lineTo(X - R, Y);
      C.lineTo(X + R - 1, Y + R);
      C.closePath();
    } else {
      // 'Suave': rombo clásico
      C.moveTo(X, Y - R);
      C.lineTo(X + R, Y);
      C.lineTo(X, Y + R);
      C.lineTo(X - R, Y);
      C.closePath();
    }

    C.fill();
    if (Seleccionada) {
      C.strokeStyle = '#4cc9ff';
      C.lineWidth = 2;
      C.stroke();
      C.lineWidth = 1;
    } else {
      C.strokeStyle = 'rgba(0,0,0,0.55)';
      C.stroke();
    }
  }

  private DibujarFilaAudio(C: CanvasRenderingContext2D, YFila: number, Ancho: number): void {
    C.fillStyle = '#0f141e';
    C.fillRect(ANCHO_ETIQUETAS, YFila, Ancho - ANCHO_ETIQUETAS, ALTO_FILA_AUDIO);

    const Audio = this.Contexto.Audio;
    if (!Audio.Buffer || Audio.Picos.length === 0) return;
    const DuracionAudio = Math.max(0.1, Audio.ObtenerDuracion());

    const Firma = `${Audio.NombreArchivo}|${Audio.Picos.length}|${DuracionAudio.toFixed(2)}`;
    if (this.AudioCacheSucio || this.FirmaAudioCache !== Firma || !this.CanvasAudio) {
      this.RegenerarCacheAudio(Audio.Picos, Firma);
    }

    if (this.CanvasAudio) {
      const XAudio = this.TiempoAPixeles(Audio.Desplazamiento);
      const AnchoAudio = DuracionAudio * this.PxPorSegundo;
      C.drawImage(this.CanvasAudio, XAudio, YFila + 2, AnchoAudio, ALTO_FILA_AUDIO - 4);
    }
  }

  private RegenerarCacheAudio(Picos: number[], Firma: string): void {
    this.AudioCacheSucio = false;
    this.FirmaAudioCache = Firma;
    if (!this.CanvasAudio) {
      this.CanvasAudio = document.createElement('canvas');
    }
    const AnchoCache = Math.min(2400, Math.max(400, Picos.length * 3));
    const AltoCache = ALTO_FILA_AUDIO - 4;
    this.CanvasAudio.width = AnchoCache;
    this.CanvasAudio.height = AltoCache;

    const G = this.CanvasAudio.getContext('2d')!;
    G.clearRect(0, 0, AnchoCache, AltoCache);
    const YMedio = AltoCache / 2;
    const AlturaMax = YMedio - 2;
    const PasoX = AnchoCache / Picos.length;

    G.fillStyle = 'rgba(76, 201, 255, 0.58)';
    for (let I = 0; I < Picos.length; I++) {
      const H = Math.max(1.5, Picos[I] * AlturaMax);
      G.fillRect(I * PasoX, YMedio - H, Math.max(1, PasoX * 0.72), H * 2);
    }
  }

  private DibujarCabezal(C: CanvasRenderingContext2D, Tiempo: number, Alto: number): void {
    const X = this.TiempoAPixeles(Tiempo);
    if (X < ANCHO_ETIQUETAS - 10) return;

    C.strokeStyle = 'rgba(255, 92, 108, 0.25)';
    C.lineWidth = 6;
    C.beginPath();
    C.moveTo(X, ALTO_REGLA);
    C.lineTo(X, Alto);
    C.stroke();

    C.strokeStyle = '#ff5c6c';
    C.lineWidth = 2;
    C.beginPath();
    C.moveTo(X, 0);
    C.lineTo(X, Alto);
    C.stroke();
    C.lineWidth = 1;

    C.fillStyle = '#ff5c6c';
    C.beginPath();
    C.moveTo(X - 6, 0);
    C.lineTo(X + 6, 0);
    C.lineTo(X + 6, 6);
    C.lineTo(X, 13);
    C.lineTo(X - 6, 6);
    C.closePath();
    C.fill();
  }

  private DibujarEtiquetas(C: CanvasRenderingContext2D, Filas: FilaTimeline[], Alto: number): void {
    const Anim = this.Contexto.Animacion;

    // Cabecera de columna
    C.fillStyle = '#151924';
    C.fillRect(0, 0, ANCHO_ETIQUETAS, ALTO_REGLA);
    C.fillStyle = '#9aa4b8';
    C.font = '600 11px Segoe UI, system-ui, sans-serif';
    C.textAlign = 'left';
    C.fillText('CAPAS Y PISTAS', 12, 19);
    C.strokeStyle = '#262d3d';
    C.beginPath();
    C.moveTo(0, ALTO_REGLA + 0.5);
    C.lineTo(ANCHO_ETIQUETAS, ALTO_REGLA + 0.5);
    C.stroke();

    for (let I = 0; I < Filas.length; I++) {
      const YFila = ALTO_REGLA + I * ALTO_FILA - this.DesplazamientoY;
      if (YFila + ALTO_FILA < ALTO_REGLA || YFila > Alto) continue;
      const YCentro = YFila + ALTO_FILA / 2;

      if (Filas[I].TipoFila === 'Grupo') {
        const Grupo = Filas[I].Grupo;
        const Resumen = this.ResumenGrupos.get(Grupo);
        const Expandido = this.Contexto.Estado?.GruposExpandidos[Grupo] ?? false;

        C.fillStyle = '#181d2a';
        C.fillRect(0, YFila, ANCHO_ETIQUETAS, ALTO_FILA);

        const ColorG = COLORES_GRUPO[Grupo];
        C.fillStyle = ColorG;
        C.beginPath();
        C.roundRect(7, YCentro - 7, 4, 14, 2);
        C.fill();

        C.fillStyle = '#edf1f7';
        C.font = '600 11px Segoe UI, system-ui, sans-serif';
        const Simbolo = Expandido ? '▾' : '▸';
        const Cuenta = Resumen ? ` (${Resumen.TotalPistas})` : '';
        C.fillText(`${Simbolo} ${Anim.NombreGrupo(Grupo)}${Cuenta}`, 16, YCentro + 4);

        const PistasG = Anim.Pistas.filter((P) => P.Grupo === Grupo);
        const Silenciada = PistasG.length > 0 && PistasG.every((P) => P.Silenciada);
        const Bloqueada = PistasG.length > 0 && PistasG.every((P) => P.Bloqueada);

        this.DibujarMiniBotonCabecera(C, ANCHO_ETIQUETAS - 49, YCentro - 9, 'M', Silenciada ? '#fb5a6d' : '#727c92', Silenciada);
        this.DibujarMiniBotonCabecera(C, ANCHO_ETIQUETAS - 25, YCentro - 9, Bloqueada ? '🔒' : '🔓', Bloqueada ? '#fbbf24' : '#727c92', Bloqueada);
      } else {
        const Pista = Filas[I].Pista!;
        const Color = COLORES_GRUPO[Pista.Grupo];
        const ClaveEnCabezal = Anim.BuscarClaveEnTiempo(Pista, Anim.TiempoActual) !== undefined;

        C.fillStyle = Pista.Silenciada ? '#10131b' : '#121620';
        C.fillRect(0, YFila, ANCHO_ETIQUETAS, ALTO_FILA);

        C.fillStyle = Color;
        C.beginPath();
        C.roundRect(14, YCentro - 4, 7, 7, 2);
        C.fill();

        C.fillStyle = Pista.Silenciada ? '#60697d' : '#c6cfdf';
        C.font = '11px Segoe UI, system-ui, sans-serif';
        let Nombre = Pista.Nombre;
        const Prefijos = ['Manual · ', 'Preajuste · ', 'Importado · ', 'Cuerpo · ', 'Rostro · ', 'VMC · '];
        for (const Pref of Prefijos) {
          if (Nombre.startsWith(Pref)) {
            Nombre = Nombre.substring(Pref.length);
            break;
          }
        }
        if (Nombre.length > 17) Nombre = Nombre.slice(0, 16) + '…';
        C.fillText(Nombre, 26, YCentro + 4);

        // Mini controles a la derecha de la etiqueta: Clave rápida (◆), Silenciar (M), Bloquear
        this.DibujarMiniBotonCabecera(
          C,
          ANCHO_ETIQUETAS - 73,
          YCentro - 9,
          '◆',
          ClaveEnCabezal ? COLOR_SOBRESCRIBIR : '#7f8aa3',
          ClaveEnCabezal
        );
        this.DibujarMiniBotonCabecera(
          C,
          ANCHO_ETIQUETAS - 49,
          YCentro - 9,
          'M',
          Pista.Silenciada ? '#fb5a6d' : '#727c92',
          Boolean(Pista.Silenciada)
        );
        this.DibujarMiniBotonCabecera(
          C,
          ANCHO_ETIQUETAS - 25,
          YCentro - 9,
          Pista.Bloqueada ? '🔒' : '·',
          Pista.Bloqueada ? '#fbbf24' : '#727c92',
          Boolean(Pista.Bloqueada)
        );
      }

      C.strokeStyle = '#222836';
      C.beginPath();
      C.moveTo(0, YFila + ALTO_FILA + 0.5);
      C.lineTo(ANCHO_ETIQUETAS, YFila + ALTO_FILA + 0.5);
      C.stroke();
    }

    if (this.Contexto.Audio.Buffer) {
      const YAudio = ALTO_REGLA + Filas.length * ALTO_FILA - this.DesplazamientoY;
      if (YAudio > ALTO_REGLA - ALTO_FILA_AUDIO && YAudio < Alto) {
        C.fillStyle = '#4cc9ff';
        C.beginPath();
        C.roundRect(10, YAudio + ALTO_FILA_AUDIO / 2 - 5, 9, 9, 2);
        C.fill();
        C.fillStyle = '#dfe4ee';
        C.font = '11px Segoe UI, system-ui, sans-serif';
        let Nombre = `Audio · ${this.Contexto.Audio.NombreArchivo}`;
        if (Nombre.length > 26) Nombre = Nombre.slice(0, 25) + '…';
        C.fillText(Nombre, 24, YAudio + ALTO_FILA_AUDIO / 2 + 4);
      }
    }
  }

  private DibujarMiniBotonCabecera(
    C: CanvasRenderingContext2D,
    X: number,
    Y: number,
    Texto: string,
    Color: string,
    Activo: boolean
  ): void {
    C.fillStyle = Activo ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.03)';
    C.beginPath();
    C.roundRect(X, Y, 20, 18, 4);
    C.fill();

    C.fillStyle = Color;
    C.font = 'bold 10px Segoe UI, system-ui, sans-serif';
    C.textAlign = 'center';
    C.fillText(Texto, X + 10, Y + 12.5);
    C.textAlign = 'left';
  }

  private DibujarTooltipClave(C: CanvasRenderingContext2D, Info: HoverInfo, Ancho: number, Alto: number): void {
    const Linea1 = `${Info.PistaNombre} · ${FormatearTiempo(Info.Tiempo)}`;
    const Linea2 = `Curva: ${Info.Interpolacion} | Val: ${Info.ResumenValor}`;
    C.font = '10px Segoe UI, system-ui, sans-serif';
    const W = Math.max(C.measureText(Linea1).width, C.measureText(Linea2).width) + 16;
    const H = 34;
    const TX = Limitar(Info.X + 12, ANCHO_ETIQUETAS + 4, Math.max(ANCHO_ETIQUETAS + 4, Ancho - W - 8));
    const TY = Limitar(Info.Y - H - 8, ALTO_REGLA + 4, Math.max(ALTO_REGLA + 4, Alto - H - 6));

    C.fillStyle = 'rgba(11, 14, 21, 0.94)';
    C.strokeStyle = '#384259';
    C.beginPath();
    C.roundRect(TX, TY, W, H, 6);
    C.fill();
    C.stroke();

    C.fillStyle = '#edf1f7';
    C.fillText(Linea1, TX + 8, TY + 13);
    C.fillStyle = '#8b95ab';
    C.fillText(Linea2, TX + 8, TY + 26);
  }
}

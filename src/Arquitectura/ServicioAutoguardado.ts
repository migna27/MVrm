// ============================================================================
// ServicioAutoguardado.ts — Respaldo automático local ante cierres inesperados
// Guarda una copia ligera del proyecto en localStorage con debounce.
// ============================================================================

import { ContextoAplicacion } from '../Contexto';
import { DatosProyecto } from '../Tipos';
import { TipoParticulas } from '../Nucleo/GestorEfectos';

const CLAVE_RESPALDO = 'AnimadorVRM.RespaldoAutomatico.v1';
const ESPERA_DEBOUNCE_MS = 2200;

export interface DatosAutoguardado extends DatosProyecto {
  TiempoGuardadoMs: number;
}

export interface ResumenAutoguardado {
  FechaMs: number;
  Pistas: number;
  Duracion: number;
}

export class ServicioAutoguardado {
  private Temporizador: number | null = null;
  private Pendiente = false;
  private Desuscripciones: (() => void)[] = [];

  constructor(
    private readonly Contexto: ContextoAplicacion,
    private readonly AlCambiarEstadoRespaldo?: () => void
  ) {
    this.Suscribir();
  }

  private Suscribir(): void {
    const Bus = this.Contexto.Bus;
    this.Desuscripciones.push(
      Bus.Suscribir('pistas:cambiadas', (D) => {
        if (D.motivo === 'autoguardado-restaurado') return;
        this.ProgramarGuardado();
      }),
      Bus.Suscribir('audio:cambiado', () => this.ProgramarGuardado())
    );

    const AlSalir = () => {
      if (this.Pendiente && this.Contexto.Animacion.Pistas.length > 0) {
        this.GuardarAhora();
      }
    };
    window.addEventListener('beforeunload', AlSalir);
    this.Desuscripciones.push(() => window.removeEventListener('beforeunload', AlSalir));
  }

  public Destruir(): void {
    if (this.Temporizador !== null) {
      window.clearTimeout(this.Temporizador);
      this.Temporizador = null;
    }
    for (const D of this.Desuscripciones) D();
    this.Desuscripciones = [];
  }

  public ObtenerResumen(): ResumenAutoguardado | null {
    try {
      const Crudo = window.localStorage.getItem(CLAVE_RESPALDO);
      if (!Crudo) return null;
      const Datos = JSON.parse(Crudo) as Partial<DatosAutoguardado>;
      if (!Array.isArray(Datos.Pistas) || Datos.Pistas.length === 0) return null;
      return {
        FechaMs: typeof Datos.TiempoGuardadoMs === 'number' ? Datos.TiempoGuardadoMs : Date.now(),
        Pistas: Datos.Pistas.length,
        Duracion: typeof Datos.Duracion === 'number' ? Datos.Duracion : 10
      };
    } catch {
      return null;
    }
  }

  public TieneRespaldo(): boolean {
    return this.ObtenerResumen() !== null;
  }

  public ProgramarGuardado(): void {
    if (this.Contexto.Animacion.Pistas.length === 0) return;
    this.Pendiente = true;
    if (this.Temporizador !== null) {
      window.clearTimeout(this.Temporizador);
    }
    this.Temporizador = window.setTimeout(() => {
      this.Temporizador = null;
      this.GuardarAhora();
    }, ESPERA_DEBOUNCE_MS);
  }

  public GuardarAhora(): boolean {
    const Anim = this.Contexto.Animacion;
    this.Pendiente = false;
    if (Anim.Pistas.length === 0) return false;

    const Fondo = this.Contexto.Escena.Escena.background as { getHexString?: () => string } | null;
    const Datos: DatosAutoguardado = {
      Version: 2,
      Duracion: Anim.Duracion,
      Pistas: Anim.Pistas,
      ColorFondo: Fondo?.getHexString ? `#${Fondo.getHexString()}` : '#1b1e26',
      DesplazamientoAudio: this.Contexto.Audio.Desplazamiento,
      VolumenAudio: this.Contexto.Audio.Volumen,
      NombreAudio: this.Contexto.Audio.Buffer ? this.Contexto.Audio.NombreArchivo : null,
      BloomActivo: this.Contexto.Escena.BloomActivo,
      BloomFuerza: this.Contexto.Escena.BloomFuerza,
      TipoParticulas: this.Contexto.Efectos.Tipo,
      CantidadParticulas: this.Contexto.Efectos.Cantidad,
      Entorno: this.Contexto.Entorno ? { ...this.Contexto.Entorno.Config } : undefined,
      PostProceso: this.Contexto.Escena.ObtenerConfigPostProceso(),
      LucesEscenario: this.Contexto.Escena.ObtenerConfigsLucesEscenario(),
      TiempoGuardadoMs: Date.now()
    };

    try {
      window.localStorage.setItem(CLAVE_RESPALDO, JSON.stringify(Datos));
      this.AlCambiarEstadoRespaldo?.();
      return true;
    } catch {
      // Silencioso si localStorage está lleno o restringido
      return false;
    }
  }

  public Restaurar(): boolean {
    try {
      const Crudo = window.localStorage.getItem(CLAVE_RESPALDO);
      if (!Crudo) return false;
      const Datos = JSON.parse(Crudo) as DatosAutoguardado;
      if (!Array.isArray(Datos.Pistas)) return false;

      const { Animacion, Escena, Audio, Efectos, Entorno, Historial, Estado, Bus } = this.Contexto;
      Animacion.Pistas = Datos.Pistas;
      Animacion.Duracion = Datos.Duracion ?? 10;
      Animacion.TiempoActual = 0;

      if (Datos.ColorFondo) Escena.EstablecerFondoColor(Datos.ColorFondo);
      Audio.Desplazamiento = Datos.DesplazamientoAudio ?? 0;
      Audio.EstablecerVolumen(Datos.VolumenAudio ?? 0.9);
      Escena.EstablecerBloom(Datos.BloomActivo ?? false, Datos.BloomFuerza ?? 0.55);
      if (Datos.TipoParticulas && Datos.TipoParticulas !== 'Ninguno') {
        Efectos.EstablecerParticulas(Datos.TipoParticulas as TipoParticulas, Datos.CantidadParticulas);
      }
      if (Datos.Entorno && Entorno) Entorno.AplicarConfig(Datos.Entorno);
      if (Datos.PostProceso) Escena.AplicarConfigPostProceso(Datos.PostProceso);
      if (Datos.LucesEscenario) Escena.AplicarLucesEscenario(Datos.LucesEscenario);

      Animacion.ReasignarPersonajesFaltantes();
      Historial.Limpiar();
      Estado.LimpiarSeleccion();
      Animacion.NotificarCambioPistas('autoguardado-restaurado');
      Animacion.EvaluarEn(0);
      Bus.Emitir('proyecto:cargado', {});

      this.Contexto.NotificarEstado(
        `Sesión restaurada (${Datos.Pistas.length} pistas).` +
        (Datos.NombreAudio ? ` Recarga el audio "${Datos.NombreAudio}" si lo necesitas.` : ''),
        'exito'
      );
      return true;
    } catch {
      this.Contexto.NotificarEstado('No se pudo restaurar la sesión autoguardada.', 'error');
      return false;
    }
  }

  public LimpiarRespaldo(): void {
    this.Pendiente = false;
    if (this.Temporizador !== null) {
      window.clearTimeout(this.Temporizador);
      this.Temporizador = null;
    }
    try {
      window.localStorage.removeItem(CLAVE_RESPALDO);
      this.AlCambiarEstadoRespaldo?.();
    } catch {}
  }
}

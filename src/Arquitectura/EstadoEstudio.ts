// ============================================================================
// EstadoEstudio.ts — Patrón Store / ViewModel reactivo del editor
// Centraliza selección, imán, auto-clave, velocidad, rango de bucle y portapapeles.
// ============================================================================

import { BusEventos } from './BusEventos';
import {
  GrupoPista, RangoBucle, SeleccionClave, TipoInterpolacion, TipoObjetivoPista
} from '../Tipos';
import { Limitar } from '../Utilidades';

/** Elemento serializado dentro del portapapeles interno de fotogramas clave. */
export interface ClavePortapapeles {
  Tipo: TipoObjetivoPista;
  Objetivo: string;
  Grupo: GrupoPista;
  PersonajeId?: string;
  DeltaTiempo: number;
  Valor: number[];
  Interpolacion: TipoInterpolacion;
}

/** Contenido completo copiado desde una o varias pistas del timeline. */
export interface ContenidoPortapapeles {
  Claves: ClavePortapapeles[];
  TiempoOrigen: number;
}

/**
 * Almacén reactivo de estado de UI del estudio; notifica cambios vía BusEventos.
 */
export class EstadoEstudio {
  private _SeleccionClaves: SeleccionClave[] = [];
  private _HuesoSeleccionado: string | null = null;
  private _AutoClave = false;
  private _ImanActivo = true;
  private _PasoIman = 1 / 24;
  private _VelocidadReproduccion = 1;
  private _InterpolacionPorDefecto: TipoInterpolacion = 'Suave';
  private _RangoBucle: RangoBucle = { Activo: false, Inicio: 0, Fin: 10 };
  private _FiltroPistas = '';

  public GruposExpandidos: Record<string, boolean> = {
    Manual: true,
    Preajuste: true,
    Importado: true,
    SeguimientoCuerpo: false,
    SeguimientoRostro: false,
    GrabacionVMC: false
  };

  public Portapapeles: ContenidoPortapapeles | null = null;

  constructor(private readonly Bus: BusEventos) {}

  // --------------------------------------------------------------------------
  // Selección múltiple de claves
  // --------------------------------------------------------------------------

  public get SeleccionClaves(): readonly SeleccionClave[] {
    return this._SeleccionClaves;
  }

  public get SeleccionPrincipal(): SeleccionClave | null {
    return this._SeleccionClaves.length > 0 ? this._SeleccionClaves[0] : null;
  }

  public SeleccionarUna(pistaId: string, claveId: string): void {
    this._SeleccionClaves = [{ PistaId: pistaId, ClaveId: claveId }];
    this.EmitirSeleccion();
  }

  public AlternarSeleccion(pistaId: string, claveId: string): void {
    const Indice = this._SeleccionClaves.findIndex(
      (S) => S.PistaId === pistaId && S.ClaveId === claveId
    );
    if (Indice >= 0) {
      this._SeleccionClaves = this._SeleccionClaves.filter((_, I) => I !== Indice);
    } else {
      this._SeleccionClaves = [...this._SeleccionClaves, { PistaId: pistaId, ClaveId: claveId }];
    }
    this.EmitirSeleccion();
  }

  public EstablecerSeleccion(seleccion: SeleccionClave[]): void {
    // Deduplicar por par PistaId|ClaveId
    const Vistos = new Set<string>();
    const Unicos: SeleccionClave[] = [];
    for (const Item of seleccion) {
      const Llave = `${Item.PistaId}|${Item.ClaveId}`;
      if (!Vistos.has(Llave)) {
        Vistos.add(Llave);
        Unicos.push({ PistaId: Item.PistaId, ClaveId: Item.ClaveId });
      }
    }
    this._SeleccionClaves = Unicos;
    this.EmitirSeleccion();
  }

  public LimpiarSeleccion(): void {
    if (this._SeleccionClaves.length === 0) return;
    this._SeleccionClaves = [];
    this.EmitirSeleccion();
  }

  public EstaSeleccionada(pistaId: string, claveId: string): boolean {
    return this._SeleccionClaves.some((S) => S.PistaId === pistaId && S.ClaveId === claveId);
  }

  private EmitirSeleccion(): void {
    this.Bus.Emitir('seleccion:cambiada', {
      seleccion: this._SeleccionClaves.map((S) => ({ ...S }))
    });
  }

  // --------------------------------------------------------------------------
  // Propiedades del estudio
  // --------------------------------------------------------------------------

  public get HuesoSeleccionado(): string | null {
    return this._HuesoSeleccionado;
  }

  public set HuesoSeleccionado(valor: string | null) {
    if (this._HuesoSeleccionado === valor) return;
    this._HuesoSeleccionado = valor;
    this.Bus.Emitir('hueso:seleccionado', { hueso: valor });
  }

  public get AutoClave(): boolean {
    return this._AutoClave;
  }

  public set AutoClave(valor: boolean) {
    if (this._AutoClave === valor) return;
    this._AutoClave = valor;
    this.Bus.Emitir('estudio:configuracion', { clave: 'AutoClave' });
  }

  public get ImanActivo(): boolean {
    return this._ImanActivo;
  }

  public set ImanActivo(valor: boolean) {
    if (this._ImanActivo === valor) return;
    this._ImanActivo = valor;
    this.Bus.Emitir('estudio:configuracion', { clave: 'ImanActivo' });
  }

  public get PasoIman(): number {
    return this._PasoIman;
  }

  public set PasoIman(valor: number) {
    const Limpio = Limitar(valor, 1 / 120, 5);
    if (Math.abs(this._PasoIman - Limpio) < 1e-6) return;
    this._PasoIman = Limpio;
    this.Bus.Emitir('estudio:configuracion', { clave: 'PasoIman' });
  }

  public get VelocidadReproduccion(): number {
    return this._VelocidadReproduccion;
  }

  public set VelocidadReproduccion(valor: number) {
    const Limpio = Limitar(valor, 0.1, 4);
    if (Math.abs(this._VelocidadReproduccion - Limpio) < 1e-4) return;
    this._VelocidadReproduccion = Limpio;
    this.Bus.Emitir('estudio:configuracion', { clave: 'VelocidadReproduccion' });
  }

  public get InterpolacionPorDefecto(): TipoInterpolacion {
    return this._InterpolacionPorDefecto;
  }

  public set InterpolacionPorDefecto(valor: TipoInterpolacion) {
    if (this._InterpolacionPorDefecto === valor) return;
    this._InterpolacionPorDefecto = valor;
    this.Bus.Emitir('estudio:configuracion', { clave: 'InterpolacionPorDefecto' });
  }

  public get RangoBucle(): RangoBucle {
    return { ...this._RangoBucle };
  }

  public EstablecerRangoBucle(parcial: Partial<RangoBucle>, duracionMax = 600): void {
    const Siguiente: RangoBucle = {
      Activo: parcial.Activo ?? this._RangoBucle.Activo,
      Inicio: Limitar(parcial.Inicio ?? this._RangoBucle.Inicio, 0, duracionMax),
      Fin: Limitar(parcial.Fin ?? this._RangoBucle.Fin, 0.1, duracionMax)
    };
    if (Siguiente.Fin <= Siguiente.Inicio + 0.05) {
      Siguiente.Fin = Math.min(duracionMax, Siguiente.Inicio + 0.25);
    }
    this._RangoBucle = Siguiente;
    this.Bus.Emitir('estudio:configuracion', { clave: 'RangoBucle' });
  }

  public get FiltroPistas(): string {
    return this._FiltroPistas;
  }

  public set FiltroPistas(valor: string) {
    const Normalizado = valor ?? '';
    if (this._FiltroPistas === Normalizado) return;
    this._FiltroPistas = Normalizado;
    this.Bus.Emitir('estudio:configuracion', { clave: 'FiltroPistas' });
  }

  public AlternarGrupoExpandido(grupo: string, expandido?: boolean): void {
    this.GruposExpandidos[grupo] = expandido ?? !this.GruposExpandidos[grupo];
    this.Bus.Emitir('estudio:configuracion', { clave: 'GruposExpandidos' });
  }

  /** Ajusta un tiempo en segundos a la rejilla de imán activa. */
  public AjustarTiempoConIman(tiempo: number, omitirIman = false): number {
    const Base = Math.max(0, tiempo);
    if (!this._ImanActivo || omitirIman || this._PasoIman <= 0) {
      return Math.round(Base * 10000) / 10000;
    }
    const Ajustado = Math.round(Base / this._PasoIman) * this._PasoIman;
    return Math.max(0, Math.round(Ajustado * 10000) / 10000);
  }
}

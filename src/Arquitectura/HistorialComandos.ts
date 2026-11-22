// ============================================================================
// HistorialComandos.ts — Patrones Command y Composite para Undo/Redo
// Encapsula operaciones reversibles y acciones compuestas atómicas.
// ============================================================================

import { BusEventos } from './BusEventos';

/** Interfaz base para cualquier comando reversible del estudio. */
export interface Comando {
  readonly Descripcion: string;
  Ejecutar(): void;
  Deshacer(): void;
}

/**
 * Patrón Composite: agrupa varios comandos como una sola entrada atómica del historial.
 */
export class ComandoLote implements Comando {
  constructor(
    public readonly Descripcion: string,
    private readonly Subcomandos: Comando[]
  ) {}

  public get Vacio(): boolean {
    return this.Subcomandos.length === 0;
  }

  public Ejecutar(): void {
    for (const Cmd of this.Subcomandos) {
      Cmd.Ejecutar();
    }
  }

  public Deshacer(): void {
    for (let I = this.Subcomandos.length - 1; I >= 0; I--) {
      this.Subcomandos[I].Deshacer();
    }
  }
}

/**
 * Administra las pilas de deshacer y rehacer notificando cambios vía BusEventos.
 */
export class HistorialComandos {
  private PilaDeshacer: Comando[] = [];
  private PilaRehacer: Comando[] = [];

  constructor(
    private readonly Bus: BusEventos,
    private readonly MaxHistorial = 100
  ) {}

  /** Ejecuta un comando nuevo, limpia rehacer y lo registra en la pila. */
  public Ejecutar(comando: Comando): void {
    comando.Ejecutar();
    this.ApilarComando(comando);
  }

  /**
   * Registra un comando que ya aplicó sus efectos (por ejemplo tras un arrastre interactivo)
   * sin volver a ejecutarlo en el primer registro.
   */
  public RegistrarEjecutado(comando: Comando): void {
    this.ApilarComando(comando);
  }

  /** Revierte el último comando ejecutado si existe. */
  public Deshacer(): Comando | null {
    const Cmd = this.PilaDeshacer.pop();
    if (!Cmd) return null;
    Cmd.Deshacer();
    this.PilaRehacer.push(Cmd);
    this.EmitirEstado();
    this.Bus.Emitir('estado:notificar', {
      mensaje: `Deshecho: ${Cmd.Descripcion}`,
      tipo: 'info'
    });
    return Cmd;
  }

  /** Vuelve a aplicar el último comando deshecho si existe. */
  public Rehacer(): Comando | null {
    const Cmd = this.PilaRehacer.pop();
    if (!Cmd) return null;
    Cmd.Ejecutar();
    this.PilaDeshacer.push(Cmd);
    this.EmitirEstado();
    this.Bus.Emitir('estado:notificar', {
      mensaje: `Rehecho: ${Cmd.Descripcion}`,
      tipo: 'info'
    });
    return Cmd;
  }

  /** Vacía completamente ambas pilas (al crear o cargar proyecto). */
  public Limpiar(): void {
    this.PilaDeshacer = [];
    this.PilaRehacer = [];
    this.EmitirEstado();
  }

  public PuedeDeshacer(): boolean {
    return this.PilaDeshacer.length > 0;
  }

  public PuedeRehacer(): boolean {
    return this.PilaRehacer.length > 0;
  }

  public UltimoDeshacer(): string | null {
    const N = this.PilaDeshacer.length;
    return N > 0 ? this.PilaDeshacer[N - 1].Descripcion : null;
  }

  public UltimoRehacer(): string | null {
    const N = this.PilaRehacer.length;
    return N > 0 ? this.PilaRehacer[N - 1].Descripcion : null;
  }

  private ApilarComando(comando: Comando): void {
    this.PilaDeshacer.push(comando);
    if (this.PilaDeshacer.length > this.MaxHistorial) {
      this.PilaDeshacer.shift();
    }
    this.PilaRehacer = [];
    this.EmitirEstado();
  }

  private EmitirEstado(): void {
    this.Bus.Emitir('historial:cambiado', {
      puedeDeshacer: this.PuedeDeshacer(),
      puedeRehacer: this.PuedeRehacer(),
      ultimoDeshacer: this.UltimoDeshacer(),
      ultimoRehacer: this.UltimoRehacer()
    });
  }
}

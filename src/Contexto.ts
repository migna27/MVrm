// ============================================================================
// Contexto.ts — Contexto compartido de la aplicación
// Agrupa a todos los gestores para que los paneles y la línea de tiempo
// puedan comunicarse sin importaciones circulares.
// ============================================================================

import type { GestorEscena } from './Nucleo/GestorEscena';
import type { GestorModelos } from './Nucleo/GestorModelos';
import type { GestorAnimacion } from './Nucleo/GestorAnimacion';
import type { GestorAudio } from './Nucleo/GestorAudio';
import type { GestorEfectos } from './Nucleo/GestorEfectos';
import type { GestorTracking } from './Nucleo/GestorTracking';
import type { GestorExportacion } from './Nucleo/GestorExportacion';
import type { GestorVMC } from './Nucleo/GestorVMC';

export interface ContextoAplicacion {
  Escena: GestorEscena;
  Modelos: GestorModelos;
  Animacion: GestorAnimacion;
  Audio: GestorAudio;
  Efectos: GestorEfectos;
  Tracking: GestorTracking;
  Exportador: GestorExportacion;
  VMC: GestorVMC;

  /** Muestra un mensaje en la barra de estado del visor. */
  NotificarEstado(Mensaje: string): void;
  /** Solicita redibujar la línea de tiempo. */
  RefrescarLineaTiempo(): void;
  /** Solicita reconstruir las partes dinámicas del panel lateral. */
  RefrescarPanel(): void;
}

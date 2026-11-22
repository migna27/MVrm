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
import type { GestorExportacion } from './Nucleo/GestorExportacion';
import type { GestorVMC } from './Nucleo/GestorVMC';
import type { BusEventos } from './Arquitectura/BusEventos';
import type { HistorialComandos } from './Arquitectura/HistorialComandos';
import type { EstadoEstudio } from './Arquitectura/EstadoEstudio';
import type { ServicioImportacion } from './Arquitectura/ImportadoresAnimacion';
import type { GestorEntorno } from './Nucleo/GestorEntorno';
import type { GestorProps } from './Nucleo/GestorProps';

export interface ContextoAplicacion {
  Bus: BusEventos;
  Historial: HistorialComandos;
  Estado: EstadoEstudio;
  Escena: GestorEscena;
  Modelos: GestorModelos;
  Animacion: GestorAnimacion;
  Audio: GestorAudio;
  Efectos: GestorEfectos;
  Exportador: GestorExportacion;
  VMC: GestorVMC;
  Importador: ServicioImportacion;
  Entorno?: GestorEntorno;
  Props?: GestorProps;

  /** Muestra un mensaje en la barra de estado del visor. */
  NotificarEstado(Mensaje: string, Tipo?: 'info' | 'exito' | 'aviso' | 'error', PermitirDeshacer?: boolean): void;
  /** Solicita redibujar la línea de tiempo. */
  RefrescarLineaTiempo(): void;
  /** Solicita reconstruir las partes dinámicas del panel lateral. */
  RefrescarPanel(): void;
}

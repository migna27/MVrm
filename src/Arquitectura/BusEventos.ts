// ============================================================================
// BusEventos.ts — Patrón Observer (Publicar/Suscribir) tipado
// Desacopla los gestores de núcleo, el historial y los componentes de interfaz.
// ============================================================================

import { SeleccionClave } from '../Tipos';

/** Nivel semántico de una notificación emitida hacia la interfaz. */
export type TipoNotificacion = 'info' | 'exito' | 'aviso' | 'error';

/** Catálogo tipado de eventos del estudio y sus cargas útiles. */
export interface MapaEventos {
  'pistas:cambiadas': { motivo?: string };
  'tiempo:cambiado': { tiempo: number; fuente: 'reproduccion' | 'usuario' | 'comando' };
  'seleccion:cambiada': { seleccion: SeleccionClave[] };
  'historial:cambiado': {
    puedeDeshacer: boolean;
    puedeRehacer: boolean;
    ultimoDeshacer: string | null;
    ultimoRehacer: string | null;
  };
  'modelo:cargado': { nombre: string };
  'hueso:seleccionado': { hueso: string | null };
  'reproduccion:cambiada': { reproduciendo: boolean };
  'estado:notificar': { mensaje: string; tipo?: TipoNotificacion; permitirDeshacer?: boolean };
  'estudio:configuracion': { clave: string };
  'proyecto:cargado': Record<string, never>;
  'audio:cambiado': Record<string, never>;
}

/** Función oyente para un evento específico del mapa. */
export type OyenteEvento<K extends keyof MapaEventos> = (datos: MapaEventos[K]) => void;

/**
 * Bus de eventos síncrono con suscripciones desacopladas y función de limpieza.
 */
export class BusEventos {
  private Oyentes = new Map<keyof MapaEventos, Set<(datos: any) => void>>();

  /** Registra un oyente para el evento indicado y devuelve su función para desuscribirse. */
  public Suscribir<K extends keyof MapaEventos>(evento: K, oyente: OyenteEvento<K>): () => void {
    let Conjunto = this.Oyentes.get(evento);
    if (!Conjunto) {
      Conjunto = new Set();
      this.Oyentes.set(evento, Conjunto);
    }
    Conjunto.add(oyente);
    return () => {
      Conjunto?.delete(oyente);
    };
  }

  /** Emite un evento a todos los oyentes suscritos actualmente. */
  public Emitir<K extends keyof MapaEventos>(evento: K, datos: MapaEventos[K]): void {
    const Conjunto = this.Oyentes.get(evento);
    if (!Conjunto || Conjunto.size === 0) return;
    for (const Oyente of [...Conjunto]) {
      Oyente(datos);
    }
  }

  /** Elimina todas las suscripciones registradas. */
  public Limpiar(): void {
    this.Oyentes.clear();
  }
}

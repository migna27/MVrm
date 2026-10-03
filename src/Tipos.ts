// ============================================================================
// Tipos.ts — Definiciones de tipos compartidos del Animador VRM
// Todas las estructuras de datos que viajan entre los gestores viven aquí.
// ============================================================================

/** Objetivo que puede animar una pista de la línea de tiempo. */
export type TipoObjetivoPista = 'HuesoRotacion' | 'HuesoPosicion' | 'Expresion';

/** Origen de una pista; define el color y la prioridad de aplicación. */
export type GrupoPista = 'Manual' | 'Preajuste' | 'Importado' | 'SeguimientoCuerpo' | 'SeguimientoRostro';

/** Clave (fotograma clave) individual dentro de una pista. */
export interface ClaveAnimacion {
  Id: string;
  Tiempo: number;    // Segundos dentro de la línea de tiempo
  Valor: number[];   // Euler XYZ (radianes), posición XYZ o [peso 0..1] según la pista
}

/** Pista de animación: secuencia ordenada de claves sobre un objetivo. */
export interface PistaAnimacion {
  Id: string;
  Nombre: string;          // Nombre visible en la línea de tiempo
  Tipo: TipoObjetivoPista;
  Objetivo: string;        // Nombre del hueso humanoide (p. ej. "leftUpperArm") o de la expresión
  Grupo: GrupoPista;
  Claves: ClaveAnimacion[];
}

/** Opciones del seguimiento de movimiento a partir de video. */
export interface OpcionesSeguimiento {
  Cuerpo: boolean;       // Rastrear cuerpo (pose)
  Rostro: boolean;       // Rastrear rostro (blendshapes + rotación de cabeza)
  Espejo: boolean;       // Invertir eje X (efecto espejo tipo cámara frontal)
  FpsMuestreo: number;   // Cuadros por segundo a analizar del video
  Suavizado: number;     // 0 = sin suavizado, 0.9 = muy suave
}

/** Opciones de exportación del render final. */
export interface OpcionesExportacion {
  Ancho: number;
  Alto: number;
  Fps: number;
  Formato: 'mp4' | 'webm';
  IncluirAudio: boolean;
}

/** Datos serializables de un proyecto guardado. */
export interface DatosProyecto {
  Version: number;
  Duracion: number;
  Pistas: PistaAnimacion[];
  ColorFondo: string;
  DesplazamientoAudio: number;
  VolumenAudio: number;
  NombreAudio: string | null;
  BloomActivo: boolean;
  BloomFuerza: number;
  TipoParticulas: string;
  CantidadParticulas: number;
}

/** Resoluciones de exportación disponibles (hasta 4K UHD). */
export const RESOLUCIONES_EXPORTACION = [
  { Etiqueta: 'HD 720p', Ancho: 1280, Alto: 720 },
  { Etiqueta: 'Full HD 1080p', Ancho: 1920, Alto: 1080 },
  { Etiqueta: 'QHD 1440p', Ancho: 2560, Alto: 1440 },
  { Etiqueta: '4K UHD 2160p', Ancho: 3840, Alto: 2160 }
];

/** Prioridad de aplicación de grupos: los últimos sobrescriben a los primeros. */
export const PRIORIDAD_GRUPOS: GrupoPista[] = [
  'SeguimientoCuerpo',
  'SeguimientoRostro',
  'Importado',
  'Preajuste',
  'Manual'
];

/** Colores de identificación por grupo para la línea de tiempo. */
export const COLORES_GRUPO: Record<GrupoPista, string> = {
  Manual: '#6cc8ff',
  Preajuste: '#8be28b',
  Importado: '#c9a7ff',
  SeguimientoCuerpo: '#ffb35c',
  SeguimientoRostro: '#ff7fb1'
};

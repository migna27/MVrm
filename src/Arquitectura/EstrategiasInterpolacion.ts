// ============================================================================
// EstrategiasInterpolacion.ts — Patrón Strategy para curvas de keyframe
// Define estrategias intercambiables para evaluar transiciones entre claves.
// ============================================================================

import { TipoInterpolacion } from '../Tipos';
import { Limitar } from '../Utilidades';

/** Contrato de una estrategia de interpolación normalizada en [0, 1]. */
export interface EstrategiaInterpolacion {
  readonly Tipo: TipoInterpolacion;
  readonly Etiqueta: string;
  readonly Descripcion: string;
  readonly Abreviatura: string;
  Evaluar(t: number): number;
}

const EstrategiaSuave: EstrategiaInterpolacion = {
  Tipo: 'Suave',
  Etiqueta: 'Suave',
  Descripcion: 'Acelera al salir y frena al llegar (cúbica)',
  Abreviatura: 'SV',
  Evaluar: (t: number): number => {
    const X = Limitar(t, 0, 1);
    return X < 0.5 ? 4 * X * X * X : 1 - Math.pow(-2 * X + 2, 3) / 2;
  }
};

const EstrategiaLineal: EstrategiaInterpolacion = {
  Tipo: 'Lineal',
  Etiqueta: 'Lineal',
  Descripcion: 'Velocidad constante sin aceleración',
  Abreviatura: 'LN',
  Evaluar: (t: number): number => Limitar(t, 0, 1)
};

const EstrategiaEntradaSuave: EstrategiaInterpolacion = {
  Tipo: 'EntradaSuave',
  Etiqueta: 'Entrada suave',
  Descripcion: 'Comienza lento y acelera hacia la siguiente clave',
  Abreviatura: 'IN',
  Evaluar: (t: number): number => {
    const X = Limitar(t, 0, 1);
    return X * X * X;
  }
};

const EstrategiaSalidaSuave: EstrategiaInterpolacion = {
  Tipo: 'SalidaSuave',
  Etiqueta: 'Salida suave',
  Descripcion: 'Comienza rápido y desacelera suavemente al llegar',
  Abreviatura: 'OUT',
  Evaluar: (t: number): number => {
    const X = Limitar(t, 0, 1);
    return 1 - Math.pow(1 - X, 3);
  }
};

const EstrategiaEscalon: EstrategiaInterpolacion = {
  Tipo: 'Escalon',
  Etiqueta: 'Escalón',
  Descripcion: 'Mantiene el valor fijo hasta el instante siguiente (Hold)',
  Abreviatura: 'ST',
  Evaluar: (t: number): number => (t >= 1 ? 1 : 0)
};

/** Mapa indexado de estrategias de interpolación disponibles. */
export const ESTRATEGIAS_INTERPOLACION: Record<TipoInterpolacion, EstrategiaInterpolacion> = {
  Suave: EstrategiaSuave,
  Lineal: EstrategiaLineal,
  EntradaSuave: EstrategiaEntradaSuave,
  SalidaSuave: EstrategiaSalidaSuave,
  Escalon: EstrategiaEscalon
};

/** Lista ordenada para poblar selectores de interfaz. */
export const LISTA_INTERPOLACIONES: EstrategiaInterpolacion[] = [
  EstrategiaSuave,
  EstrategiaLineal,
  EstrategiaEntradaSuave,
  EstrategiaSalidaSuave,
  EstrategiaEscalon
];

/** Resuelve la estrategia correspondiente (usa 'Suave' como valor por defecto). */
export function ObtenerEstrategiaInterpolacion(tipo?: TipoInterpolacion): EstrategiaInterpolacion {
  if (tipo && tipo in ESTRATEGIAS_INTERPOLACION) {
    return ESTRATEGIAS_INTERPOLACION[tipo];
  }
  return EstrategiaSuave;
}

/** Evalúa directamente un parámetro normalizado t usando la estrategia indicada. */
export function EvaluarInterpolacion(t: number, tipo?: TipoInterpolacion): number {
  return ObtenerEstrategiaInterpolacion(tipo).Evaluar(t);
}

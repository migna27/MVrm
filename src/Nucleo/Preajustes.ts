// ============================================================================
// Preajustes.ts — Etapa 2: Biblioteca de animaciones predefinidas
// Cada preajuste genera pistas de claves editables a partir del tiempo
// indicado. Los valores son puntos de partida que el usuario puede ajustar.
// ============================================================================

import { PistaAnimacion } from '../Tipos';
import { GenerarId } from '../Utilidades';
import { NOMBRES_HUESOS_LEGIBLES } from './GestorModelos';

/** Definición de un preajuste de animación. */
export interface PreajusteAnimacion {
  Nombre: string;
  Descripcion: string;
  Duracion: number; // Duración sugerida del bloque generado
  Generar: (Inicio: number) => PistaAnimacion[];
}

// ----------------------------------------------------------------------------
// Auxiliares para construir pistas de forma compacta
// ----------------------------------------------------------------------------

type EntradaClave = [number, number[]]; // [tiempo relativo, valor]

/** Crea una pista de rotación de hueso con claves [tiempo, [x, y, z]]. */
function PistaHueso(Objetivo: string, Inicio: number, Entradas: EntradaClave[]): PistaAnimacion {
  return {
    Id: GenerarId(),
    Nombre: `Preajuste · ${NOMBRES_HUESOS_LEGIBLES[Objetivo] ?? Objetivo}`,
    Tipo: 'HuesoRotacion',
    Objetivo,
    Grupo: 'Preajuste',
    Claves: Entradas.map(([T, V]) => ({ Id: GenerarId(), Tiempo: Inicio + T, Valor: V }))
  };
}

/** Crea una pista de posición de hueso con claves [tiempo, [x, y, z]]. */
function PistaPosicion(Objetivo: string, Inicio: number, Entradas: EntradaClave[]): PistaAnimacion {
  return {
    Id: GenerarId(),
    Nombre: `Preajuste · Posición ${NOMBRES_HUESOS_LEGIBLES[Objetivo] ?? Objetivo}`,
    Tipo: 'HuesoPosicion',
    Objetivo,
    Grupo: 'Preajuste',
    Claves: Entradas.map(([T, V]) => ({ Id: GenerarId(), Tiempo: Inicio + T, Valor: V }))
  };
}

/** Crea una pista de expresión facial con claves [tiempo, [peso]]. */
function PistaExpresion(Objetivo: string, Inicio: number, Entradas: EntradaClave[]): PistaAnimacion {
  return {
    Id: GenerarId(),
    Nombre: `Preajuste · ${Objetivo}`,
    Tipo: 'Expresion',
    Objetivo,
    Grupo: 'Preajuste',
    Claves: Entradas.map(([T, V]) => ({ Id: GenerarId(), Tiempo: Inicio + T, Valor: V }))
  };
}

// ----------------------------------------------------------------------------
// Catálogo de preajustes
// ----------------------------------------------------------------------------

export const CATALOGO_PREAJUSTES: PreajusteAnimacion[] = [
  {
    Nombre: 'Respiración en reposo',
    Descripcion: 'Movimiento sutil de pecho, cabeza y brazos en bucle.',
    Duracion: 4,
    Generar: (I) => [
      PistaHueso('chest', I, [[0, [0, 0, 0]], [2, [0.045, 0, 0]], [4, [0, 0, 0]]]),
      PistaHueso('head', I, [[0, [0, 0, 0]], [2, [0.02, 0.03, 0]], [4, [0, 0, 0]]]),
      PistaHueso('leftUpperArm', I, [[0, [0, 0, 0.06]], [2, [0, 0, 0.09]], [4, [0, 0, 0.06]]]),
      PistaHueso('rightUpperArm', I, [[0, [0, 0, -0.06]], [2, [0, 0, -0.09]], [4, [0, 0, -0.06]]])
    ]
  },
  {
    Nombre: 'Saludar con la mano',
    Descripcion: 'Levanta el brazo derecho y agita la mano tres veces.',
    Duracion: 2.4,
    Generar: (I) => [
      PistaHueso('rightUpperArm', I, [[0, [0, 0, -0.1]], [0.5, [0.15, 0, -2.25]], [2.0, [0.15, 0, -2.25]], [2.4, [0, 0, -0.1]]]),
      PistaHueso('rightLowerArm', I, [
        [0, [0, 0, 0]], [0.5, [0, -0.35, -0.25]],
        [0.8, [0, -0.35, 0.25]], [1.1, [0, -0.35, -0.25]],
        [1.4, [0, -0.35, 0.25]], [1.7, [0, -0.35, -0.25]],
        [2.0, [0, -0.35, 0.1]], [2.4, [0, 0, 0]]
      ]),
      PistaHueso('head', I, [[0, [0, 0, 0]], [0.5, [0, 0, 0.08]], [2.0, [0, 0, 0.08]], [2.4, [0, 0, 0]]])
    ]
  },
  {
    Nombre: 'Caminar en el lugar',
    Descripcion: 'Ciclo de caminata con balanceo de brazos y cadera.',
    Duracion: 2,
    Generar: (I) => [
      PistaHueso('leftUpperLeg', I, [[0, [-0.55, 0, 0]], [0.5, [0.4, 0, 0]], [1, [-0.55, 0, 0]], [1.5, [0.4, 0, 0]], [2, [-0.55, 0, 0]]]),
      PistaHueso('rightUpperLeg', I, [[0, [0.4, 0, 0]], [0.5, [-0.55, 0, 0]], [1, [0.4, 0, 0]], [1.5, [-0.55, 0, 0]], [2, [0.4, 0, 0]]]),
      PistaHueso('leftLowerLeg', I, [[0, [0.25, 0, 0]], [0.5, [0.9, 0, 0]], [1, [0.25, 0, 0]], [1.5, [0.9, 0, 0]], [2, [0.25, 0, 0]]]),
      PistaHueso('rightLowerLeg', I, [[0, [0.9, 0, 0]], [0.5, [0.25, 0, 0]], [1, [0.9, 0, 0]], [1.5, [0.25, 0, 0]], [2, [0.9, 0, 0]]]),
      PistaHueso('leftUpperArm', I, [[0, [0.4, 0, 0.08]], [0.5, [-0.4, 0, 0.08]], [1, [0.4, 0, 0.08]], [1.5, [-0.4, 0, 0.08]], [2, [0.4, 0, 0.08]]]),
      PistaHueso('rightUpperArm', I, [[0, [-0.4, 0, -0.08]], [0.5, [0.4, 0, -0.08]], [1, [-0.4, 0, -0.08]], [1.5, [0.4, 0, -0.08]], [2, [-0.4, 0, -0.08]]]),
      PistaHueso('spine', I, [[0, [0, 0.06, 0]], [0.5, [0, -0.06, 0]], [1, [0, 0.06, 0]], [1.5, [0, -0.06, 0]], [2, [0, 0.06, 0]]]),
      PistaPosicion('hips', I, [[0, [0, 0, 0]], [0.25, [0, 0.035, 0]], [0.5, [0, 0, 0]], [0.75, [0, 0.035, 0]], [1, [0, 0, 0]], [1.25, [0, 0.035, 0]], [1.5, [0, 0, 0]], [1.75, [0, 0.035, 0]], [2, [0, 0, 0]]])
    ]
  },
  {
    Nombre: 'Baile alegre',
    Descripcion: 'Movimiento festivo de brazos, cadera y rodillas.',
    Duracion: 2.4,
    Generar: (I) => [
      PistaHueso('leftUpperArm', I, [[0, [0, 0, 2.4]], [0.6, [0, 0, 0.5]], [1.2, [0, 0, 2.4]], [1.8, [0, 0, 0.5]], [2.4, [0, 0, 2.4]]]),
      PistaHueso('rightUpperArm', I, [[0, [0, 0, -0.5]], [0.6, [0, 0, -2.4]], [1.2, [0, 0, -0.5]], [1.8, [0, 0, -2.4]], [2.4, [0, 0, -0.5]]]),
      PistaHueso('leftLowerArm', I, [[0, [0, 0, 0.5]], [0.6, [0, 0, 0.2]], [1.2, [0, 0, 0.5]], [1.8, [0, 0, 0.2]], [2.4, [0, 0, 0.5]]]),
      PistaHueso('rightLowerArm', I, [[0, [0, 0, -0.2]], [0.6, [0, 0, -0.5]], [1.2, [0, 0, -0.2]], [1.8, [0, 0, -0.5]], [2.4, [0, 0, -0.2]]]),
      PistaHueso('hips', I, [[0, [0, 0, 0.12]], [0.6, [0, 0, -0.12]], [1.2, [0, 0, 0.12]], [1.8, [0, 0, -0.12]], [2.4, [0, 0, 0.12]]]),
      PistaHueso('head', I, [[0, [0, 0, 0.1]], [0.6, [0, 0, -0.1]], [1.2, [0, 0, 0.1]], [1.8, [0, 0, -0.1]], [2.4, [0, 0, 0.1]]]),
      PistaExpresion('happy', I, [[0, [1]], [2.4, [1]]])
    ]
  },
  {
    Nombre: 'Asentir',
    Descripcion: 'Movimiento de cabeza de arriba hacia abajo (sí).',
    Duracion: 1.2,
    Generar: (I) => [
      PistaHueso('head', I, [[0, [0, 0, 0]], [0.3, [0.35, 0, 0]], [0.6, [-0.05, 0, 0]], [0.9, [0.35, 0, 0]], [1.2, [0, 0, 0]]]),
      PistaHueso('neck', I, [[0, [0, 0, 0]], [0.3, [0.15, 0, 0]], [0.6, [-0.02, 0, 0]], [0.9, [0.15, 0, 0]], [1.2, [0, 0, 0]]])
    ]
  },
  {
    Nombre: 'Negar',
    Descripcion: 'Movimiento de cabeza de lado a lado (no).',
    Duracion: 1.2,
    Generar: (I) => [
      PistaHueso('head', I, [[0, [0, 0, 0]], [0.3, [0, 0.5, 0]], [0.6, [0, -0.5, 0]], [0.9, [0, 0.5, 0]], [1.2, [0, 0, 0]]])
    ]
  },
  {
    Nombre: 'Parpadeo natural',
    Descripcion: 'Tres parpadeos distribuidos en cuatro segundos.',
    Duracion: 4,
    Generar: (I) => [
      PistaExpresion('blink', I, [
        [0.4, [0]], [0.52, [1]], [0.64, [0]],
        [2.1, [0]], [2.22, [1]], [2.34, [0]],
        [3.3, [0]], [3.42, [1]], [3.54, [0]]
      ])
    ]
  },
  {
    Nombre: 'Brazos abajo (A-Pose)',
    Descripcion: 'Pose relajada con brazos a los lados.',
    Duracion: 1,
    Generar: (I) => [
      PistaHueso('leftUpperArm', I, [[0, [0, 0, -1.2]]]),
      PistaHueso('rightUpperArm', I, [[0, [0, 0, 1.2]]])
    ]
  },
  {
    Nombre: 'T-Pose (Restaurar)',
    Descripcion: 'Restaura la pose de referencia T-Pose.',
    Duracion: 1,
    Generar: (I) => [
      PistaHueso('leftUpperArm', I, [[0, [0, 0, 0]]]),
      PistaHueso('rightUpperArm', I, [[0, [0, 0, 0]]]),
      PistaHueso('leftLowerArm', I, [[0, [0, 0, 0]]]),
      PistaHueso('rightLowerArm', I, [[0, [0, 0, 0]]]),
      PistaHueso('spine', I, [[0, [0, 0, 0]]]),
      PistaHueso('head', I, [[0, [0, 0, 0]]]),
      PistaHueso('leftUpperLeg', I, [[0, [0, 0, 0]]]),
      PistaHueso('rightUpperLeg', I, [[0, [0, 0, 0]]])
    ]
  },
  {
    Nombre: 'Brazos cruzados',
    Descripcion: 'Ambos brazos cruzados sobre el pecho.',
    Duracion: 1,
    Generar: (I) => [
      PistaHueso('leftUpperArm', I, [[0, [0, 0.4, -1.2]]]),
      PistaHueso('rightUpperArm', I, [[0, [0, -0.4, 1.2]]]),
      PistaHueso('leftLowerArm', I, [[0, [0, -1.5, 0]]]),
      PistaHueso('rightLowerArm', I, [[0, [0, 1.5, 0]]])
    ]
  },
  {
    Nombre: 'Cansancio / Agotamiento',
    Descripcion: 'Hombros caídos y mirada al suelo.',
    Duracion: 1,
    Generar: (I) => [
      PistaHueso('spine', I, [[0, [0.3, 0, 0]]]),
      PistaHueso('neck', I, [[0, [0.2, 0, 0]]]),
      PistaHueso('head', I, [[0, [0.3, 0, 0]]]),
      PistaHueso('leftUpperArm', I, [[0, [0, 0, -1.1]]]),
      PistaHueso('rightUpperArm', I, [[0, [0, 0, 1.1]]]),
      PistaExpresion('sad', I, [[0, [0.8]]])
    ]
  },
  {
    Nombre: 'Expresión feliz',
    Descripcion: 'Sonrisa amplia con ojos alegres.',
    Duracion: 2,
    Generar: (I) => [PistaExpresion('happy', I, [[0, [0]], [0.5, [1]], [2, [1]]])]
  },
  {
    Nombre: 'Expresión triste',
    Descripcion: 'Cejas y boca caídas.',
    Duracion: 2,
    Generar: (I) => [PistaExpresion('sad', I, [[0, [0]], [0.5, [1]], [2, [1]]])]
  },
  {
    Nombre: 'Expresión enojada',
    Descripcion: 'Ceño fruncido con mirada intensa.',
    Duracion: 2,
    Generar: (I) => [PistaExpresion('angry', I, [[0, [0]], [0.5, [1]], [2, [1]]])]
  },
  {
    Nombre: 'Expresión sorprendida',
    Descripcion: 'Ojos y boca bien abiertos.',
    Duracion: 2,
    Generar: (I) => [
      PistaExpresion('surprised', I, [[0, [0]], [0.35, [1]], [2, [1]]]),
      PistaExpresion('aa', I, [[0, [0]], [0.35, [0.6]], [2, [0.6]]])
    ]
  },
  {
    Nombre: 'Pose de combate',
    Descripcion: 'Guardia alta, puños listos.',
    Duracion: 1,
    Generar: (I) => [
      PistaHueso('leftUpperArm', I, [[0, [-0.5, 0.4, -0.6]]]),
      PistaHueso('rightUpperArm', I, [[0, [-0.5, -0.4, 0.6]]]),
      PistaHueso('leftLowerArm', I, [[0, [0, -1.8, 0]]]),
      PistaHueso('rightLowerArm', I, [[0, [0, 1.8, 0]]]),
      PistaHueso('leftHand', I, [[0, [0.2, 0, 0]]]),
      PistaHueso('rightHand', I, [[0, [0.2, 0, 0]]]),
      PistaHueso('leftUpperLeg', I, [[0, [-0.2, 0, 0.2]]]),
      PistaHueso('rightUpperLeg', I, [[0, [-0.2, 0, -0.2]]]),
      PistaHueso('spine', I, [[0, [0.1, 0.2, 0]]])
    ]
  },
  {
    Nombre: 'Pose sentado',
    Descripcion: 'Piernas flexionadas a 90 grados como en una silla.',
    Duracion: 1,
    Generar: (I) => [
      PistaHueso('leftUpperLeg', I, [[0, [-1.57, 0, 0]]]),
      PistaHueso('rightUpperLeg', I, [[0, [-1.57, 0, 0]]]),
      PistaHueso('leftLowerLeg', I, [[0, [1.57, 0, 0]]]),
      PistaHueso('rightLowerLeg', I, [[0, [1.57, 0, 0]]]),
      PistaPosicion('hips', I, [[0, [0, -0.6, 0]]])
    ]
  },
  {
    Nombre: 'Pose victoria',
    Descripcion: 'Brazo levantado en señal de victoria.',
    Duracion: 1,
    Generar: (I) => [
      PistaHueso('rightUpperArm', I, [[0, [0, 0, -2.8]]]),
      PistaHueso('rightLowerArm', I, [[0, [0, 0.2, 0]]]),
      PistaHueso('leftUpperArm', I, [[0, [0, 0, -1.2]]]),
      PistaExpresion('happy', I, [[0, [1]]])
    ]
  },
  {
    Nombre: 'Pensando',
    Descripcion: 'Mano en la barbilla y mirada pensativa.',
    Duracion: 1,
    Generar: (I) => [
      PistaHueso('rightUpperArm', I, [[0, [0, 0.4, -0.2]]]),
      PistaHueso('rightLowerArm', I, [[0, [0, 2.2, 0]]]),
      PistaHueso('leftUpperArm', I, [[0, [0, 0.8, -1.2]]]),
      PistaHueso('leftLowerArm', I, [[0, [0, -1.5, 0]]]),
      PistaHueso('neck', I, [[0, [0.1, 0.2, -0.1]]])
    ]
  }
];

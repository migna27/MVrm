/**
 * MotorLipSync.ts
 * Analizador DSP ligero en TypeScript puro para generar keyframes editables
 * de vocales VRM (`aa`, `ih`, `ou`, `ee`, `oh`) directamente desde una pista de audio.
 * Utiliza un banco de filtros Goertzel con ventana Hann sobre bandas formánticas F1/F2.
 */

export type VocalVrm = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';

export const VOCALES_LIPSYNC: readonly VocalVrm[] = ['aa', 'ih', 'ou', 'ee', 'oh'];

export interface AudioBufferComparable {
  sampleRate: number;
  duration: number;
  length?: number;
  numberOfChannels?: number;
  getChannelData(channel: number): Float32Array;
}

export interface OpcionesLipSync {
  /** Cuadros por segundo de muestreo (predeterminado: 24). */
  Fps?: number;
  /** Umbral RMS mínimo para considerar voz y evitar ruido de fondo (predeterminado: 0.012). */
  UmbralSilencio?: number;
  /** Multiplicador de ganancia para apertura bucal (predeterminado: 1.6). */
  Sensibilidad?: number;
  /** Factor EMA temporal 0..0.95 para suavizar transiciones (predeterminado: 0.42). */
  Suavizado?: number;
  /** Diferencia mínima para conservar un keyframe al simplificar la curva (predeterminado: 0.06). */
  UmbralSimplificacion?: number;
  /** Desplazamiento temporal en segundos sumado a cada keyframe (predeterminado: 0). */
  Desplazamiento?: number;
  /** Límite máximo de duración a analizar en segundos (opcional). */
  DuracionMaxima?: number;
}

export interface FotogramaLipSync {
  Tiempo: number;
  Energia: number;
  Vocales: Record<VocalVrm, number>;
}

export interface ClaveVocalLipSync {
  Tiempo: number;
  Valor: number;
}

export interface ResultadoLipSync {
  Fps: number;
  Duracion: number;
  Picos: number;
  Fotogramas: FotogramaLipSync[];
  ClavesPorVocal: Record<VocalVrm, ClaveVocalLipSync[]>;
}

const FRECUENCIAS_FORMANTES = [300, 500, 750, 1100, 1600, 2200, 2800] as const;
const TAMANO_VENTANA = 1024;

function Acotar01(V: number): number {
  if (!Number.isFinite(V)) return 0;
  return Math.max(0, Math.min(1, V));
}

function EvaluarMagnitudGoertzel(
  Muestras: Float32Array,
  Inicio: number,
  Tamano: number,
  Ventana: Float32Array,
  SumaVentana: number,
  FrecuenciaHz: number,
  SampleRate: number
): number {
  const Omega = (2 * Math.PI * FrecuenciaHz) / SampleRate;
  const Coef = 2 * Math.cos(Omega);
  let Q1 = 0;
  let Q2 = 0;
  const Total = Muestras.length;

  for (let i = 0; i < Tamano; i++) {
    const Indice = Inicio + i;
    const Muestra = Indice < Total ? Muestras[Indice] * Ventana[i] : 0;
    const Q0 = Muestra + Coef * Q1 - Q2;
    Q2 = Q1;
    Q1 = Q0;
  }

  const Potencia = Math.max(0, Q1 * Q1 + Q2 * Q2 - Q1 * Q2 * Coef);
  return SumaVentana > 0 ? (2 * Math.sqrt(Potencia)) / SumaVentana : 0;
}

function MezclarMonofono(Audio: AudioBufferComparable): Float32Array {
  const Canales = Math.max(1, Audio.numberOfChannels ?? 1);
  const Canal0 = Audio.getChannelData(0);
  if (Canales === 1) return Canal0;

  const Largo = Canal0.length;
  const Mezcla = new Float32Array(Largo);
  const InvCanales = 1 / Canales;
  for (let c = 0; c < Canales; c++) {
    const Datos = Audio.getChannelData(c);
    for (let i = 0; i < Largo; i++) {
      Mezcla[i] += Datos[i] * InvCanales;
    }
  }
  return Mezcla;
}

function SimplificarClavesVocal(
  Muestras: Array<{ Tiempo: number; Valor: number }>,
  UmbralCambio: number
): ClaveVocalLipSync[] {
  if (Muestras.length === 0) return [];
  const Redondear = (V: number) => Math.round(Acotar01(V) * 1000) / 1000;
  const Resultado: ClaveVocalLipSync[] = [];
  let UltimoEmitido = -1;

  for (let i = 0; i < Muestras.length; i++) {
    const Actual = Redondear(Muestras[i].Valor);
    const Anterior = i > 0 ? Redondear(Muestras[i - 1].Valor) : 0;
    const Siguiente = i < Muestras.length - 1 ? Redondear(Muestras[i + 1].Valor) : 0;

    const EsInicioOFin = i === 0 || i === Muestras.length - 1;
    const EsPicoLocal = Actual > Anterior && Actual >= Siguiente && Actual > 0.04;
    const EsCierreVocal = Actual === 0 && UltimoEmitido > 0;
    const EsAperturaVocal = Actual > 0.04 && UltimoEmitido === 0;
    const CambioSignificativo = UltimoEmitido < 0 || Math.abs(Actual - UltimoEmitido) >= UmbralCambio;

    if (EsInicioOFin || EsPicoLocal || EsCierreVocal || EsAperturaVocal || CambioSignificativo) {
      // Insertar ancla en cero justo antes de abrir boca para evitar rampas largas en silencios
      if (EsAperturaVocal && Resultado.length > 0 && Resultado[Resultado.length - 1].Valor === 0) {
        const TiempoPrevio = Muestras[i - 1]?.Tiempo;
        if (TiempoPrevio !== undefined && TiempoPrevio > Resultado[Resultado.length - 1].Tiempo + 0.005) {
          Resultado.push({ Tiempo: Math.round(TiempoPrevio * 1000) / 1000, Valor: 0 });
        }
      }
      Resultado.push({
        Tiempo: Math.round(Muestras[i].Tiempo * 1000) / 1000,
        Valor: Actual,
      });
      UltimoEmitido = Actual;
    }
  }

  return Resultado;
}

/**
 * Analiza una pista de audio mediante bancos de filtros Goertzel sobre bandas
 * formánticas F1/F2 y devuelve envolventes suavizadas y keyframes optimizados por vocal.
 */
export function AnalizarLipSyncDesdeAudio(
  Audio: AudioBufferComparable,
  Opciones: OpcionesLipSync = {}
): ResultadoLipSync {
  const Fps = Math.max(8, Math.min(60, Math.round(Opciones.Fps ?? 24)));
  const UmbralSilencio = Math.max(0.0005, Opciones.UmbralSilencio ?? 0.012);
  const Sensibilidad = Math.max(0.2, Math.min(5, Opciones.Sensibilidad ?? 1.6));
  const Suavizado = Math.max(0, Math.min(0.92, Opciones.Suavizado ?? 0.42));
  const UmbralSimplificacion = Math.max(0.01, Math.min(0.3, Opciones.UmbralSimplificacion ?? 0.06));
  const Desplazamiento = Opciones.Desplazamiento ?? 0;

  const SampleRate = Math.max(8000, Audio.sampleRate || 44100);
  const PCM = MezclarMonofono(Audio);
  const DuracionTotal = Audio.duration > 0 ? Audio.duration : PCM.length / SampleRate;
  const Duracion =
    Opciones.DuracionMaxima && Opciones.DuracionMaxima > 0
      ? Math.min(DuracionTotal, Opciones.DuracionMaxima)
      : DuracionTotal;

  if (PCM.length === 0 || Duracion <= 0) {
    return {
      Fps,
      Duracion: 0,
      Picos: 0,
      Fotogramas: [],
      ClavesPorVocal: { aa: [], ih: [], ou: [], ee: [], oh: [] },
    };
  }

  // Precomputar ventana Hann
  const Ventana = new Float32Array(TAMANO_VENTANA);
  let SumaVentana = 0;
  for (let i = 0; i < TAMANO_VENTANA; i++) {
    const W = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (TAMANO_VENTANA - 1)));
    Ventana[i] = W;
    SumaVentana += W;
  }

  const PasoMuestras = Math.max(1, Math.round(SampleRate / Fps));
  const PasoTiempo = 1 / Fps;
  const MaxMuestras = Math.min(PCM.length, Math.ceil(Duracion * SampleRate));

  const EnergiasRms: number[] = [];
  const BandasPorCuadro: number[][] = [];
  let RmsMaximo = UmbralSilencio * 4;

  for (let Inicio = 0; Inicio < MaxMuestras; Inicio += PasoMuestras) {
    let SumaCuadrados = 0;
    const Limite = Math.min(TAMANO_VENTANA, MaxMuestras - Inicio);
    for (let i = 0; i < Limite; i++) {
      const M = PCM[Inicio + i];
      SumaCuadrados += M * M;
    }
    const Rms = Limite > 0 ? Math.sqrt(SumaCuadrados / Limite) : 0;
    EnergiasRms.push(Rms);
    if (Rms > RmsMaximo) RmsMaximo = Rms;

    if (Rms < UmbralSilencio) {
      BandasPorCuadro.push([0, 0, 0, 0, 0, 0, 0]);
      continue;
    }

    const Magnitudes = FRECUENCIAS_FORMANTES.map((Freq) =>
      EvaluarMagnitudGoertzel(PCM, Inicio, TAMANO_VENTANA, Ventana, SumaVentana, Freq, SampleRate)
    );
    BandasPorCuadro.push(Magnitudes);
  }

  const EstadoSuavizado: Record<VocalVrm, number> = {
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
  };

  const Fotogramas: FotogramaLipSync[] = [];
  const SeriesBrutas: Record<VocalVrm, Array<{ Tiempo: number; Valor: number }>> = {
    aa: [],
    ih: [],
    ou: [],
    ee: [],
    oh: [],
  };

  let Picos = 0;
  const RangoDinamico = Math.max(1e-5, RmsMaximo - UmbralSilencio);

  for (let idx = 0; idx < EnergiasRms.length; idx++) {
    const Tiempo = Math.max(0, idx * PasoTiempo + Desplazamiento);
    const Rms = EnergiasRms[idx];
    const EsSilencio = Rms < UmbralSilencio;

    const Puntajes: Record<VocalVrm, number> = {
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0,
    };

    let EnergiaNorm = 0;

    if (!EsSilencio) {
      EnergiaNorm = Acotar01(((Rms - UmbralSilencio) / RangoDinamico) * Sensibilidad);
      const M = BandasPorCuadro[idx];
      const Suma = M[0] + M[1] + M[2] + M[3] + M[4] + M[5] + M[6];

      if (Suma > 1e-8) {
        const N300 = M[0] / Suma;
        const N500 = M[1] / Suma;
        const N750 = M[2] / Suma;
        const N1100 = M[3] / Suma;
        const N1600 = M[4] / Suma;
        const N2200 = M[5] / Suma;
        const N2800 = M[6] / Suma;
        const Altos = Math.min(1, N2200 + N2800);

        // Perfiles formánticos F1/F2 normalizados
        const CrudoAa = (N750 * 0.55 + N1100 * 0.45) * (1 - Math.min(0.65, N300 * 0.8 + N2800 * 0.8)) * 1.9;
        const CrudoIh = (Math.min(N300, Altos) * 1.5 + N300 * 0.4 + (N2200 * 0.35 + N2800 * 0.65) * 0.55);
        const CrudoOu = (N300 * 0.55 + N500 * 0.45) * Math.max(0, 1 - Altos * 1.35 - N1100 * 0.8) * 1.65;
        const CrudoEe = (N500 * 0.38 + (N1600 + N2200) * 0.62) * (0.55 + 1.1 * Math.min(N500, N1600 + N2200));
        const CrudoOh = (N500 * 0.45 + N750 * 0.4 + N1100 * 0.15) * Math.max(0, 1 - Altos * 1.3 - N300 * 0.4) * 1.55;

        const Crudos: Record<VocalVrm, number> = {
          aa: Math.max(0, CrudoAa),
          ih: Math.max(0, CrudoIh),
          ou: Math.max(0, CrudoOu),
          ee: Math.max(0, CrudoEe),
          oh: Math.max(0, CrudoOh),
        };

        // Enfatizar vocal dominante conservando co-articulación suave
        let MaxCrudo = 0;
        for (const V of VOCALES_LIPSYNC) {
          if (Crudos[V] > MaxCrudo) MaxCrudo = Crudos[V];
        }

        const Apertura = 0.35 + 0.65 * Math.pow(EnergiaNorm, 0.72);
        if (MaxCrudo > 1e-6) {
          for (const V of VOCALES_LIPSYNC) {
            const Relativo = Crudos[V] / MaxCrudo;
            const Enfocado = Math.pow(Relativo, 1.35);
            Puntajes[V] = Acotar01(Enfocado * Apertura);
          }
        }
        if (EnergiaNorm > 0.25) Picos++;
      }
    }

    const VocalesFinales: Record<VocalVrm, number> = {
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0,
    };

    for (const V of VOCALES_LIPSYNC) {
      const Suave = EstadoSuavizado[V] * Suavizado + Puntajes[V] * (1 - Suavizado);
      const Valor = EsSilencio && Suave < 0.02 ? 0 : Acotar01(Suave);
      EstadoSuavizado[V] = Valor;
      VocalesFinales[V] = Valor;
      SeriesBrutas[V].push({ Tiempo, Valor });
    }

    Fotogramas.push({
      Tiempo,
      Energia: EnergiaNorm,
      Vocales: VocalesFinales,
    });
  }

  const ClavesPorVocal: Record<VocalVrm, ClaveVocalLipSync[]> = {
    aa: SimplificarClavesVocal(SeriesBrutas.aa, UmbralSimplificacion),
    ih: SimplificarClavesVocal(SeriesBrutas.ih, UmbralSimplificacion),
    ou: SimplificarClavesVocal(SeriesBrutas.ou, UmbralSimplificacion),
    ee: SimplificarClavesVocal(SeriesBrutas.ee, UmbralSimplificacion),
    oh: SimplificarClavesVocal(SeriesBrutas.oh, UmbralSimplificacion),
  };

  return {
    Fps,
    Duracion,
    Picos,
    Fotogramas,
    ClavesPorVocal,
  };
}

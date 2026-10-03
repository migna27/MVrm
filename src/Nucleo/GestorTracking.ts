// ============================================================================
// GestorTracking.ts — Etapa 3: Seguimiento de movimiento a partir de video
// Analiza un video cuadro a cuadro con MediaPipe (cuerpo y rostro por
// separado), retarea el resultado al esqueleto VRM y genera pistas de
// claves totalmente editables en la línea de tiempo.
// ============================================================================

import * as THREE from 'three';
import { FilesetResolver, PoseLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';
import { OpcionesSeguimiento, PistaAnimacion } from '../Tipos';
import { GenerarId } from '../Utilidades';
import { GestorModelos, NOMBRES_HUESOS_LEGIBLES } from './GestorModelos';

// Recursos de MediaPipe servidos desde CDN (se descargan una sola vez)
const URL_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const URL_MODELO_POSE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const URL_MODELO_ROSTRO = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Relación hueso→hijo y puntos de referencia del cuerpo para el retejido. */
interface EntradaRetejido {
  Hueso: string;          // Hueso humanoide VRM a rotar
  Hijo: string;           // Hueso hijo usado para medir la dirección actual
  HijosAlternos?: string[]; // Alternativas si el hijo no existe en el modelo
  A: number | 'CaderaMedia';
  B: number | 'HombroMedio';
  Peso: number;           // 0..1, cuánto de la rotación calculada se aplica
}

const TABLA_RETEJIDO: EntradaRetejido[] = [
  { Hueso: 'spine',         Hijo: 'chest',        A: 'CaderaMedia', B: 'HombroMedio', Peso: 0.7 },
  { Hueso: 'chest',         Hijo: 'neck',         HijosAlternos: ['upperChest', 'head'], A: 'CaderaMedia', B: 'HombroMedio', Peso: 0.35 },
  { Hueso: 'leftUpperArm',  Hijo: 'leftLowerArm',  A: 11, B: 13, Peso: 1 },
  { Hueso: 'leftLowerArm',  Hijo: 'leftHand',      A: 13, B: 15, Peso: 1 },
  { Hueso: 'rightUpperArm', Hijo: 'rightLowerArm', A: 12, B: 14, Peso: 1 },
  { Hueso: 'rightLowerArm', Hijo: 'rightHand',     A: 14, B: 16, Peso: 1 },
  { Hueso: 'leftUpperLeg',  Hijo: 'leftLowerLeg',  A: 23, B: 25, Peso: 1 },
  { Hueso: 'leftLowerLeg',  Hijo: 'leftFoot',      A: 25, B: 27, Peso: 1 },
  { Hueso: 'rightUpperLeg', Hijo: 'rightLowerLeg', A: 24, B: 26, Peso: 1 },
  { Hueso: 'rightLowerLeg', Hijo: 'rightFoot',     A: 26, B: 28, Peso: 1 }
];

/** Mapeo de blendshapes de MediaPipe a expresiones VRM: [categoría, expresión, ganancia]. */
const MAPA_ROSTRO: [string, string, number][] = [
  ['eyeBlinkLeft', 'blinkLeft', 1.0],
  ['eyeBlinkRight', 'blinkRight', 1.0],
  ['jawOpen', 'aa', 1.25],
  ['mouthSmileLeft', 'happy', 1.0],
  ['mouthSmileRight', 'happy', 1.0],
  ['mouthFrownLeft', 'sad', 1.3],
  ['mouthFrownRight', 'sad', 1.3],
  ['browDownLeft', 'angry', 1.3],
  ['browDownRight', 'angry', 1.3],
  ['browInnerUp', 'surprised', 0.9],
  ['eyeWideLeft', 'surprised', 0.8],
  ['eyeWideRight', 'surprised', 0.8],
  ['mouthPucker', 'ou', 1.0],
  ['mouthFunnel', 'ou', 1.0],
  ['mouthStretchLeft', 'ih', 0.8],
  ['mouthStretchRight', 'ih', 0.8]
];

interface MuestraCuerpo { Tiempo: number; Puntos: { x: number; y: number; z: number }[] | null; }
interface MuestraRostro { Tiempo: number; Puntajes: Map<string, number> | null; Matriz: number[] | null; }

export class GestorTracking {
  private DetectorPose: PoseLandmarker | null = null;
  private DetectorRostro: FaceLandmarker | null = null;
  public Procesando = false;
  private BaseTimestampMs = 0;

  /** Descarga e inicializa los modelos de MediaPipe (solo la primera vez). */
  public async Inicializar(Opciones: OpcionesSeguimiento, AlEstado: (M: string) => void): Promise<void> {
    const Conjunto = await FilesetResolver.forVisionTasks(URL_WASM);
    if (Opciones.Cuerpo && !this.DetectorPose) {
      AlEstado('Descargando modelo de pose corporal…');
      this.DetectorPose = await PoseLandmarker.createFromOptions(Conjunto, {
        baseOptions: { modelAssetPath: URL_MODELO_POSE },
        runningMode: 'VIDEO',
        numPoses: 1
      });
    }
    if (Opciones.Rostro && !this.DetectorRostro) {
      AlEstado('Descargando modelo de rostro…');
      this.DetectorRostro = await FaceLandmarker.createFromOptions(Conjunto, {
        baseOptions: { modelAssetPath: URL_MODELO_ROSTRO },
        runningMode: 'VIDEO',
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        numFaces: 1
      });
    }
  }

  /**
   * Procesa un video completo y devuelve las pistas de claves generadas.
   * Cuerpo y rostro se analizan como conjuntos de pistas independientes.
   */
  public async ProcesarVideo(
    Archivo: File,
    Opciones: OpcionesSeguimiento,
    Modelos: GestorModelos,
    AlProgreso: (Fraccion: number, Mensaje: string) => void
  ): Promise<PistaAnimacion[]> {
    if (!Modelos.Vrm) throw new Error('Carga primero un modelo VRM.');
    if (this.Procesando) throw new Error('Ya hay un seguimiento en curso.');
    this.Procesando = true;

    try {
      await this.Inicializar(Opciones, (M) => AlProgreso(0, M));

      // Video oculto usado como fuente de cuadros
      const Url = URL.createObjectURL(Archivo);
      const Video = document.createElement('video');
      Video.src = Url;
      Video.muted = true;
      Video.playsInline = true;
      
      // CRÍTICO: Añadir al DOM para que el navegador dispare requestVideoFrameCallback y decodifique
      Video.style.position = 'absolute';
      Video.style.opacity = '0';
      Video.style.pointerEvents = 'none';
      Video.style.width = '10px';
      Video.style.height = '10px';
      document.body.appendChild(Video);

      await new Promise<void>((Resolver, Rechazar) => {
        Video.onloadedmetadata = () => Resolver();
        Video.onerror = () => Rechazar(new Error('No se pudo leer el video.'));
      });

      // Usar un Canvas asegura que el navegador rasterice los píxeles frescos del video
      const Canvas = document.createElement('canvas');
      Canvas.width = Video.videoWidth || 640;
      Canvas.height = Video.videoHeight || 480;
      const CtxCanvas = Canvas.getContext('2d', { willReadFrequently: true })!;

      const Duracion = Video.duration;
      const Fps = Opciones.FpsMuestreo;
      const Total = Math.max(1, Math.floor(Duracion * Fps));
      const MuestrasCuerpo: MuestraCuerpo[] = [];
      const MuestrasRostro: MuestraRostro[] = [];

      // Marca temporal estrictamente creciente para MediaPipe (ms) a través de varios videos
      let MarcaMsAnterior = this.BaseTimestampMs;

      for (let I = 0; I < Total; I++) {
        const T = Math.min(I / Fps, Duracion - 0.001);
        await this.IrATiempo(Video, T);

        // Forzar dibujo en canvas para obtener el frame visual actual
        CtxCanvas.drawImage(Video, 0, 0, Canvas.width, Canvas.height);

        // MediaPipe requiere marcas estrictamente crecientes; garantizar ≥ 1 ms de avance
        const MarcaMs = Math.max(MarcaMsAnterior + 1, this.BaseTimestampMs + Math.round(T * 1000));
        MarcaMsAnterior = MarcaMs;

        if (Opciones.Cuerpo && this.DetectorPose) {
          const R = this.DetectorPose.detectForVideo(Canvas, MarcaMs);
          const Puntos = (R.worldLandmarks && R.worldLandmarks[0]) || (R.landmarks && R.landmarks[0]) || null;
          MuestrasCuerpo.push({ Tiempo: I / Fps, Puntos: Puntos as any });
        }
        if (Opciones.Rostro && this.DetectorRostro) {
          const R = this.DetectorRostro.detectForVideo(Canvas, MarcaMs);
          const Puntajes = new Map<string, number>();
          if (R.faceBlendshapes && R.faceBlendshapes[0]) {
            for (const Categoria of R.faceBlendshapes[0].categories) {
              Puntajes.set(Categoria.categoryName, Categoria.score);
            }
          }
          const Matriz = R.facialTransformationMatrixes && R.facialTransformationMatrixes[0]
            ? [...R.facialTransformationMatrixes[0].data]
            : null;
          MuestrasRostro.push({ Tiempo: I / Fps, Puntajes, Matriz });
        }
        AlProgreso(I / Total, `Analizando cuadro ${I + 1} de ${Total}…`);
      }
      URL.revokeObjectURL(Url);

      // Avanzar el contador base de tiempo para el próximo video (con un margen extra de 1s)
      this.BaseTimestampMs = MarcaMsAnterior + 1000;

      // Construir las pistas editables a partir de las muestras
      const Pistas: PistaAnimacion[] = [];
      if (Opciones.Cuerpo) Pistas.push(...this.ConstruirPistasCuerpo(MuestrasCuerpo, Opciones, Modelos));
      if (Opciones.Rostro) Pistas.push(...this.ConstruirPistasRostro(MuestrasRostro, Opciones, Modelos));
      return Pistas;
    } finally {
      this.Procesando = false;
      // Limpiar video del DOM
      const VideosOcultos = document.querySelectorAll('video[style*="opacity: 0"]');
      VideosOcultos.forEach(V => V.remove());
    }
  }

  /**
   * Coloca el cabezal del video en un tiempo exacto y espera el cuadro.
   * Si el video ya está en el tiempo solicitado (±tolerancia), se resuelve
   * inmediatamente para evitar que el evento 'seeked' nunca se dispare.
   */
  private IrATiempo(Video: HTMLVideoElement, Tiempo: number): Promise<void> {
    return new Promise((Resolver) => {
      // Si ya estamos suficientemente cerca del tiempo pedido, no buscar
      if (Math.abs(Video.currentTime - Tiempo) < 0.01) {
        Resolver();
        return;
      }
      // Timeout de seguridad por si 'seeked' no se dispara
      let Resuelto = false;
      const Temporizador = setTimeout(() => {
        if (!Resuelto) { Resuelto = true; Resolver(); }
      }, 2000);
      
      const AlBuscar = () => {
        Video.removeEventListener('seeked', AlBuscar);
        if (Resuelto) return;
        
        // Esperar a que el motor de video realmente decodifique el frame visual
        if ('requestVideoFrameCallback' in Video) {
          (Video as any).requestVideoFrameCallback(() => {
            if (!Resuelto) { Resuelto = true; clearTimeout(Temporizador); Resolver(); }
          });
        } else {
          // Fallback para navegadores antiguos
          setTimeout(() => {
            if (!Resuelto) { Resuelto = true; clearTimeout(Temporizador); Resolver(); }
          }, 20);
        }
      };
      
      Video.addEventListener('seeked', AlBuscar);
      Video.currentTime = Tiempo;
    });
  }

  // --------------------------------------------------------------------------
  // Cuerpo: retejido de la pose 3D de MediaPipe al esqueleto VRM
  // --------------------------------------------------------------------------

  private ConstruirPistasCuerpo(
    Muestras: MuestraCuerpo[],
    Opciones: OpcionesSeguimiento,
    Modelos: GestorModelos
  ): PistaAnimacion[] {
    const Espejo = Opciones.Espejo ? -1 : 1;
    const Suavizado = Math.min(0.92, Math.max(0, Opciones.Suavizado));

    // Pose de reposo como punto de partida de cada muestra
    Modelos.RestablecerPose();
    Modelos.Vrm!.scene.updateMatrixWorld(true);

    // Escala persona→modelo según el ancho de hombros de ambos
    const BrazoIzq = Modelos.ObtenerNodoHueso('leftUpperArm');
    const BrazoDer = Modelos.ObtenerNodoHueso('rightUpperArm');
    let AnchoModelo = 0.35;
    if (BrazoIzq && BrazoDer) {
      AnchoModelo = new THREE.Vector3().setFromMatrixPosition(BrazoIzq.matrixWorld)
        .distanceTo(new THREE.Vector3().setFromMatrixPosition(BrazoDer.matrixWorld));
    }

    const Primera = Muestras.find((M) => M.Puntos && M.Puntos.length > 28);
    if (!Primera) return [];

    const Convertir = (P: { x: number; y: number; z: number }) =>
      new THREE.Vector3(P.x * Espejo, -P.y, P.z);

    const AnchoPersona = Convertir(Primera.Puntos![11]).distanceTo(Convertir(Primera.Puntos![12]));
    const FactorEscala = AnchoPersona > 1e-4 ? AnchoModelo / AnchoPersona : 1;
    const CaderaReferencia = Convertir(Primera.Puntos![23]).add(Convertir(Primera.Puntos![24])).multiplyScalar(0.5);

    const ReposoCadera = Modelos.PoseReposo.get('hips');
    const PosicionReposoCadera = ReposoCadera ? ReposoCadera.Posicion.clone() : new THREE.Vector3();

    // Series por hueso con suavizado exponencial entre muestras
    const Series = new Map<string, { Tiempo: number; Euler: THREE.Euler }[]>();
    const SeriePosicionCadera: { Tiempo: number; Posicion: THREE.Vector3 }[] = [];
    const CuaternionPrevio = new Map<string, THREE.Quaternion>();
    const PosicionPrevia = { Valor: PosicionReposoCadera.clone() };

    const DirActual = new THREE.Vector3();
    const DirObjetivo = new THREE.Vector3();
    const Delta = new THREE.Quaternion();
    const RotacionOriginal = new THREE.Quaternion();
    const NuevaLocal = new THREE.Quaternion();

    for (const Muestra of Muestras) {
      // Restablecer los huesos rastreados a su reposo antes de retear
      for (const Entrada of TABLA_RETEJIDO) {
        const Reposo = Modelos.PoseReposo.get(Entrada.Hueso);
        const Nodo = Modelos.ObtenerNodoHueso(Entrada.Hueso);
        if (Reposo && Nodo) Nodo.quaternion.copy(Reposo.Rotacion);
      }

      if (Muestra.Puntos && Muestra.Puntos.length > 28) {
        const Puntos = Muestra.Puntos.map(Convertir);
        const CaderaMedia = Puntos[23].clone().add(Puntos[24]).multiplyScalar(0.5);
        const HombroMedio = Puntos[11].clone().add(Puntos[12]).multiplyScalar(0.5);

        const PuntoDe = (Ref: number | 'CaderaMedia' | 'HombroMedio'): THREE.Vector3 =>
          Ref === 'CaderaMedia' ? CaderaMedia : Ref === 'HombroMedio' ? HombroMedio : Puntos[Ref];

        for (const Entrada of TABLA_RETEJIDO) {
          const Nodo = Modelos.ObtenerNodoHueso(Entrada.Hueso);
          if (!Nodo) continue;
          const NombreHijo = [Entrada.Hijo, ...(Entrada.HijosAlternos ?? [])]
            .find((N) => Modelos.ObtenerNodoHueso(N) !== null);
          const Hijo = NombreHijo ? Modelos.ObtenerNodoHueso(NombreHijo) : null;
          if (!Hijo) continue;

          // Forzar propagación de matrices desde la raíz para tener datos frescos
          // tras las modificaciones de cuaterniones de huesos anteriores en esta iteración
          Modelos.Vrm!.scene.updateMatrixWorld(true);

          // Dirección actual del hueso en el mundo
          DirActual.setFromMatrixPosition(Hijo.matrixWorld)
            .sub(new THREE.Vector3().setFromMatrixPosition(Nodo.matrixWorld));
          if (DirActual.lengthSq() < 1e-8) continue;
          DirActual.normalize();

          // Dirección objetivo a partir de los puntos del cuerpo
          DirObjetivo.copy(PuntoDe(Entrada.B)).sub(PuntoDe(Entrada.A));
          if (DirObjetivo.lengthSq() < 1e-8) continue;
          DirObjetivo.normalize();

          // Rotación delta que alinea la dirección actual con la objetivo
          Delta.setFromUnitVectors(DirActual, DirObjetivo);

          // Aplicar peso: interpolar el delta hacia identidad (sin corrección)
          if (Entrada.Peso < 1) {
            const Identidad = new THREE.Quaternion();
            Delta.slerpQuaternions(Identidad, Delta, Entrada.Peso);
          }

          // Obtener la rotación mundial actual del nodo y aplicarle el delta
          Nodo.getWorldQuaternion(RotacionOriginal);
          const MundialObjetivo = Delta.clone().multiply(RotacionOriginal);

          // Convertir a espacio local del padre
          const MundialPadre = new THREE.Quaternion();
          Nodo.parent!.getWorldQuaternion(MundialPadre).invert();
          NuevaLocal.copy(MundialPadre).multiply(MundialObjetivo);

          // Suavizado exponencial entre muestras consecutivas
          const Previo = CuaternionPrevio.get(Entrada.Hueso);
          if (Previo) NuevaLocal.slerpQuaternions(Previo, NuevaLocal, 1 - Suavizado);
          CuaternionPrevio.set(Entrada.Hueso, NuevaLocal.clone());
          Nodo.quaternion.copy(NuevaLocal);
        }

        // Posición de la cadera con la escala persona→modelo
        const Desplazamiento = CaderaMedia.clone().sub(CaderaReferencia).multiplyScalar(FactorEscala);
        const PosicionObjetivo = PosicionReposoCadera.clone().add(Desplazamiento);
        PosicionObjetivo.lerpVectors(PosicionPrevia.Valor, PosicionObjetivo, 1 - Suavizado);
        PosicionPrevia.Valor.copy(PosicionObjetivo);
        const NodoCadera = Modelos.ObtenerNodoHueso('hips');
        if (NodoCadera) NodoCadera.position.copy(PosicionObjetivo);
        SeriePosicionCadera.push({ Tiempo: Muestra.Tiempo, Posicion: PosicionObjetivo.clone() });
      }

      // Registrar la pose resultante de la muestra
      for (const Entrada of TABLA_RETEJIDO) {
        const Nodo = Modelos.ObtenerNodoHueso(Entrada.Hueso);
        if (!Nodo) continue;
        if (!Series.has(Entrada.Hueso)) Series.set(Entrada.Hueso, []);
        Series.get(Entrada.Hueso)!.push({
          Tiempo: Muestra.Tiempo,
          Euler: new THREE.Euler().setFromQuaternion(Nodo.quaternion, 'XYZ')
        });
      }
    }

    Modelos.RestablecerPose();

    // Generar pistas solo para huesos con movimiento real
    const Pistas: PistaAnimacion[] = [];
    for (const [Hueso, Serie] of Series) {
      if (Serie.length < 2) continue;
      const Reposo = Modelos.PoseReposo.get(Hueso);
      const EulerReposo = Reposo ? new THREE.Euler().setFromQuaternion(Reposo.Rotacion, 'XYZ') : new THREE.Euler();
      const Cambia = Serie.some((M) =>
        Math.abs(M.Euler.x - EulerReposo.x) > 0.02 ||
        Math.abs(M.Euler.y - EulerReposo.y) > 0.02 ||
        Math.abs(M.Euler.z - EulerReposo.z) > 0.02);
      if (!Cambia) continue;
      Pistas.push({
        Id: GenerarId(),
        Nombre: `Cuerpo · ${NOMBRES_HUESOS_LEGIBLES[Hueso] ?? Hueso}`,
        Tipo: 'HuesoRotacion', Objetivo: Hueso, Grupo: 'SeguimientoCuerpo',
        Claves: this.CompactarSerie(Serie)
      });
    }

    // Pista de posición de la cadera si hubo desplazamiento notable
    if (SeriePosicionCadera.length > 1) {
      const Cambia = SeriePosicionCadera.some((M) => M.Posicion.distanceTo(PosicionReposoCadera) > 0.01);
      if (Cambia) {
        Pistas.push({
          Id: GenerarId(),
          Nombre: 'Cuerpo · Posición cadera',
          Tipo: 'HuesoPosicion', Objetivo: 'hips', Grupo: 'SeguimientoCuerpo',
          Claves: SeriePosicionCadera
            .filter((M, I, A) => I === 0 || I === A.length - 1 || M.Posicion.distanceTo(A[I - 1].Posicion) > 0.004)
            .map((M) => ({ Id: GenerarId(), Tiempo: M.Tiempo, Valor: [M.Posicion.x, M.Posicion.y, M.Posicion.z] }))
        });
      }
    }
    return Pistas;
  }

  /** Reduce la cantidad de claves conservando solo cambios angulares notables. */
  private CompactarSerie(Serie: { Tiempo: number; Euler: THREE.Euler }[]): { Id: string; Tiempo: number; Valor: number[] }[] {
    const Claves: { Id: string; Tiempo: number; Valor: number[] }[] = [];
    let Ultimo: THREE.Euler | null = null;
    for (let I = 0; I < Serie.length; I++) {
      const M = Serie[I];
      const Cambio = !Ultimo ||
        Math.abs(M.Euler.x - Ultimo.x) > 0.015 ||
        Math.abs(M.Euler.y - Ultimo.y) > 0.015 ||
        Math.abs(M.Euler.z - Ultimo.z) > 0.015;
      if (Cambio || I === Serie.length - 1 || I % 10 === 0) {
        Claves.push({ Id: GenerarId(), Tiempo: M.Tiempo, Valor: [M.Euler.x, M.Euler.y, M.Euler.z] });
        Ultimo = M.Euler.clone();
      }
    }
    return Claves;
  }

  // --------------------------------------------------------------------------
  // Rostro: blendshapes y rotación de cabeza a partir de la matriz facial
  // --------------------------------------------------------------------------

  private ConstruirPistasRostro(
    Muestras: MuestraRostro[],
    Opciones: OpcionesSeguimiento,
    Modelos: GestorModelos
  ): PistaAnimacion[] {
    const Suavizado = Math.min(0.92, Math.max(0, Opciones.Suavizado));
    const ExpresionesModelo = new Set(Modelos.ObtenerExpresiones());
    const SeriesExpresiones = new Map<string, { Tiempo: number; Valor: number }[]>();
    const SeriesCabeza: { Tiempo: number; Euler: THREE.Euler }[] = [];
    const ValorPrevio = new Map<string, number>();
    const CabezaPrevia = { Valor: new THREE.Quaternion() };
    let CabezaInicializada = false;

    const Matriz = new THREE.Matrix4();
    const Cuaternion = new THREE.Quaternion();
    const PosicionTmp = new THREE.Vector3();
    const EscalaTmp = new THREE.Vector3();
    const ReposoCabeza = Modelos.PoseReposo.get('head');
    const CuaternionReposoCabeza = ReposoCabeza ? ReposoCabeza.Rotacion : new THREE.Quaternion();

    for (const Muestra of Muestras) {
      // Blendshapes → expresiones VRM (se toma el máximo por expresión)
      if (Muestra.Puntajes && Muestra.Puntajes.size > 0) {
        const Combinado = new Map<string, number>();
        for (const [Categoria, Expresion, Ganancia] of MAPA_ROSTRO) {
          const Puntaje = Muestra.Puntajes.get(Categoria) ?? 0;
          const Valor = Math.min(1, Puntaje * Ganancia);
          Combinado.set(Expresion, Math.max(Combinado.get(Expresion) ?? 0, Valor));
        }
        // Parpadeos individuales se combinan si el modelo solo tiene "blink"
        if (!ExpresionesModelo.has('blinkLeft') && ExpresionesModelo.has('blink')) {
          const Ambos = Math.max(Combinado.get('blinkLeft') ?? 0, Combinado.get('blinkRight') ?? 0);
          Combinado.delete('blinkLeft');
          Combinado.delete('blinkRight');
          Combinado.set('blink', Ambos);
        }
        for (const [Expresion, Valor] of Combinado) {
          if (!ExpresionesModelo.has(Expresion)) continue;
          const Previo = ValorPrevio.get(Expresion) ?? 0;
          const SuavizadoValor = Previo * Suavizado + Valor * (1 - Suavizado);
          ValorPrevio.set(Expresion, SuavizadoValor);
          if (!SeriesExpresiones.has(Expresion)) SeriesExpresiones.set(Expresion, []);
          SeriesExpresiones.get(Expresion)!.push({ Tiempo: Muestra.Tiempo, Valor: SuavizadoValor });
        }
      }

      // Matriz de transformación facial → rotación de la cabeza
      if (Muestra.Matriz && Modelos.ObtenerNodoHueso('head')) {
        Matriz.fromArray(Muestra.Matriz);
        Matriz.decompose(PosicionTmp, Cuaternion, EscalaTmp);
        const Euler = new THREE.Euler().setFromQuaternion(Cuaternion, 'YXZ');
        const Factor = 0.7;
        const EulerCabeza = new THREE.Euler(
          -Euler.x * Factor,
          (Opciones.Espejo ? Euler.y : -Euler.y) * Factor,
          (Opciones.Espejo ? -Euler.z : Euler.z) * Factor,
          'YXZ'
        );
        Cuaternion.setFromEuler(EulerCabeza).premultiply(CuaternionReposoCabeza);
        if (!CabezaInicializada) { CabezaPrevia.Valor.copy(Cuaternion); CabezaInicializada = true; }
        Cuaternion.slerpQuaternions(CabezaPrevia.Valor, Cuaternion, 1 - Suavizado);
        CabezaPrevia.Valor.copy(Cuaternion);
        SeriesCabeza.push({
          Tiempo: Muestra.Tiempo,
          Euler: new THREE.Euler().setFromQuaternion(Cuaternion, 'XYZ')
        });
      }
    }

    // Construir pistas de expresión con variación real
    const Pistas: PistaAnimacion[] = [];
    for (const [Expresion, Serie] of SeriesExpresiones) {
      const Cambia = Serie.some((M) => Math.abs(M.Valor) > 0.04);
      if (!Cambia) continue;
      Pistas.push({
        Id: GenerarId(),
        Nombre: `Rostro · ${Expresion}`,
        Tipo: 'Expresion', Objetivo: Expresion, Grupo: 'SeguimientoRostro',
        Claves: Serie
          .filter((M, I, A) => I === 0 || I === A.length - 1 || Math.abs(M.Valor - A[I - 1].Valor) > 0.02 || I % 10 === 0)
          .map((M) => ({ Id: GenerarId(), Tiempo: M.Tiempo, Valor: [M.Valor] }))
      });
    }

    // Pista de rotación de cabeza si hubo movimiento
    if (SeriesCabeza.length > 1) {
      const EulerReposo = ReposoCabeza ? new THREE.Euler().setFromQuaternion(ReposoCabeza.Rotacion, 'XYZ') : new THREE.Euler();
      const Cambia = SeriesCabeza.some((M) =>
        Math.abs(M.Euler.x - EulerReposo.x) > 0.02 ||
        Math.abs(M.Euler.y - EulerReposo.y) > 0.02 ||
        Math.abs(M.Euler.z - EulerReposo.z) > 0.02);
      if (Cambia) {
        Pistas.push({
          Id: GenerarId(),
          Nombre: 'Rostro · Cabeza',
          Tipo: 'HuesoRotacion', Objetivo: 'head', Grupo: 'SeguimientoRostro',
          Claves: this.CompactarSerie(SeriesCabeza)
        });
      }
    }
    return Pistas;
  }
}

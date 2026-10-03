// ============================================================================
// GestorExportacion.ts — Etapa 5: Render y exportación del resultado final
// Renderiza la animación cuadro a cuadro con paso de tiempo fijo (hasta 4K),
// codifica video H.264 + audio AAC con WebCodecs en un MP4, y ofrece un
// respaldo en WebM mediante MediaRecorder cuando WebCodecs no está disponible.
// ============================================================================

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { OpcionesExportacion } from '../Tipos';
import { ContextoAplicacion } from '../Contexto';
import { DescargarBlob } from '../Utilidades';

export class GestorExportacion {
  public Exportando = false;
  private Cancelado = false;

  /** Solicita la cancelación de la exportación en curso. */
  public CancelarExportacion(): void {
    this.Cancelado = true;
  }

  /** Punto de entrada: elige la vía MP4 (WebCodecs) o WebM (respaldo). */
  public async Exportar(
    Opciones: OpcionesExportacion,
    Contexto: ContextoAplicacion,
    AlProgreso: (Fraccion: number, Mensaje: string) => void
  ): Promise<void> {
    if (this.Exportando) throw new Error('Ya hay una exportación en curso.');
    this.Exportando = true;
    this.Cancelado = false;
    try {
      const WebCodecsDisponible = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
      if (Opciones.Formato === 'mp4' && WebCodecsDisponible) {
        await this.ExportarMp4(Opciones, Contexto, AlProgreso);
      } else {
        await this.ExportarWebm(Opciones, Contexto, AlProgreso);
      }
    } finally {
      this.Exportando = false;
    }
  }

  // --------------------------------------------------------------------------
  // MP4 con WebCodecs: render fuera de línea con paso fijo (calidad máxima)
  // --------------------------------------------------------------------------

  private async ExportarMp4(
    Opciones: OpcionesExportacion,
    Contexto: ContextoAplicacion,
    AlProgreso: (Fraccion: number, Mensaje: string) => void
  ): Promise<void> {
    const { Ancho, Alto, Fps } = Opciones;
    const Duracion = Contexto.Animacion.Duracion;
    const TotalCuadros = Math.max(1, Math.round(Duracion * Fps));
    const TasaBits = Math.min(65_000_000, Math.max(8_000_000, Math.round(Ancho * Alto * Fps * 0.14)));

    // Elegir el primer perfil H.264 soportado que cubra la resolución pedida
    const Perfiles = ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.42E028'];
    let Configuracion: VideoEncoderConfig | null = null;
    for (const Perfil of Perfiles) {
      const Candidata: VideoEncoderConfig = {
        codec: Perfil, width: Ancho, height: Alto,
        bitrate: TasaBits, framerate: Fps, avc: { format: 'avc' }
      } as VideoEncoderConfig;
      const Soporte = await VideoEncoder.isConfigSupported(Candidata);
      if (Soporte.supported) { Configuracion = Candidata; break; }
    }
    if (!Configuracion) throw new Error('El navegador no soporta codificación H.264 a esta resolución.');

    const ConAudio = Opciones.IncluirAudio && Contexto.Audio.Buffer !== null;
    const Multiplexor = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: Ancho, height: Alto, frameRate: Fps },
      ...(ConAudio ? {
        audio: {
          codec: 'aac',
          sampleRate: Contexto.Audio.Buffer!.sampleRate,
          numberOfChannels: Contexto.Audio.Buffer!.numberOfChannels
        }
      } : {}),
      fastStart: 'in-memory'
    });

    const Codificador = new VideoEncoder({
      output: (Fragmento, Metadatos) => Multiplexor.addVideoChunk(Fragmento, Metadatos),
      error: (E) => { throw E; }
    });
    Codificador.configure(Configuracion);

    // Guardar el estado de la previa para restaurarlo al finalizar
    const Escena = Contexto.Escena;
    const TiempoPrevio = Contexto.Animacion.TiempoActual;
    const EstabaReproduciendo = Contexto.Animacion.Reproduciendo;
    Contexto.Animacion.Pausar();
    Escena.EstablecerTamanoExportacion(Ancho, Alto);

    try {
      // Render cuadro a cuadro con paso de tiempo fijo
      const Lienzo = Escena.ObtenerLienzo();
      for (let I = 0; I < TotalCuadros; I++) {
        if (this.Cancelado) throw new Error('Exportación cancelada por el usuario.');
        const T = I / Fps;

        Contexto.Animacion.EstablecerTiempo(T);
        Contexto.Animacion.EvaluarEn(T);
        Contexto.Efectos.Actualizar(1 / Fps);
        Contexto.Modelos.Actualizar(1 / Fps);
        Escena.Renderizar();

        const Cuadro = new VideoFrame(Lienzo, {
          timestamp: Math.round(I * 1_000_000 / Fps),
          duration: Math.round(1_000_000 / Fps)
        });
        Codificador.encode(Cuadro, { keyFrame: I % (Fps * 2) === 0 });
        Cuadro.close();

        if (I % 8 === 0) {
          AlProgreso(I / TotalCuadros, `Renderizando cuadro ${I + 1} de ${TotalCuadros}…`);
          await new Promise((R) => setTimeout(R, 0)); // Ceder el hilo a la interfaz
        }
      }
      await Codificador.flush();

      // Codificar el audio sincronizado con la línea de tiempo
      if (ConAudio) {
        await this.CodificarAudio(Contexto, Multiplexor, Duracion, AlProgreso);
      }

      Multiplexor.finalize();
      const Resultado = new Blob([(Multiplexor.target as ArrayBufferTarget).buffer], { type: 'video/mp4' });
      DescargarBlob(Resultado, `AnimacionVRM_${Ancho}x${Alto}_${Fps}fps.mp4`);
      AlProgreso(1, 'Exportación completada.');
    } finally {
      Codificador.close();
      Escena.Redimensionar();
      Contexto.Animacion.EstablecerTiempo(TiempoPrevio);
      if (EstabaReproduciendo) Contexto.Animacion.Reproducir();
    }
  }

  /** Codifica el búfer de audio (recortado a la duración del video) en AAC. */
  private async CodificarAudio(
    Contexto: ContextoAplicacion,
    Multiplexor: Muxer<ArrayBufferTarget>,
    DuracionVideo: number,
    AlProgreso: (Fraccion: number, Mensaje: string) => void
  ): Promise<void> {
    const Buffer = Contexto.Audio.Buffer!;
    const Frecuencia = Buffer.sampleRate;
    const Canales = Buffer.numberOfChannels;
    const Desplazamiento = Contexto.Audio.Desplazamiento;

    const CodificadorAudio = new AudioEncoder({
      output: (Fragmento, Metadatos) => Multiplexor.addAudioChunk(Fragmento, Metadatos),
      error: () => {}
    });
    CodificadorAudio.configure({
      codec: 'mp4a.40.2',
      sampleRate: Frecuencia,
      numberOfChannels: Canales,
      bitrate: 192_000
    });

    // Silencio inicial si el audio comienza después del segundo cero
    let MarcaTemporal = 0;
    if (Desplazamiento > 0) {
      const MuestrasSilencio = Math.round(Desplazamiento * Frecuencia);
      const Silencio = new Float32Array(MuestrasSilencio * Canales);
      const DatosSilencio = new AudioData({
        format: 'f32-planar', sampleRate: Frecuencia,
        numberOfFrames: MuestrasSilencio, numberOfChannels: Canales,
        timestamp: 0, data: Silencio.buffer
      });
      CodificadorAudio.encode(DatosSilencio);
      DatosSilencio.close();
      MarcaTemporal = MuestrasSilencio;
    }

    // Rango de muestras del búfer que cae dentro del video
    const InicioMuestra = Math.max(0, Math.round(-Desplazamiento * Frecuencia));
    const FinMuestra = Math.min(
      Buffer.length,
      InicioMuestra + Math.round(DuracionVideo * Frecuencia) - (Desplazamiento > 0 ? Math.round(Desplazamiento * Frecuencia) : 0)
    );

    const TamanoBloque = Frecuencia; // Bloques de un segundo
    for (let Base = InicioMuestra; Base < FinMuestra; Base += TamanoBloque) {
      if (this.Cancelado) { CodificadorAudio.close(); return; }
      const Cantidad = Math.min(TamanoBloque, FinMuestra - Base);
      const Datos = new Float32Array(Cantidad * Canales);
      for (let C = 0; C < Canales; C++) {
        Datos.set(Buffer.getChannelData(C).subarray(Base, Base + Cantidad), C * Cantidad);
      }
      const DatosAudio = new AudioData({
        format: 'f32-planar', sampleRate: Frecuencia,
        numberOfFrames: Cantidad, numberOfChannels: Canales,
        timestamp: Math.round((MarcaTemporal + (Base - InicioMuestra)) * 1_000_000 / Frecuencia),
        data: Datos.buffer
      });
      CodificadorAudio.encode(DatosAudio);
      DatosAudio.close();
      AlProgreso(0.95, 'Codificando audio…');
      await new Promise((R) => setTimeout(R, 0));
    }
    await CodificadorAudio.flush();
    CodificadorAudio.close();
  }

  // --------------------------------------------------------------------------
  // Respaldo WebM: grabación en tiempo real con MediaRecorder
  // --------------------------------------------------------------------------

  private async ExportarWebm(
    Opciones: OpcionesExportacion,
    Contexto: ContextoAplicacion,
    AlProgreso: (Fraccion: number, Mensaje: string) => void
  ): Promise<void> {
    const { Ancho, Alto, Fps } = Opciones;
    const Duracion = Contexto.Animacion.Duracion;
    const Escena = Contexto.Escena;

    Escena.EstablecerTamanoExportacion(Ancho, Alto);
    const Flujo = Escena.ObtenerLienzo().captureStream(Fps);

    // Mezclar el audio en el flujo si se pidió
    let ContextoAudio: AudioContext | null = null;
    if (Opciones.IncluirAudio && Contexto.Audio.Buffer) {
      ContextoAudio = new AudioContext();
      const Fuente = ContextoAudio.createBufferSource();
      Fuente.buffer = Contexto.Audio.Buffer;
      const Destino = ContextoAudio.createMediaStreamDestination();
      Fuente.connect(Destino);
      Destino.stream.getAudioTracks().forEach((PistaFlujo) => Flujo.addTrack(PistaFlujo));
      setTimeout(() => Fuente.start(), 100);
    }

    const TipoMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const Grabadora = new MediaRecorder(Flujo, {
      mimeType: TipoMime,
      videoBitsPerSecond: Math.min(45_000_000, Ancho * Alto * Fps * 0.14)
    });
    const Fragmentos: Blob[] = [];
    Grabadora.ondataavailable = (Evento) => { if (Evento.data.size > 0) Fragmentos.push(Evento.data); };

    const Finalizado = new Promise<void>((Resolver) => { Grabadora.onstop = () => Resolver(); });

    Contexto.Animacion.EstablecerTiempo(0);
    Contexto.Animacion.Reproducir();
    Grabadora.start(250);

    // Esperar a que termine la reproducción en tiempo real
    const InicioReloj = performance.now();
    await new Promise<void>((Resolver) => {
      const Vigilar = () => {
        if (this.Cancelado || performance.now() - InicioReloj >= Duracion * 1000 + 150) { Resolver(); return; }
        AlProgreso((performance.now() - InicioReloj) / (Duracion * 1000), 'Grabando en tiempo real (WebM)…');
        requestAnimationFrame(Vigilar);
      };
      Vigilar();
    });

    Contexto.Animacion.Pausar();
    Grabadora.stop();
    await Finalizado;
    ContextoAudio?.close();
    Escena.Redimensionar();

    if (this.Cancelado) throw new Error('Exportación cancelada por el usuario.');
    DescargarBlob(new Blob(Fragmentos, { type: 'video/webm' }), `AnimacionVRM_${Ancho}x${Alto}_${Fps}fps.webm`);
    AlProgreso(1, 'Exportación completada.');
  }
}

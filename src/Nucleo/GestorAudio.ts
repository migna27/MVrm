// ============================================================================
// GestorAudio.ts — Etapa 4: Carga y reproducción de sonido sincronizado
// Decodifica el audio, calcula su forma de onda para la línea de tiempo y
// sincroniza la reproducción con el cabezal. También entrega el búfer para
// la exportación del video final.
// ============================================================================

export class GestorAudio {
  public Buffer: AudioBuffer | null = null;
  public NombreArchivo = '';
  public Desplazamiento = 0; // Segundos de adelanto/atraso respecto a la línea
  public Volumen = 0.9;
  public Picos: number[] = []; // Forma de onda simplificada (0..1) para dibujar

  private Contexto: AudioContext | null = null;
  private Fuente: AudioBufferSourceNode | null = null;
  private Ganancia: GainNode | null = null;

  /** Contexto de audio perezoso (los navegadores exigen gesto del usuario). */
  private ObtenerContexto(): AudioContext {
    if (!this.Contexto) {
      this.Contexto = new AudioContext();
      this.Ganancia = this.Contexto.createGain();
      this.Ganancia.gain.value = this.Volumen;
      this.Ganancia.connect(this.Contexto.destination);
    }
    return this.Contexto;
  }

  /** Carga y decodifica un archivo de audio, y calcula su forma de onda. */
  public async Cargar(Archivo: File): Promise<void> {
    const Contexto = this.ObtenerContexto();
    const Bufer = await Archivo.arrayBuffer();
    this.Buffer = await Contexto.decodeAudioData(Bufer);
    this.NombreArchivo = Archivo.name;
    this.CalcularPicos();
  }

  /** Resume 400 bloques del audio como picos normalizados para dibujarlos. */
  private CalcularPicos(Bloques = 400): void {
    this.Picos = [];
    if (!this.Buffer) return;
    const Canal = this.Buffer.getChannelData(0);
    const MuestrasPorBloque = Math.max(1, Math.floor(Canal.length / Bloques));
    for (let I = 0; I < Bloques; I++) {
      let Pico = 0;
      const Inicio = I * MuestrasPorBloque;
      for (let J = 0; J < MuestrasPorBloque; J += 16) {
        const V = Math.abs(Canal[Inicio + J] ?? 0);
        if (V > Pico) Pico = V;
      }
      this.Picos.push(Pico);
    }
  }

  /** Reproduce el audio sincronizado con un tiempo de la línea de tiempo. */
  public ReproducirDesde(TiempoLinea: number): void {
    if (!this.Buffer) return;
    this.Detener();
    const Contexto = this.ObtenerContexto();
    void Contexto.resume();

    const TiempoAudio = TiempoLinea - this.Desplazamiento;
    this.Fuente = Contexto.createBufferSource();
    this.Fuente.buffer = this.Buffer;
    this.Fuente.connect(this.Ganancia!);

    if (TiempoAudio >= 0) {
      if (TiempoAudio < this.Buffer.duration) this.Fuente.start(0, TiempoAudio);
    } else {
      // El audio empieza más adelante: se programa con retardo
      this.Fuente.start(Contexto.currentTime + (-TiempoAudio), 0);
    }
  }

  /** Detiene la reproducción actual. */
  public Detener(): void {
    try { this.Fuente?.stop(); } catch { /* Ya estaba detenida */ }
    this.Fuente?.disconnect();
    this.Fuente = null;
  }

  /** Ajusta el volumen de reproducción. */
  public EstablecerVolumen(Valor: number): void {
    this.Volumen = Valor;
    if (this.Ganancia) this.Ganancia.gain.value = Valor;
  }

  /** Duración del audio cargado en segundos. */
  public ObtenerDuracion(): number {
    return this.Buffer?.duration ?? 0;
  }

  /** Elimina el audio cargado. */
  public Quitar(): void {
    this.Detener();
    this.Buffer = null;
    this.NombreArchivo = '';
    this.Picos = [];
  }
}

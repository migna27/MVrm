// ============================================================================
// LineaTiempo.ts — Etapa 2 y 5: Línea de tiempo interactiva
// Dibuja la regla, las pistas con sus claves, la forma de onda del audio y
// el cabezal. Permite buscar, seleccionar, mover y eliminar claves, así
// como hacer zoom y desplazarse por la animación.
// ============================================================================

import { ContextoAplicacion } from '../Contexto';
import { PistaAnimacion, COLORES_GRUPO, PRIORIDAD_GRUPOS } from '../Tipos';
import { FormatearTiempo, Limitar } from '../Utilidades';

const ALTO_REGLA = 26;
const ALTO_FILA = 26;
const ALTO_FILA_AUDIO = 46;
const ANCHO_ETIQUETAS = 176;
const RADIO_CLAVE = 6;

type ModoArrastre = 'Ninguno' | 'Buscar' | 'MoverClave';

/** Referencia a la clave actualmente seleccionada. */
export interface SeleccionClave {
  PistaId: string;
  ClaveId: string;
}

export class LineaTiempo {
  public PxPorSegundo = 80;
  public Seleccion: SeleccionClave | null = null;

  private Contexto2D: CanvasRenderingContext2D;
  private DesplazamientoX = 0; // Desplazamiento horizontal en píxeles
  private DesplazamientoY = 0; // Desplazamiento vertical en píxeles
  private Modo: ModoArrastre = 'Ninguno';

  constructor(private Lienzo: HTMLCanvasElement, private Contexto: ContextoAplicacion) {
    this.Contexto2D = Lienzo.getContext('2d')!;
    this.VincularEventos();
    new ResizeObserver(() => this.Dibujar()).observe(Lienzo.parentElement!);
  }

  /** Pistas ordenadas para mostrar (agrupadas por prioridad de grupo). */
  private ObtenerPistasOrdenadas(): PistaAnimacion[] {
    return [...this.Contexto.Animacion.Pistas].sort(
      (A, B) => PRIORIDAD_GRUPOS.indexOf(A.Grupo) - PRIORIDAD_GRUPOS.indexOf(B.Grupo)
    );
  }

  // --------------------------------------------------------------------------
  // Conversión tiempo ↔ píxeles
  // --------------------------------------------------------------------------

  private TiempoAPixeles(Tiempo: number): number {
    return ANCHO_ETIQUETAS + Tiempo * this.PxPorSegundo - this.DesplazamientoX;
  }

  private PixelesATiempo(X: number): number {
    return (X - ANCHO_ETIQUETAS + this.DesplazamientoX) / this.PxPorSegundo;
  }

  private AlturaTotal(): number {
    const Pistas = this.ObtenerPistasOrdenadas();
    const FilasAudio = this.Contexto.Audio.Buffer ? 1 : 0;
    return ALTO_REGLA + Pistas.length * ALTO_FILA + FilasAudio * ALTO_FILA_AUDIO + 12;
  }

  // --------------------------------------------------------------------------
  // Eventos de ratón
  // --------------------------------------------------------------------------

  private VincularEventos(): void {
    const Posicion = (E: MouseEvent) => {
      const Rect = this.Lienzo.getBoundingClientRect();
      return { X: E.clientX - Rect.left, Y: E.clientY - Rect.top };
    };

    this.Lienzo.addEventListener('mousedown', (E) => {
      const { X, Y } = Posicion(E);
      const Anim = this.Contexto.Animacion;

      // Clic en una clave: seleccionarla y comenzar a moverla
      const Tocado = this.BuscarClaveEn(X, Y);
      if (Tocado) {
        this.Seleccion = Tocado;
        this.Modo = 'MoverClave';
        this.Dibujar();
        return;
      }

      // Clic en la regla o zona de pistas: mover el cabezal
      if (X > ANCHO_ETIQUETAS) {
        this.Modo = 'Buscar';
        Anim.EstablecerTiempo(this.PixelesATiempo(X));
        Anim.EvaluarEn(Anim.TiempoActual);
        this.Contexto.RefrescarLineaTiempo();
      }
    });

    window.addEventListener('mousemove', (E) => {
      if (this.Modo === 'Ninguno') return;
      const { X } = Posicion(E);
      const Anim = this.Contexto.Animacion;

      if (this.Modo === 'Buscar') {
        Anim.EstablecerTiempo(this.PixelesATiempo(X));
        Anim.EvaluarEn(Anim.TiempoActual);
        this.Contexto.RefrescarLineaTiempo();
      } else if (this.Modo === 'MoverClave' && this.Seleccion) {
        const Pista = Anim.Pistas.find((P) => P.Id === this.Seleccion!.PistaId);
        if (Pista) {
          let T = this.PixelesATiempo(X);
          if (!E.altKey) T = Math.round(T / 0.05) * 0.05; // Imán de 50 ms
          Anim.MoverClave(Pista, this.Seleccion.ClaveId, T);
          Anim.EvaluarEn(Anim.TiempoActual);
        }
      }
    });

    window.addEventListener('mouseup', () => { this.Modo = 'Ninguno'; });

    // Rueda: zoom con Ctrl, desplazamiento vertical, horizontal con Shift
    this.Lienzo.addEventListener('wheel', (E) => {
      E.preventDefault();
      const { X } = Posicion(E);
      if (E.ctrlKey || E.metaKey) {
        const Factor = E.deltaY < 0 ? 1.15 : 1 / 1.15;
        const TiempoEnCursor = this.PixelesATiempo(X);
        this.PxPorSegundo = Limitar(this.PxPorSegundo * Factor, 12, 480);
        this.DesplazamientoX = Math.max(0, TiempoEnCursor * this.PxPorSegundo - (X - ANCHO_ETIQUETAS));
      } else if (E.shiftKey) {
        this.DesplazamientoX = Math.max(0, this.DesplazamientoX + E.deltaY);
      } else {
        const MaxY = Math.max(0, this.AlturaTotal() - this.Lienzo.clientHeight);
        this.DesplazamientoY = Limitar(this.DesplazamientoY + E.deltaY, 0, MaxY);
      }
      this.Dibujar();
    }, { passive: false });

    // --- Arrastrar y Soltar Clips de Efecto ---
    this.Lienzo.addEventListener('dragover', (E) => {
      E.preventDefault();
      if (E.dataTransfer) E.dataTransfer.dropEffect = 'copy';
    });

    this.Lienzo.addEventListener('drop', (E) => {
      E.preventDefault();
      const DatosTexto = E.dataTransfer?.getData('animador/arrastrar-efecto');
      if (!DatosTexto) return;
      try {
        const Datos = JSON.parse(DatosTexto) as { Tipo: 'Efecto' | 'Luz', Objetivo: string, ValorBase: number };
        const { X } = Posicion(E);
        let TiempoSoltar = this.PixelesATiempo(X);
        if (TiempoSoltar < 0) TiempoSoltar = 0;
        
        // Crear un "Clip" de efecto de 4 segundos con transición de 1 segundo
        const Anim = this.Contexto.Animacion;
        const Pista = Anim.ObtenerOCrearPista(Datos.Tipo, Datos.Objetivo, 'Manual');
        const T0 = TiempoSoltar;
        const T1 = Math.min(Anim.Duracion, T0 + 1);
        const T2 = Math.min(Anim.Duracion, T0 + 3);
        const T3 = Math.min(Anim.Duracion, T0 + 4);
        
        Anim.AgregarClave(Pista, T0, [0]);
        if (T1 > T0) Anim.AgregarClave(Pista, T1, [Datos.ValorBase]);
        if (T2 > T1) Anim.AgregarClave(Pista, T2, [Datos.ValorBase]);
        if (T3 > T2) Anim.AgregarClave(Pista, T3, [0]);
        
        this.Contexto.NotificarEstado(`Efecto "${Datos.Objetivo}" añadido en ${T0.toFixed(1)}s`);
        this.Dibujar();
      } catch (err) {
        console.error('Error al parsear el efecto soltado', err);
      }
    });

    // Clic derecho sobre la etiqueta de una pista: eliminarla
    this.Lienzo.addEventListener('contextmenu', (E) => {
      E.preventDefault();
      const { X, Y } = Posicion(E);
      if (X < ANCHO_ETIQUETAS) {
        const Indice = Math.floor((Y + this.DesplazamientoY - ALTO_REGLA) / ALTO_FILA);
        const Pistas = this.ObtenerPistasOrdenadas();
        if (Indice >= 0 && Indice < Pistas.length) {
          if (confirm(`¿Eliminar la pista "${Pistas[Indice].Nombre}"?`)) {
            this.Contexto.Animacion.EliminarPista(Pistas[Indice].Id);
          }
        }
      }
    });
  }

  /** Localiza la clave bajo el cursor (si existe). */
  private BuscarClaveEn(X: number, Y: number): SeleccionClave | null {
    const Pistas = this.ObtenerPistasOrdenadas();
    for (let I = 0; I < Pistas.length; I++) {
      const YFila = ALTO_REGLA + I * ALTO_FILA + ALTO_FILA / 2 - this.DesplazamientoY;
      if (Math.abs(Y - YFila) > ALTO_FILA / 2) continue;
      for (const Clave of Pistas[I].Claves) {
        if (Math.abs(X - this.TiempoAPixeles(Clave.Tiempo)) <= RADIO_CLAVE + 2) {
          return { PistaId: Pistas[I].Id, ClaveId: Clave.Id };
        }
      }
    }
    return null;
  }

  /** Elimina la clave seleccionada (botón o tecla Supr). */
  public EliminarSeleccion(): void {
    if (!this.Seleccion) return;
    this.Contexto.Animacion.EliminarClave(this.Seleccion.PistaId, this.Seleccion.ClaveId);
    this.Seleccion = null;
  }

  // --------------------------------------------------------------------------
  // Dibujo
  // --------------------------------------------------------------------------

  public Dibujar(): void {
    const Ancho = this.Lienzo.clientWidth;
    const Alto = this.Lienzo.clientHeight;
    const Dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.Lienzo.width !== Ancho * Dpr || this.Lienzo.height !== Alto * Dpr) {
      this.Lienzo.width = Ancho * Dpr;
      this.Lienzo.height = Alto * Dpr;
    }
    const C = this.Contexto2D;
    C.setTransform(Dpr, 0, 0, Dpr, 0, 0);
    C.clearRect(0, 0, Ancho, Alto);

    const Anim = this.Contexto.Animacion;
    const Pistas = this.ObtenerPistasOrdenadas();

    // Fondo general
    C.fillStyle = '#14161c';
    C.fillRect(0, 0, Ancho, Alto);

    this.DibujarRegla(C, Ancho, Anim.Duracion);

    // Filas de pistas
    for (let I = 0; I < Pistas.length; I++) {
      const YFila = ALTO_REGLA + I * ALTO_FILA - this.DesplazamientoY;
      if (YFila + ALTO_FILA < ALTO_REGLA || YFila > Alto) continue;
      this.DibujarFilaPista(C, Pistas[I], YFila, Ancho, Anim.Duracion);
    }

    // Fila de audio con su forma de onda
    if (this.Contexto.Audio.Buffer) {
      const YAudio = ALTO_REGLA + Pistas.length * ALTO_FILA - this.DesplazamientoY;
      this.DibujarFilaAudio(C, YAudio, Ancho);
    }

    // Zona más allá de la duración (sombreada)
    const XFin = this.TiempoAPixeles(Anim.Duracion);
    if (XFin < Ancho) {
      C.fillStyle = 'rgba(0,0,0,0.35)';
      C.fillRect(Math.max(XFin, ANCHO_ETIQUETAS), ALTO_REGLA, Ancho, Alto - ALTO_REGLA);
    }

    this.DibujarCabezal(C, Anim.TiempoActual, Alto);

    // Separador de la columna de etiquetas
    C.fillStyle = '#191c22';
    C.fillRect(0, 0, ANCHO_ETIQUETAS, Alto);
    C.strokeStyle = '#2a2f3b';
    C.beginPath();
    C.moveTo(ANCHO_ETIQUETAS + 0.5, 0);
    C.lineTo(ANCHO_ETIQUETAS + 0.5, Alto);
    C.stroke();

    this.DibujarEtiquetas(C, Pistas, Alto);
  }

  private DibujarRegla(C: CanvasRenderingContext2D, Ancho: number, Duracion: number): void {
    C.fillStyle = '#1d2027';
    C.fillRect(0, 0, Ancho, ALTO_REGLA);

    // Paso "agradable" según el zoom
    const Pasos = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const Paso = Pasos.find((P) => P * this.PxPorSegundo >= 64) ?? 60;

    C.strokeStyle = '#3a4152';
    C.fillStyle = '#8b93a5';
    C.font = '10px Segoe UI, sans-serif';
    C.textAlign = 'left';

    const TInicio = Math.max(0, this.PixelesATiempo(ANCHO_ETIQUETAS));
    const TFin = this.PixelesATiempo(Ancho);
    for (let T = Math.floor(TInicio / Paso) * Paso; T <= TFin; T += Paso) {
      const X = this.TiempoAPixeles(T);
      if (X < ANCHO_ETIQUETAS) continue;
      C.beginPath();
      C.moveTo(X, ALTO_REGLA - 8);
      C.lineTo(X, ALTO_REGLA);
      C.stroke();
      C.fillText(FormatearTiempo(T), X + 4, ALTO_REGLA - 10);
    }

    // Marca del fin de la animación
    const XFin = this.TiempoAPixeles(Duracion);
    C.strokeStyle = '#6cc8ff';
    C.setLineDash([4, 4]);
    C.beginPath();
    C.moveTo(XFin, 0);
    C.lineTo(XFin, ALTO_REGLA);
    C.stroke();
    C.setLineDash([]);
  }

  private DibujarFilaPista(
    C: CanvasRenderingContext2D, Pista: PistaAnimacion, YFila: number, Ancho: number, Duracion: number
  ): void {
    C.fillStyle = (Math.floor((YFila - ALTO_REGLA + this.DesplazamientoY) / ALTO_FILA) % 2 === 0)
      ? '#161922' : '#181c26';
    C.fillRect(ANCHO_ETIQUETAS, YFila, Ancho - ANCHO_ETIQUETAS, ALTO_FILA);

    const Color = COLORES_GRUPO[Pista.Grupo];
    const YCentro = YFila + ALTO_FILA / 2;

    // Línea base tenue de la fila
    C.strokeStyle = '#222836';
    C.beginPath();
    C.moveTo(ANCHO_ETIQUETAS, YCentro);
    C.lineTo(Math.min(Ancho, this.TiempoAPixeles(Duracion)), YCentro);
    C.stroke();

    // Visualización de curva de automatización / bloque para pistas escalares
    if (Pista.Tipo === 'Efecto' || Pista.Tipo === 'Luz' || Pista.Tipo === 'Expresion') {
      if (Pista.Claves.length >= 2) {
        let MaxValor = 0;
        for (const C of Pista.Claves) MaxValor = Math.max(MaxValor, Math.abs(C.Valor[0]));
        if (MaxValor < 0.001) MaxValor = 1;

        C.beginPath();
        const XIni = this.TiempoAPixeles(Pista.Claves[0].Tiempo);
        C.moveTo(XIni, YFila + ALTO_FILA);
        
        for (const Clave of Pista.Claves) {
          const X = this.TiempoAPixeles(Clave.Tiempo);
          const VNorm = Math.abs(Clave.Valor[0]) / MaxValor;
          const YClave = YFila + ALTO_FILA - (VNorm * (ALTO_FILA - 6)) - 3;
          C.lineTo(X, YClave);
        }
        
        const XFin = this.TiempoAPixeles(Pista.Claves[Pista.Claves.length - 1].Tiempo);
        C.lineTo(XFin, YFila + ALTO_FILA);
        C.fillStyle = Color + '44'; // Transparencia
        C.fill();
        
        C.strokeStyle = Color;
        C.lineWidth = 1.5;
        C.beginPath();
        for (let i = 0; i < Pista.Claves.length; i++) {
          const X = this.TiempoAPixeles(Pista.Claves[i].Tiempo);
          const VNorm = Math.abs(Pista.Claves[i].Valor[0]) / MaxValor;
          const YClave = YFila + ALTO_FILA - (VNorm * (ALTO_FILA - 6)) - 3;
          if (i === 0) C.moveTo(X, YClave);
          else C.lineTo(X, YClave);
        }
        C.stroke();
        C.lineWidth = 1;
      }
    }

    // Claves como rombos del color del grupo
    for (const Clave of Pista.Claves) {
      const X = this.TiempoAPixeles(Clave.Tiempo);
      if (X < ANCHO_ETIQUETAS - 8 || X > Ancho + 8) continue;
      
      let YDibujo = YCentro;
      // Si es escalar, el rombo sigue la curva
      if ((Pista.Tipo === 'Efecto' || Pista.Tipo === 'Luz' || Pista.Tipo === 'Expresion') && Pista.Claves.length > 0) {
         let MaxValor = 0;
         for (const C of Pista.Claves) MaxValor = Math.max(MaxValor, Math.abs(C.Valor[0]));
         if (MaxValor < 0.001) MaxValor = 1;
         const VNorm = Math.abs(Clave.Valor[0]) / MaxValor;
         YDibujo = YFila + ALTO_FILA - (VNorm * (ALTO_FILA - 6)) - 3;
      }

      const Seleccionada = this.Seleccion?.ClaveId === Clave.Id;
      C.fillStyle = Color;
      C.beginPath();
      C.moveTo(X, YDibujo - RADIO_CLAVE);
      C.lineTo(X + RADIO_CLAVE, YDibujo);
      C.lineTo(X, YDibujo + RADIO_CLAVE);
      C.lineTo(X - RADIO_CLAVE, YDibujo);
      C.closePath();
      C.fill();
      if (Seleccionada) {
        C.strokeStyle = '#ffffff';
        C.lineWidth = 2;
        C.stroke();
        C.lineWidth = 1;
      }
    }
  }

  private DibujarFilaAudio(C: CanvasRenderingContext2D, YFila: number, Ancho: number): void {
    C.fillStyle = '#131721';
    C.fillRect(ANCHO_ETIQUETAS, YFila, Ancho - ANCHO_ETIQUETAS, ALTO_FILA_AUDIO);

    const Audio = this.Contexto.Audio;
    if (!Audio.Buffer || Audio.Picos.length === 0) return;

    const YMedio = YFila + ALTO_FILA_AUDIO / 2;
    const AlturaMax = ALTO_FILA_AUDIO / 2 - 4;
    const DuracionAudio = Audio.ObtenerDuracion();

    C.fillStyle = 'rgba(108, 200, 255, 0.55)';
    const Barras = Math.min(Audio.Picos.length, Math.ceil((DuracionAudio * this.PxPorSegundo) / 2));
    for (let I = 0; I < Barras; I++) {
      const T = (I / Barras) * DuracionAudio;
      const X = this.TiempoAPixeles(T + Audio.Desplazamiento);
      if (X < ANCHO_ETIQUETAS || X > Ancho) continue;
      const Pico = Audio.Picos[Math.floor((I / Barras) * Audio.Picos.length)];
      const H = Math.max(1.5, Pico * AlturaMax);
      C.fillRect(X, YMedio - H, 2, H * 2);
    }
  }

  private DibujarCabezal(C: CanvasRenderingContext2D, Tiempo: number, Alto: number): void {
    const X = this.TiempoAPixeles(Tiempo);
    if (X < ANCHO_ETIQUETAS - 10) return;
    C.strokeStyle = '#ff5c6c';
    C.lineWidth = 2;
    C.beginPath();
    C.moveTo(X, 0);
    C.lineTo(X, Alto);
    C.stroke();
    C.lineWidth = 1;

    // Manija triangular en la regla
    C.fillStyle = '#ff5c6c';
    C.beginPath();
    C.moveTo(X - 6, 0);
    C.lineTo(X + 6, 0);
    C.lineTo(X, 10);
    C.closePath();
    C.fill();
  }

  private DibujarEtiquetas(C: CanvasRenderingContext2D, Pistas: PistaAnimacion[], Alto: number): void {
    C.font = '11px Segoe UI, sans-serif';
    C.textAlign = 'left';

    // Título de la regla
    C.fillStyle = '#8b93a5';
    C.fillText('Pistas', 10, 16);

    for (let I = 0; I < Pistas.length; I++) {
      const YFila = ALTO_REGLA + I * ALTO_FILA - this.DesplazamientoY;
      if (YFila + ALTO_FILA < ALTO_REGLA || YFila > Alto) continue;
      const YCentro = YFila + ALTO_FILA / 2;

      // Pastilla de color del grupo
      C.fillStyle = COLORES_GRUPO[Pistas[I].Grupo];
      C.beginPath();
      C.roundRect(8, YCentro - 5, 10, 10, 3);
      C.fill();

      C.fillStyle = '#dfe4ee';
      let Nombre = Pistas[I].Nombre;
      if (Nombre.length > 24) Nombre = Nombre.slice(0, 23) + '…';
      C.fillText(Nombre, 24, YCentro + 4);
    }

    if (this.Contexto.Audio.Buffer) {
      const YAudio = ALTO_REGLA + Pistas.length * ALTO_FILA - this.DesplazamientoY;
      if (YAudio > ALTO_REGLA - ALTO_FILA_AUDIO && YAudio < Alto) {
        C.fillStyle = '#6cc8ff';
        C.beginPath();
        C.roundRect(8, YAudio + ALTO_FILA_AUDIO / 2 - 5, 10, 10, 3);
        C.fill();
        C.fillStyle = '#dfe4ee';
        let Nombre = `Audio · ${this.Contexto.Audio.NombreArchivo}`;
        if (Nombre.length > 24) Nombre = Nombre.slice(0, 23) + '…';
        C.fillText(Nombre, 24, YAudio + ALTO_FILA_AUDIO / 2 + 4);
      }
    }
  }
}

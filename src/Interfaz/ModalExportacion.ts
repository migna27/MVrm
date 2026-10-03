import { ContextoAplicacion } from '../Contexto';
import { RESOLUCIONES_EXPORTACION, OpcionesExportacion } from '../Tipos';

export class ModalExportacion {
  private Modal: HTMLElement;
  private BarraExportacion!: HTMLElement;
  private TextoExportacion!: HTMLElement;
  
  constructor(private Contexto: ContextoAplicacion) {
    this.Modal = this.ConstruirModal();
    document.body.appendChild(this.Modal);

    // Enlazar botón superior (asumiendo que se creará en index.html)
    const BotonAbrir = document.getElementById('BotonAbrirExportacion');
    if (BotonAbrir) {
      BotonAbrir.onclick = () => this.Abrir();
    }
  }

  public Abrir(): void {
    if (!this.Contexto.Modelos.Vrm) {
      this.Contexto.NotificarEstado('Carga primero un modelo VRM antes de exportar.');
      // return; // Quitamos el return estricto para que pueda ver la UI, pero es buena práctica avisar
    }
    this.Modal.classList.remove('Oculto');
  }

  public Cerrar(): void {
    if (this.Contexto.Exportador.Exportando) {
      this.Contexto.NotificarEstado('Debes cancelar o esperar a que termine la exportación.');
      return;
    }
    this.Modal.classList.add('Oculto');
  }

  private ConstruirModal(): HTMLElement {
    const Ctx = this.Contexto;

    const ContenedorOverlay = document.createElement('div');
    ContenedorOverlay.className = 'OverlayModal Oculto';
    // Cerrar al hacer clic fuera
    ContenedorOverlay.onmousedown = (e) => {
      if (e.target === ContenedorOverlay) this.Cerrar();
    };

    const Ventana = document.createElement('div');
    Ventana.className = 'VentanaModal';

    const Cabecera = document.createElement('div');
    Cabecera.className = 'CabeceraModal';
    const Titulo = document.createElement('h2');
    Titulo.textContent = 'Exportar Animación';
    const BotonCerrar = document.createElement('button');
    BotonCerrar.className = 'BotonCerrar';
    BotonCerrar.innerHTML = '&times;';
    BotonCerrar.onclick = () => this.Cerrar();
    Cabecera.append(Titulo, BotonCerrar);

    const Cuerpo = document.createElement('div');
    Cuerpo.className = 'CuerpoModal';

    // Construcción de controles
    const EtiquetaRes = document.createElement('label');
    EtiquetaRes.className = 'EtiquetaCompacta';
    const SelectorRes = document.createElement('select');
    RESOLUCIONES_EXPORTACION.forEach((R, I) => {
      const O = document.createElement('option');
      O.value = String(I);
      O.textContent = `${R.Etiqueta} (${R.Ancho}×${R.Alto})`;
      if (I === 1) O.selected = true; // 1080p
      SelectorRes.appendChild(O);
    });
    EtiquetaRes.append(document.createTextNode('Resolución '), SelectorRes);

    const EtiquetaFps = document.createElement('label');
    EtiquetaFps.className = 'EtiquetaCompacta';
    const SelectorFps = document.createElement('select');
    for (const F of [24, 30, 60]) {
      const O = document.createElement('option');
      O.value = String(F); O.textContent = `${F} fps`;
      if (F === 30) O.selected = true;
      SelectorFps.appendChild(O);
    }
    EtiquetaFps.append(document.createTextNode('Velocidad '), SelectorFps);

    const EtiquetaFormato = document.createElement('label');
    EtiquetaFormato.className = 'EtiquetaCompacta';
    const SelectorFormato = document.createElement('select');
    for (const [Valor, Texto] of [['mp4', 'MP4 (H.264 + AAC)'], ['webm', 'WebM (respaldo, tiempo real)']]) {
      const O = document.createElement('option');
      O.value = Valor; O.textContent = Texto;
      SelectorFormato.appendChild(O);
    }
    EtiquetaFormato.append(document.createTextNode('Formato '), SelectorFormato);

    // Casilla Audio
    const LblAudio = document.createElement('label');
    LblAudio.className = 'EtiquetaCompacta';
    const CasillaAudio = document.createElement('input');
    CasillaAudio.type = 'checkbox';
    CasillaAudio.checked = true;
    LblAudio.append(CasillaAudio, document.createTextNode(' Incluir pista de audio'));

    // Agrupamos configuración
    const GrupoConfig = document.createElement('div');
    GrupoConfig.style.display = 'grid';
    GrupoConfig.style.gridTemplateColumns = '1fr 1fr';
    GrupoConfig.style.gap = '12px';
    GrupoConfig.append(EtiquetaRes, EtiquetaFps, EtiquetaFormato, LblAudio);
    Cuerpo.appendChild(GrupoConfig);

    // Botones de acción
    const BotonExportar = document.createElement('button');
    BotonExportar.className = 'BotonPrimario';
    BotonExportar.textContent = 'Renderizar y Exportar';
    BotonExportar.style.padding = '10px';
    BotonExportar.style.fontSize = '14px';

    const BotonCancelar = document.createElement('button');
    BotonCancelar.className = 'BotonPeligro';
    BotonCancelar.textContent = 'Cancelar';
    BotonCancelar.disabled = true;

    const FilaBotones = document.createElement('div');
    FilaBotones.className = 'FilaControles';
    FilaBotones.style.marginTop = '8px';
    FilaBotones.append(BotonExportar, BotonCancelar);
    Cuerpo.appendChild(FilaBotones);

    // Barra de progreso
    const ContenedorBarra = document.createElement('div');
    ContenedorBarra.className = 'BarraProgreso';
    this.BarraExportacion = document.createElement('div');
    ContenedorBarra.appendChild(this.BarraExportacion);
    
    this.TextoExportacion = document.createElement('p');
    this.TextoExportacion.className = 'TextoTenue';
    this.TextoExportacion.textContent = 'Listo para exportar el proyecto completo.';
    this.TextoExportacion.style.margin = '4px 0 0 0';
    
    Cuerpo.append(ContenedorBarra, this.TextoExportacion);

    // Lógica de exportación
    BotonExportar.onclick = async () => {
      if (!Ctx.Modelos.Vrm) { Ctx.NotificarEstado('Carga primero un modelo VRM.'); return; }
      
      const Res = RESOLUCIONES_EXPORTACION[parseInt(SelectorRes.value, 10)];
      const Opciones: OpcionesExportacion = {
        Ancho: Res.Ancho, Alto: Res.Alto,
        Fps: parseInt(SelectorFps.value, 10),
        Formato: SelectorFormato.value as 'mp4' | 'webm',
        IncluirAudio: CasillaAudio.checked
      };

      BotonExportar.disabled = true;
      BotonCerrar.disabled = true;
      BotonCancelar.disabled = false;
      SelectorRes.disabled = true;
      SelectorFps.disabled = true;
      SelectorFormato.disabled = true;
      CasillaAudio.disabled = true;

      try {
        await Ctx.Exportador.Exportar(Opciones, Ctx, (Fraccion, Mensaje) => {
          this.BarraExportacion.style.width = `${Math.round(Fraccion * 100)}%`;
          this.TextoExportacion.textContent = Mensaje;
        });
        Ctx.NotificarEstado('Video exportado correctamente.');
        this.Cerrar();
      } catch (E) {
        Ctx.NotificarEstado((E as Error).message);
        this.TextoExportacion.textContent = (E as Error).message;
      } finally {
        BotonExportar.disabled = false;
        BotonCerrar.disabled = false;
        BotonCancelar.disabled = true;
        SelectorRes.disabled = false;
        SelectorFps.disabled = false;
        SelectorFormato.disabled = false;
        CasillaAudio.disabled = false;
      }
    };

    BotonCancelar.onclick = () => Ctx.Exportador.CancelarExportacion();

    Ventana.append(Cabecera, Cuerpo);
    ContenedorOverlay.appendChild(Ventana);

    return ContenedorOverlay;
  }
}

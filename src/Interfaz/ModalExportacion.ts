// ============================================================================
// ModalExportacion.ts — Diálogo modal nativo (<dialog>) para exportar video
// ============================================================================

import { ContextoAplicacion } from '../Contexto';
import { RESOLUCIONES_EXPORTACION, OpcionesExportacion } from '../Tipos';
import { ConfigurarLightDismissFallback } from './Componentes/UtilidadesDialogo';
import { CrearIcono } from './Componentes/Iconos';

export class ModalExportacion {
  private Dialogo: HTMLDialogElement;
  private BarraExportacion!: HTMLElement;
  private TextoExportacion!: HTMLElement;
  private ResumenRender!: HTMLElement;
  private SelectorFps!: HTMLSelectElement;

  constructor(private Contexto: ContextoAplicacion) {
    this.Dialogo = this.ConstruirDialogo();
    document.body.appendChild(this.Dialogo);
    ConfigurarLightDismissFallback(this.Dialogo);

    const BotonAbrir = document.getElementById('BotonAbrirExportacion');
    if (BotonAbrir) {
      BotonAbrir.onclick = () => this.Abrir();
    }
  }

  public Abrir(): void {
    if (!this.Contexto.Modelos.Vrm) {
      this.Contexto.NotificarEstado('Carga primero un modelo VRM antes de exportar.', 'aviso');
    }
    this.ActualizarResumen();
    if (!this.Dialogo.open) {
      this.Dialogo.showModal();
    }
  }

  public Cerrar(): void {
    if (this.Contexto.Exportador.Exportando) {
      this.Contexto.NotificarEstado('Debes cancelar o esperar a que termine la exportación.', 'aviso');
      return;
    }
    if (this.Dialogo.open) this.Dialogo.close();
  }

  private ActualizarResumen(): void {
    const Fps = parseInt(this.SelectorFps?.value || '30', 10);
    const Dur = this.Contexto.Animacion.Duracion;
    const TotalCuadros = Math.max(1, Math.round(Dur * Fps));
    if (this.ResumenRender) {
      this.ResumenRender.textContent = `Duración: ${Dur.toFixed(1)}s · Total: ${TotalCuadros} cuadros a renderizar`;
    }
  }

  private ConstruirDialogo(): HTMLDialogElement {
    const Ctx = this.Contexto;

    const Dialogo = document.createElement('dialog');
    Dialogo.id = 'ModalExportacion';
    Dialogo.className = 'DialogoEstudio';
    Dialogo.setAttribute('closedby', 'any');
    Dialogo.setAttribute('aria-labelledby', 'TituloModalExportacion');

    Dialogo.addEventListener('cancel', (E) => {
      if (Ctx.Exportador.Exportando) {
        E.preventDefault();
        Ctx.NotificarEstado('No puedes cerrar mientras se exporta. Usa el botón Cancelar.', 'aviso');
      }
    });

    Dialogo.addEventListener('close', () => {
      Dialogo.returnValue = '';
    });

    const Cabecera = document.createElement('div');
    Cabecera.className = 'CabeceraDialogo';
    const Titulo = document.createElement('h2');
    Titulo.id = 'TituloModalExportacion';
    Titulo.textContent = 'Exportar Video del Timeline';

    const BotonCerrar = document.createElement('button');
    BotonCerrar.type = 'button';
    BotonCerrar.className = 'BotonCerrar';
    BotonCerrar.setAttribute('aria-label', 'Cerrar diálogo');
    BotonCerrar.appendChild(CrearIcono('close'));
    BotonCerrar.onclick = () => this.Cerrar();
    Cabecera.append(Titulo, BotonCerrar);

    const Cuerpo = document.createElement('div');
    Cuerpo.className = 'CuerpoDialogo';

    this.ResumenRender = document.createElement('p');
    this.ResumenRender.className = 'ResumenBannerDialogo';

    const CampoRes = document.createElement('div');
    CampoRes.className = 'CampoDialogo';
    const LblRes = document.createElement('label');
    LblRes.htmlFor = 'ExpRes';
    LblRes.textContent = 'Resolución';
    const SelectorRes = document.createElement('select');
    SelectorRes.id = 'ExpRes';
    SelectorRes.autofocus = true;
    RESOLUCIONES_EXPORTACION.forEach((R, I) => {
      const O = document.createElement('option');
      O.value = String(I);
      O.textContent = `${R.Etiqueta} (${R.Ancho}×${R.Alto})`;
      if (I === 1) O.selected = true;
      SelectorRes.appendChild(O);
    });
    CampoRes.append(LblRes, SelectorRes);

    const CampoFps = document.createElement('div');
    CampoFps.className = 'CampoDialogo';
    const LblFps = document.createElement('label');
    LblFps.htmlFor = 'ExpFps';
    LblFps.textContent = 'Cuadros por segundo';
    this.SelectorFps = document.createElement('select');
    this.SelectorFps.id = 'ExpFps';
    for (const F of [24, 30, 60]) {
      const O = document.createElement('option');
      O.value = String(F);
      O.textContent = `${F} FPS`;
      if (F === 30) O.selected = true;
      this.SelectorFps.appendChild(O);
    }
    this.SelectorFps.onchange = () => this.ActualizarResumen();
    CampoFps.append(LblFps, this.SelectorFps);

    const CampoFormato = document.createElement('div');
    CampoFormato.className = 'CampoDialogo';
    const LblFmt = document.createElement('label');
    LblFmt.htmlFor = 'ExpFmt';
    LblFmt.textContent = 'Formato';
    const SelectorFormato = document.createElement('select');
    SelectorFormato.id = 'ExpFmt';
    for (const [Valor, Texto] of [['mp4', 'MP4 (H.264 + AAC)'], ['webm', 'WebM (VP9 respaldo)']]) {
      const O = document.createElement('option');
      O.value = Valor;
      O.textContent = Texto;
      SelectorFormato.appendChild(O);
    }
    CampoFormato.append(LblFmt, SelectorFormato);

    const CampoAudio = document.createElement('label');
    CampoAudio.className = 'EtiquetaCompacta';
    const CasillaAudio = document.createElement('input');
    CasillaAudio.type = 'checkbox';
    CasillaAudio.checked = true;
    CampoAudio.append(CasillaAudio, document.createTextNode(' Incluir pista de audio'));

    const Rejilla = document.createElement('div');
    Rejilla.className = 'RejillaDialogo';
    Rejilla.append(CampoRes, CampoFps, CampoFormato, CampoAudio);

    const ContenedorBarra = document.createElement('div');
    ContenedorBarra.className = 'BarraProgreso';
    this.BarraExportacion = document.createElement('div');
    ContenedorBarra.appendChild(this.BarraExportacion);

    this.TextoExportacion = document.createElement('p');
    this.TextoExportacion.className = 'TextoTenue';
    this.TextoExportacion.textContent = 'Listo para renderizar el proyecto completo.';

    const Pie = document.createElement('div');
    Pie.className = 'PieDialogo';

    const BotonCancelar = document.createElement('button');
    BotonCancelar.type = 'button';
    BotonCancelar.className = 'BotonPeligro';
    BotonCancelar.textContent = 'Cancelar render';
    BotonCancelar.disabled = true;

    const BotonExportar = document.createElement('button');
    BotonExportar.type = 'button';
    BotonExportar.className = 'BotonPrimario BotonIconoTexto';
    BotonExportar.append(CrearIcono('export'), document.createTextNode(' Renderizar y Exportar'));

    Pie.append(BotonCancelar, BotonExportar);
    Cuerpo.append(this.ResumenRender, Rejilla, ContenedorBarra, this.TextoExportacion);
    Dialogo.append(Cabecera, Cuerpo, Pie);

    BotonExportar.onclick = async () => {
      if (!Ctx.Modelos.Vrm) {
        Ctx.NotificarEstado('Carga primero un modelo VRM.', 'aviso');
        return;
      }

      const Res = RESOLUCIONES_EXPORTACION[parseInt(SelectorRes.value, 10)];
      const Opciones: OpcionesExportacion = {
        Ancho: Res.Ancho,
        Alto: Res.Alto,
        Fps: parseInt(this.SelectorFps.value, 10),
        Formato: SelectorFormato.value as 'mp4' | 'webm',
        IncluirAudio: CasillaAudio.checked
      };

      BotonExportar.disabled = true;
      BotonCerrar.disabled = true;
      BotonCancelar.disabled = false;
      SelectorRes.disabled = true;
      this.SelectorFps.disabled = true;
      SelectorFormato.disabled = true;
      CasillaAudio.disabled = true;

      try {
        await Ctx.Exportador.Exportar(Opciones, Ctx, (Fraccion, Mensaje) => {
          this.BarraExportacion.style.width = `${Math.round(Fraccion * 100)}%`;
          this.TextoExportacion.textContent = Mensaje;
        });
        Ctx.NotificarEstado('Video exportado correctamente.', 'exito');
        this.Cerrar();
      } catch (E) {
        const Msg = (E as Error).message;
        Ctx.NotificarEstado(Msg, 'error');
        this.TextoExportacion.textContent = Msg;
      } finally {
        BotonExportar.disabled = false;
        BotonCerrar.disabled = false;
        BotonCancelar.disabled = true;
        SelectorRes.disabled = false;
        this.SelectorFps.disabled = false;
        SelectorFormato.disabled = false;
        CasillaAudio.disabled = false;
      }
    };

    BotonCancelar.onclick = () => Ctx.Exportador.CancelarExportacion();
    return Dialogo;
  }
}

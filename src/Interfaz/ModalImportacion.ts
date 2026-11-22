// ============================================================================
// ModalImportacion.ts — Asistente modal (<dialog>) para importar animaciones
// Permite elegir punto de inserción, modo de fusión/sobrescritura, velocidad,
// capa destino y simplificación automática RDP para editar claves fácilmente.
// ============================================================================

import { ContextoAplicacion } from '../Contexto';
import { GrupoPista, OpcionesImportacionAnimacion } from '../Tipos';
import { FormatearTiempo, Limitar } from '../Utilidades';
import { ConfigurarLightDismissFallback } from './Componentes/UtilidadesDialogo';
import { CrearIcono } from './Componentes/Iconos';

export class ModalImportacion {
  private Dialogo: HTMLDialogElement;
  private ArchivoActual: File | null = null;
  private ResumenArchivo!: HTMLElement;
  private InputTiempoInicio!: HTMLInputElement;
  private SelectorAncla!: HTMLSelectElement;
  private SelectorModo!: HTMLSelectElement;
  private SelectorGrupo!: HTMLSelectElement;
  private SelectorVelocidad!: HTMLSelectElement;
  private SelectorFps!: HTMLSelectElement;
  private CheckSimplificar!: HTMLInputElement;
  private InputTolerancia!: HTMLInputElement;
  private OutTolerancia!: HTMLOutputElement;
  private SelectorPersonaje!: HTMLSelectElement;
  private CampoPersonaje!: HTMLElement;
  private BloqueVmd!: HTMLElement;
  private CheckVmdRetarget!: HTMLInputElement;
  private CheckVmdTwist!: HTMLInputElement;
  private CheckVmdFootIk!: HTMLInputElement;
  private CheckVmdCamara!: HTMLInputElement;
  private CheckVmdLuz!: HTMLInputElement;
  private BotonConfirmar!: HTMLButtonElement;
  private BotonCargarEjemplo!: HTMLButtonElement;

  constructor(private readonly Contexto: ContextoAplicacion) {
    this.Dialogo = this.ConstruirDialogo();
    document.body.appendChild(this.Dialogo);
    ConfigurarLightDismissFallback(this.Dialogo);
  }

  public async AbrirConArchivo(archivo: File): Promise<void> {
    this.ArchivoActual = archivo;
    this.ResumenArchivo.textContent = `Analizando "${archivo.name}"…`;
    if (this.SelectorAncla.options.length > 0) {
      this.SelectorAncla.options[0].textContent = `Cabezal actual (${FormatearTiempo(this.Contexto.Animacion.TiempoActual)})`;
    }
    this.InputTiempoInicio.value = this.Contexto.Animacion.TiempoActual.toFixed(2);
    this.SelectorAncla.value = 'cabezal';
    this.InputTiempoInicio.disabled = true;
    this.BotonConfirmar.disabled = true;
    this.BotonCargarEjemplo.classList.add('Oculto');

    const EsVmd = archivo.name.toLowerCase().endsWith('.vmd');
    this.BloqueVmd.classList.toggle('Oculto', !EsVmd);

    this.SelectorPersonaje.innerHTML = '';
    const ListaPers = this.Contexto.Modelos.Personajes;
    this.CampoPersonaje.classList.toggle('Oculto', ListaPers.length === 0);
    for (let I = 0; I < ListaPers.length; I++) {
      const P = ListaPers[I];
      const O = document.createElement('option');
      O.value = P.Id;
      O.textContent = `${I + 1}. ${P.Nombre.replace(/\.vrm$/i, '')}`;
      if (P.Id === this.Contexto.Modelos.PersonajeActivoId) O.selected = true;
      this.SelectorPersonaje.appendChild(O);
    }

    if (!this.Dialogo.open) this.Dialogo.showModal();

    try {
      const Previa = await this.Contexto.Importador.Previsualizar(archivo, this.Contexto);
      this.ResumenArchivo.textContent =
        `${Previa.Formato} · Duración ${Previa.Duracion.toFixed(2)}s · ` +
        `${Previa.TotalPistas} pista(s) (~${Previa.TotalClavesEstimado} claves sin optimizar)`;
      this.BotonConfirmar.disabled = false;
    } catch (E) {
      this.ResumenArchivo.textContent = `Error al leer archivo: ${(E as Error).message}`;
      if (!this.Contexto.Modelos.Vrm && archivo.name.toLowerCase().endsWith('.vrma')) {
        this.BotonCargarEjemplo.classList.remove('Oculto');
      }
      this.Contexto.NotificarEstado((E as Error).message, 'error');
    }
  }

  private ConstruirDialogo(): HTMLDialogElement {
    const Dialogo = document.createElement('dialog');
    Dialogo.id = 'ModalImportacion';
    Dialogo.className = 'DialogoEstudio';
    Dialogo.setAttribute('closedby', 'any');
    Dialogo.setAttribute('aria-labelledby', 'TituloModalImportacion');

    Dialogo.addEventListener('close', () => {
      Dialogo.returnValue = '';
    });

    const Cabecera = document.createElement('div');
    Cabecera.className = 'CabeceraDialogo';
    const Titulo = document.createElement('h2');
    Titulo.id = 'TituloModalImportacion';
    Titulo.textContent = 'Importar Animación al Timeline';
    const BtnCerrar = document.createElement('button');
    BtnCerrar.type = 'button';
    BtnCerrar.className = 'BotonCerrar';
    BtnCerrar.setAttribute('aria-label', 'Cerrar diálogo');
    BtnCerrar.appendChild(CrearIcono('close'));
    BtnCerrar.onclick = () => Dialogo.close();
    Cabecera.append(Titulo, BtnCerrar);

    const Cuerpo = document.createElement('div');
    Cuerpo.className = 'CuerpoDialogo';

    this.ResumenArchivo = document.createElement('p');
    this.ResumenArchivo.className = 'ResumenBannerDialogo';
    Cuerpo.appendChild(this.ResumenArchivo);

    this.BotonCargarEjemplo = document.createElement('button');
    this.BotonCargarEjemplo.type = 'button';
    this.BotonCargarEjemplo.className = 'Oculto';
    this.BotonCargarEjemplo.textContent = 'Cargar modelo de ejemplo y reintentar';
    this.BotonCargarEjemplo.onclick = async () => {
      this.BotonCargarEjemplo.disabled = true;
      this.ResumenArchivo.textContent = 'Descargando modelo de ejemplo…';
      try {
        await this.Contexto.Modelos.CargarVrmDesdeUrl(
          'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/three-vrm-girl.vrm'
        );
        this.Contexto.Escena.ControlTransformacion.detach();
        this.Contexto.Bus.Emitir('modelo:cargado', { nombre: this.Contexto.Modelos.NombreModelo });
        if (this.ArchivoActual) await this.AbrirConArchivo(this.ArchivoActual);
      } catch (E) {
        this.ResumenArchivo.textContent = `Error al cargar ejemplo: ${(E as Error).message}`;
      } finally {
        this.BotonCargarEjemplo.disabled = false;
      }
    };
    Cuerpo.appendChild(this.BotonCargarEjemplo);

    const Rejilla = document.createElement('div');
    Rejilla.className = 'RejillaDialogo';

    // 1. Punto de inserción
    const CampoAncla = document.createElement('div');
    CampoAncla.className = 'CampoDialogo';
    const LblAncla = document.createElement('label');
    LblAncla.htmlFor = 'ImpAncla';
    LblAncla.textContent = 'Insertar en';
    this.SelectorAncla = document.createElement('select');
    this.SelectorAncla.id = 'ImpAncla';
    this.SelectorAncla.autofocus = true;
    for (const [V, T] of [
      ['cabezal', `Cabezal actual (${FormatearTiempo(this.Contexto.Animacion.TiempoActual)})`],
      ['inicio', 'Inicio (00:00.00)'],
      ['personalizado', 'Tiempo personalizado…']
    ]) {
      const O = document.createElement('option');
      O.value = V; O.textContent = T;
      this.SelectorAncla.appendChild(O);
    }
    CampoAncla.append(LblAncla, this.SelectorAncla);

    const CampoTiempo = document.createElement('div');
    CampoTiempo.className = 'CampoDialogo';
    const LblTiempo = document.createElement('label');
    LblTiempo.htmlFor = 'ImpTiempo';
    LblTiempo.textContent = 'Tiempo de inicio (s)';
    this.InputTiempoInicio = document.createElement('input');
    this.InputTiempoInicio.id = 'ImpTiempo';
    this.InputTiempoInicio.type = 'number';
    this.InputTiempoInicio.step = '0.05';
    this.InputTiempoInicio.min = '0';
    this.InputTiempoInicio.value = '0';
    CampoTiempo.append(LblTiempo, this.InputTiempoInicio);

    this.SelectorAncla.onchange = () => {
      if (this.SelectorAncla.value === 'cabezal') {
        this.InputTiempoInicio.value = this.Contexto.Animacion.TiempoActual.toFixed(2);
        this.InputTiempoInicio.disabled = true;
      } else if (this.SelectorAncla.value === 'inicio') {
        this.InputTiempoInicio.value = '0';
        this.InputTiempoInicio.disabled = true;
      } else {
        this.InputTiempoInicio.disabled = false;
        this.InputTiempoInicio.focus();
      }
    };

    // 2. Modo de combinación
    const CampoModo = document.createElement('div');
    CampoModo.className = 'CampoDialogo';
    const LblModo = document.createElement('label');
    LblModo.htmlFor = 'ImpModo';
    LblModo.textContent = 'Modo en el timeline';
    this.SelectorModo = document.createElement('select');
    this.SelectorModo.id = 'ImpModo';
    for (const [V, T] of [
      ['Combinar', 'Combinar con claves existentes'],
      ['SobrescribirRango', 'Sobrescribir claves en el rango'],
      ['ReemplazarGrupo', 'Reemplazar toda la capa destino']
    ]) {
      const O = document.createElement('option');
      O.value = V; O.textContent = T;
      this.SelectorModo.appendChild(O);
    }
    CampoModo.append(LblModo, this.SelectorModo);

    // 3. Capa destino
    const CampoGrupo = document.createElement('div');
    CampoGrupo.className = 'CampoDialogo';
    const LblGrupo = document.createElement('label');
    LblGrupo.htmlFor = 'ImpGrupo';
    LblGrupo.textContent = 'Capa destino';
    this.SelectorGrupo = document.createElement('select');
    this.SelectorGrupo.id = 'ImpGrupo';
    for (const [V, T] of [
      ['Importado', 'Importado'],
      ['Manual', 'Manual (prioridad máxima)'],
      ['Preajuste', 'Preajuste']
    ]) {
      const O = document.createElement('option');
      O.value = V; O.textContent = T;
      this.SelectorGrupo.appendChild(O);
    }
    CampoGrupo.append(LblGrupo, this.SelectorGrupo);

    // 4. Velocidad y FPS
    const CampoVel = document.createElement('div');
    CampoVel.className = 'CampoDialogo';
    const LblVel = document.createElement('label');
    LblVel.htmlFor = 'ImpVel';
    LblVel.textContent = 'Velocidad de reproducción';
    this.SelectorVelocidad = document.createElement('select');
    this.SelectorVelocidad.id = 'ImpVel';
    for (const [V, T] of [
      ['0.5', '0.5× (cámara lenta)'],
      ['0.75', '0.75×'],
      ['1', '1.0× (original)'],
      ['1.25', '1.25×'],
      ['1.5', '1.5×'],
      ['2', '2.0× (doble rápido)']
    ]) {
      const O = document.createElement('option');
      O.value = V; O.textContent = T;
      if (V === '1') O.selected = true;
      this.SelectorVelocidad.appendChild(O);
    }
    CampoVel.append(LblVel, this.SelectorVelocidad);

    const CampoFps = document.createElement('div');
    CampoFps.className = 'CampoDialogo';
    const LblFps = document.createElement('label');
    LblFps.htmlFor = 'ImpFps';
    LblFps.textContent = 'Frecuencia de muestreo';
    this.SelectorFps = document.createElement('select');
    this.SelectorFps.id = 'ImpFps';
    for (const F of [12, 24, 30]) {
      const O = document.createElement('option');
      O.value = String(F);
      O.textContent = `${F} FPS`;
      if (F === 24) O.selected = true;
      this.SelectorFps.appendChild(O);
    }
    CampoFps.append(LblFps, this.SelectorFps);

    Rejilla.append(CampoAncla, CampoTiempo, CampoModo, CampoGrupo, CampoVel, CampoFps);
    Cuerpo.appendChild(Rejilla);

    // Selector de personaje destino (Multi-VRM)
    this.CampoPersonaje = document.createElement('div');
    this.CampoPersonaje.className = 'CampoDialogo Oculto';
    const LblPers = document.createElement('label');
    LblPers.htmlFor = 'ImpPersonaje';
    LblPers.textContent = 'Personaje destino (Multi-VRM)';
    this.SelectorPersonaje = document.createElement('select');
    this.SelectorPersonaje.id = 'ImpPersonaje';
    this.CampoPersonaje.append(LblPers, this.SelectorPersonaje);
    Cuerpo.appendChild(this.CampoPersonaje);

    // Bloque específico para archivos VMD (MMD)
    this.BloqueVmd = document.createElement('div');
    this.BloqueVmd.className = 'BloqueSimplificacion Oculto';
    const TitVmd = document.createElement('div');
    TitVmd.className = 'EtiquetaCompacta';
    TitVmd.textContent = 'Motor VMD (MMD) directo sin herramientas externas:';
    const CrearCheckVmd = (texto: string, defecto = true): HTMLInputElement => {
      const L = document.createElement('label');
      L.className = 'EtiquetaCompacta';
      const Chk = document.createElement('input');
      Chk.type = 'checkbox';
      Chk.checked = defecto;
      L.append(Chk, document.createTextNode(' ' + texto));
      this.BloqueVmd.appendChild(L);
      return Chk;
    };
    this.BloqueVmd.appendChild(TitVmd);
    this.CheckVmdRetarget = CrearCheckVmd('Auto-Retarget A-Pose (PMX) → T-Pose (VRM)', true);
    this.CheckVmdTwist = CrearCheckVmd('Integrar huesos twist y semi-estándar (腕捩/手捩/下半身)', true);
    this.CheckVmdFootIk = CrearCheckVmd('Resolver Two-Bone Foot IK en piernas', true);
    this.CheckVmdCamara = CrearCheckVmd('Incluir pista de Cámara MMD (si existe)', true);
    this.CheckVmdLuz = CrearCheckVmd('Incluir pista de Luz MMD (si existe)', true);
    Cuerpo.appendChild(this.BloqueVmd);

    // 5. Simplificación automática RDP
    const BloqueSimp = document.createElement('div');
    BloqueSimp.className = 'BloqueSimplificacion';
    const LblSimp = document.createElement('label');
    LblSimp.className = 'EtiquetaCompacta';
    this.CheckSimplificar = document.createElement('input');
    this.CheckSimplificar.type = 'checkbox';
    this.CheckSimplificar.checked = true;
    LblSimp.append(this.CheckSimplificar, document.createTextNode(' Simplificar claves redundantes (más fácil de editar manualmente)'));

    const FilaTol = document.createElement('div');
    FilaTol.className = 'GrupoDeslizador';
    const LblTol = document.createElement('label');
    LblTol.htmlFor = 'ImpTol';
    LblTol.textContent = 'Tolerancia curva';
    this.InputTolerancia = document.createElement('input');
    this.InputTolerancia.id = 'ImpTol';
    this.InputTolerancia.type = 'range';
    this.InputTolerancia.min = '0.005';
    this.InputTolerancia.max = '0.06';
    this.InputTolerancia.step = '0.005';
    this.InputTolerancia.value = '0.015';
    this.OutTolerancia = document.createElement('output');
    this.OutTolerancia.textContent = '0.015';
    this.InputTolerancia.oninput = () => {
      this.OutTolerancia.textContent = parseFloat(this.InputTolerancia.value).toFixed(3);
    };
    this.CheckSimplificar.onchange = () => {
      this.InputTolerancia.disabled = !this.CheckSimplificar.checked;
    };
    FilaTol.append(LblTol, this.InputTolerancia, this.OutTolerancia);
    BloqueSimp.append(LblSimp, FilaTol);
    Cuerpo.appendChild(BloqueSimp);

    // Pie
    const Pie = document.createElement('div');
    Pie.className = 'PieDialogo';
    const BtnCancelar = document.createElement('button');
    BtnCancelar.type = 'button';
    BtnCancelar.textContent = 'Cancelar';
    BtnCancelar.onclick = () => Dialogo.close();

    this.BotonConfirmar = document.createElement('button');
    this.BotonConfirmar.type = 'button';
    this.BotonConfirmar.className = 'BotonPrimario BotonIconoTexto';
    this.BotonConfirmar.append(CrearIcono('import'), document.createTextNode(' Importar al Timeline'));
    this.BotonConfirmar.onclick = () => void this.Confirmar();

    Pie.append(BtnCancelar, this.BotonConfirmar);
    Dialogo.append(Cabecera, Cuerpo, Pie);
    return Dialogo;
  }

  private async Confirmar(): Promise<void> {
    if (!this.ArchivoActual) return;
    const Velocidad = Limitar(parseFloat(this.SelectorVelocidad.value) || 1, 0.25, 3);
    const TiempoInicio = this.SelectorAncla.value === 'cabezal'
      ? this.Contexto.Animacion.TiempoActual
      : this.SelectorAncla.value === 'inicio'
        ? 0
        : Math.max(0, parseFloat(this.InputTiempoInicio.value) || 0);

    const PersElegido = this.SelectorPersonaje?.value || this.Contexto.Modelos.PersonajeActivoId || undefined;
    const Opciones: OpcionesImportacionAnimacion = {
      TiempoInicio,
      Modo: this.SelectorModo.value as OpcionesImportacionAnimacion['Modo'],
      EscalaTiempo: 1 / Velocidad,
      FpsMuestreo: parseInt(this.SelectorFps.value, 10) || 24,
      Simplificar: this.CheckSimplificar.checked,
      ToleranciaSimplificacion: parseFloat(this.InputTolerancia.value) || 0.015,
      GrupoDestino: this.SelectorGrupo.value as GrupoPista,
      PersonajeId: PersElegido,
      AutoRetargetAPose: this.CheckVmdRetarget?.checked ?? true,
      IntegrarTwist: this.CheckVmdTwist?.checked ?? true,
      UsarFootIK: this.CheckVmdFootIk?.checked ?? true,
      IncluirCamaraVmd: this.CheckVmdCamara?.checked ?? true,
      IncluirLucesVmd: this.CheckVmdLuz?.checked ?? true
    };

    this.BotonConfirmar.disabled = true;
    try {
      const Res = await this.Contexto.Importador.ImportarConHistorial(
        this.ArchivoActual,
        Opciones,
        this.Contexto
      );
      const EntradaDur = document.getElementById('EntradaDuracion') as HTMLInputElement | null;
      if (EntradaDur) EntradaDur.value = String(this.Contexto.Animacion.Duracion);

      this.Contexto.NotificarEstado(
        `Importado "${Res.Nombre}": ${Res.Pistas.length} pista(s) (${Res.ClavesOriginales} → ${Res.ClavesFinales} claves editables).`,
        'exito',
        true
      );
      this.Dialogo.close();
    } catch (E) {
      this.Contexto.NotificarEstado(`Error al importar: ${(E as Error).message}`, 'error');
    } finally {
      this.BotonConfirmar.disabled = false;
    }
  }
}

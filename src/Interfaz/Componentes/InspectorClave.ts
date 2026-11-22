// ============================================================================
// InspectorClave.ts — Patrón Master-Detail para crear, editar, sobrescribir
// y eliminar keyframes (estado vacío, selección única o edición en lote).
// ============================================================================

import { ContextoAplicacion } from '../../Contexto';
import { ClaveAnimacion, PistaAnimacion, TipoInterpolacion } from '../../Tipos';
import { LISTA_INTERPOLACIONES } from '../../Arquitectura/EstrategiasInterpolacion';
import {
  ComandoCambiarInterpolacionLote, ComandoEliminarClaves,
  ComandoGuardarClave, ComandoInsertarPose, ComandoModificarClave,
  ComandoMoverClaves, ComandoPegarClaves
} from '../../Arquitectura/ComandosAnimacion';
import { AGrados, ARadianes, FormatearTiempo, Limitar } from '../../Utilidades';
import { CrearIcono, NombreIcono } from './Iconos';

const ICONO_POR_CURVA: Record<TipoInterpolacion, NombreIcono> = {
  Suave: 'curveSuave',
  Lineal: 'curveLineal',
  EntradaSuave: 'curveEntrada',
  SalidaSuave: 'curveSalida',
  Escalon: 'curveEscalon'
};

export class InspectorClave {
  private Desuscripciones: (() => void)[] = [];
  private EditandoEnVivo = false;
  private ClaveRenderizadaFirma: string | null = null;
  private InputTiempoActual: HTMLInputElement | null = null;
  private ContenedorCurvasActual: HTMLElement | null = null;
  private EntradasValorActual: Array<{ Entrada: HTMLInputElement; Tipo: string }> = [];
  private SnapshotValorActual: ClaveAnimacion | null = null;

  constructor(
    private readonly Contenedor: HTMLElement,
    private readonly Contexto: ContextoAplicacion
  ) {
    this.Suscribir();
    this.Renderizar();
  }

  private Suscribir(): void {
    const Bus = this.Contexto.Bus;
    this.Desuscripciones.push(
      Bus.Suscribir('seleccion:cambiada', () => this.Renderizar()),
      Bus.Suscribir('pistas:cambiadas', () => {
        if (!this.EditandoEnVivo) this.Renderizar();
      }),
      Bus.Suscribir('tiempo:cambiado', (D) => {
        if (D.fuente !== 'reproduccion' && this.Contexto.Estado.SeleccionClaves.length === 0) {
          this.Renderizar();
        }
      }),
      Bus.Suscribir('estudio:configuracion', () => this.Renderizar()),
      Bus.Suscribir('hueso:seleccionado', () => {
        if (this.Contexto.Estado.SeleccionClaves.length === 0) this.Renderizar();
      })
    );
  }

  public Destruir(): void {
    for (const D of this.Desuscripciones) D();
    this.Desuscripciones = [];
  }

  public Renderizar(): void {
    const Seleccion = this.Contexto.Estado.SeleccionClaves;

    if (Seleccion.length === 0) {
      this.LimpiarReferenciasClaveUnica();
      this.Contenedor.innerHTML = '';
      this.RenderizarSinSeleccion();
      return;
    }

    if (Seleccion.length === 1) {
      const Sel = Seleccion[0];
      const Pista = this.Contexto.Animacion.Pistas.find((P) => P.Id === Sel.PistaId);
      const Clave = Pista?.Claves.find((C) => C.Id === Sel.ClaveId);
      if (Pista && Clave) {
        const Bloqueada = Boolean(Pista.Bloqueada);
        const Firma = `${Pista.Id}|${Clave.Id}|${Bloqueada ? 1 : 0}|${Clave.Valor.length}`;
        if (this.ClaveRenderizadaFirma === Firma && this.Contenedor.contains(document.activeElement)) {
          this.ActualizarClaveUnicaEnVivo(Pista, Clave);
          return;
        }
        this.LimpiarReferenciasClaveUnica();
        this.Contenedor.innerHTML = '';
        this.ClaveRenderizadaFirma = Firma;
        this.RenderizarClaveUnica(Pista, Clave);
        return;
      }
    }

    this.LimpiarReferenciasClaveUnica();
    this.Contenedor.innerHTML = '';
    this.RenderizarSeleccionMultiple();
  }

  private LimpiarReferenciasClaveUnica(): void {
    this.ClaveRenderizadaFirma = null;
    this.InputTiempoActual = null;
    this.ContenedorCurvasActual = null;
    this.EntradasValorActual = [];
    this.SnapshotValorActual = null;
  }

  private FormatearValorEntrada(TipoPista: string, ValorNum: number): string {
    if (TipoPista === 'HuesoRotacion') return AGrados(ValorNum).toFixed(1);
    if (TipoPista === 'Expresion') return (ValorNum * 100).toFixed(0);
    return ValorNum.toFixed(3);
  }

  private ActualizarClaveUnicaEnVivo(Pista: PistaAnimacion, Clave: ClaveAnimacion): void {
    const Anim = this.Contexto.Animacion;
    const Activo = document.activeElement;

    if (this.InputTiempoActual) {
      this.InputTiempoActual.max = String(Anim.Duracion);
      if (Activo !== this.InputTiempoActual) {
        this.InputTiempoActual.value = Clave.Tiempo.toFixed(3);
      }
    }

    if (this.ContenedorCurvasActual) {
      const CurvaActiva = Clave.Interpolacion ?? 'Suave';
      const Botones = this.ContenedorCurvasActual.querySelectorAll('button');
      LISTA_INTERPOLACIONES.forEach((Est, Indice) => {
        Botones[Indice]?.setAttribute('aria-pressed', String(CurvaActiva === Est.Tipo));
      });
    }

    this.EntradasValorActual.forEach((Ref, I) => {
      if (Activo !== Ref.Entrada && I < Clave.Valor.length) {
        Ref.Entrada.value = this.FormatearValorEntrada(Ref.Tipo, Clave.Valor[I]);
      }
    });

    if (!this.EditandoEnVivo) {
      this.SnapshotValorActual = {
        Id: Clave.Id,
        Tiempo: Clave.Tiempo,
        Valor: [...Clave.Valor],
        Interpolacion: Clave.Interpolacion
      };
    }
  }

  private CrearSelectorCurvas(
    ValorActual: TipoInterpolacion | undefined,
    AlElegir: (Tipo: TipoInterpolacion) => void,
    Deshabilitado = false
  ): HTMLElement {
    const Grupo = document.createElement('div');
    Grupo.className = 'GrupoCurvas';
    Grupo.setAttribute('role', 'group');
    Grupo.setAttribute('aria-label', 'Tipo de interpolación');

    for (const Est of LISTA_INTERPOLACIONES) {
      const Btn = document.createElement('button');
      Btn.type = 'button';
      Btn.className = 'BotonCurva';
      Btn.title = `${Est.Etiqueta}: ${Est.Descripcion}`;
      Btn.setAttribute('aria-label', Est.Etiqueta);
      Btn.setAttribute('aria-pressed', String(ValorActual === Est.Tipo));
      if (Deshabilitado) Btn.disabled = true;

      const SpanTexto = document.createElement('span');
      SpanTexto.textContent = Est.Abreviatura;
      Btn.append(CrearIcono(ICONO_POR_CURVA[Est.Tipo], 'IconoSvgPequeno'), SpanTexto);

      Btn.onclick = () => AlElegir(Est.Tipo);
      Grupo.appendChild(Btn);
    }
    return Grupo;
  }

  private RenderizarSinSeleccion(): void {
    const Anim = this.Contexto.Animacion;
    const Estado = this.Contexto.Estado;
    const ClavesAqui = Anim.ObtenerClavesEnTiempo(Anim.TiempoActual);

    const Tarjeta = document.createElement('div');
    Tarjeta.className = 'TarjetaInspector';

    const Titulo = document.createElement('div');
    Titulo.className = 'TituloTarjetaInspector';
    Titulo.textContent = `Cabezal en ${FormatearTiempo(Anim.TiempoActual)}`;

    const Sub = document.createElement('p');
    Sub.className = 'TextoTenue';
    Sub.textContent = ClavesAqui.length > 0
      ? `Hay ${ClavesAqui.length} clave(s) en este instante. Insertar aquí sobrescribirá sus valores.`
      : 'No hay claves exactamente en este instante. Haz clic en el timeline o usa los botones para crear.';

    Tarjeta.append(Titulo, Sub);

    const Acciones = document.createElement('div');
    Acciones.className = 'ColumnaBotones';

    const BtnPose = document.createElement('button');
    BtnPose.type = 'button';
    BtnPose.className = ClavesAqui.length > 0 ? 'BotonIconoTexto EstadoSobrescribir' : 'BotonIconoTexto BotonPrimario';
    BtnPose.append(
      CrearIcono(ClavesAqui.length > 0 ? 'keyFill' : 'key'),
      document.createTextNode(ClavesAqui.length > 0 ? ' Sobrescribir pose completa (K)' : ' Insertar pose completa (K)')
    );
    BtnPose.onclick = () => {
      if (!this.Contexto.Modelos.Vrm) {
        this.Contexto.NotificarEstado('Carga primero un modelo VRM.', 'aviso');
        return;
      }
      const Cmd = new ComandoInsertarPose(Anim, Anim.TiempoActual, Estado.InterpolacionPorDefecto);
      this.Contexto.Historial.Ejecutar(Cmd);
      this.Contexto.NotificarEstado(
        `Pose guardada: ${Cmd.Insertadas} nueva(s), ${Cmd.Sobrescritas} sobrescrita(s).`,
        'exito',
        true
      );
    };

    const Hueso = Estado.HuesoSeleccionado ?? this.Contexto.Modelos.ObtenerHuesosDisponibles()[0] ?? null;
    const BtnHueso = document.createElement('button');
    BtnHueso.type = 'button';
    BtnHueso.className = 'BotonIconoTexto';
    const PistaHueso = Hueso ? Anim.BuscarPista('HuesoRotacion', Hueso, 'Manual') : undefined;
    const TieneClaveHueso = PistaHueso ? Anim.BuscarClaveEnTiempo(PistaHueso, Anim.TiempoActual) !== undefined : false;
    if (TieneClaveHueso) BtnHueso.classList.add('EstadoSobrescribir');
    BtnHueso.disabled = !Hueso || !this.Contexto.Modelos.Vrm;
    BtnHueso.append(
      CrearIcono(TieneClaveHueso ? 'keyFill' : 'plus'),
      document.createTextNode(
        Hueso
          ? (TieneClaveHueso ? ` Sobrescribir clave: ${Hueso}` : ` Insertar clave: ${Hueso}`)
          : ' Selecciona un hueso'
      )
    );
    BtnHueso.onclick = () => {
      if (!Hueso) return;
      const Val = Anim.ObtenerValorActualObjetivo('HuesoRotacion', Hueso);
      if (!Val) return;
      const Cmd = new ComandoGuardarClave(
        Anim, 'HuesoRotacion', Hueso, 'Manual',
        Anim.TiempoActual, Val, Estado.InterpolacionPorDefecto
      );
      this.Contexto.Historial.Ejecutar(Cmd);
      const Pista = Anim.BuscarPista('HuesoRotacion', Hueso, 'Manual');
      if (Pista) Estado.SeleccionarUna(Pista.Id, Cmd.ClaveResultanteId);
      this.Contexto.NotificarEstado(
        Cmd.FueSobrescritura ? `Clave de ${Hueso} sobrescrita.` : `Clave de ${Hueso} insertada.`,
        'exito',
        true
      );
    };

    const BtnBorrarAqui = document.createElement('button');
    BtnBorrarAqui.type = 'button';
    BtnBorrarAqui.className = 'BotonIconoTexto BotonPeligro';
    BtnBorrarAqui.disabled = ClavesAqui.length === 0;
    BtnBorrarAqui.append(
      CrearIcono('trash'),
      document.createTextNode(` Eliminar ${ClavesAqui.length} clave(s) en cabezal`)
    );
    BtnBorrarAqui.onclick = () => {
      const Sel = ClavesAqui.map((Par) => ({ PistaId: Par.Pista.Id, ClaveId: Par.Clave.Id }));
      const Cmd = new ComandoEliminarClaves(Anim, Sel, Estado);
      this.Contexto.Historial.Ejecutar(Cmd);
      this.Contexto.NotificarEstado(`Eliminadas ${Cmd.ClavesEliminadas} clave(s) del instante actual.`, 'info', true);
    };

    Acciones.append(BtnPose, BtnHueso, BtnBorrarAqui);
    Tarjeta.appendChild(Acciones);
    this.Contenedor.appendChild(Tarjeta);

    // Preferencias de creación
    const TarjetaPref = document.createElement('div');
    TarjetaPref.className = 'TarjetaInspector';
    const SubTitulo = document.createElement('div');
    SubTitulo.className = 'TituloTarjetaInspector';
    SubTitulo.textContent = 'Curva por defecto para nuevas claves';

    const Selector = this.CrearSelectorCurvas(Estado.InterpolacionPorDefecto, (Tipo) => {
      Estado.InterpolacionPorDefecto = Tipo;
    });

    const FilaAuto = document.createElement('label');
    FilaAuto.className = 'EtiquetaCompacta';
    const CheckAuto = document.createElement('input');
    CheckAuto.type = 'checkbox';
    CheckAuto.checked = Estado.AutoClave;
    CheckAuto.onchange = () => { Estado.AutoClave = CheckAuto.checked; };
    FilaAuto.append(CheckAuto, document.createTextNode(' Grabación automática (Auto-Clave) al mover huesos/sliders'));

    TarjetaPref.append(SubTitulo, Selector, FilaAuto);
    this.Contenedor.appendChild(TarjetaPref);
  }

  private RenderizarClaveUnica(Pista: PistaAnimacion, Clave: ClaveAnimacion): void {
    const Anim = this.Contexto.Animacion;
    const Estado = this.Contexto.Estado;
    const Bloqueada = Boolean(Pista.Bloqueada);

    const Tarjeta = document.createElement('div');
    Tarjeta.className = 'TarjetaInspector';

    const Cabecera = document.createElement('div');
    Cabecera.className = 'CabeceraInspector';
    const Titulo = document.createElement('strong');
    Titulo.textContent = Pista.Nombre;
    const BtnIr = document.createElement('button');
    BtnIr.type = 'button';
    BtnIr.textContent = 'Ir aquí';
    BtnIr.onclick = () => {
      Anim.EstablecerTiempo(Clave.Tiempo, 'usuario');
      Anim.EvaluarEn(Clave.Tiempo);
    };
    Cabecera.append(Titulo, BtnIr);
    Tarjeta.appendChild(Cabecera);

    if (Bloqueada) {
      const Aviso = document.createElement('p');
      Aviso.className = 'TextoTenue';
      Aviso.textContent = 'Esta pista está bloqueada en la línea de tiempo.';
      Tarjeta.appendChild(Aviso);
    }

    // Campo Tiempo
    const CampoTiempo = document.createElement('div');
    CampoTiempo.className = 'CampoLinea';
    const LblT = document.createElement('label');
    LblT.textContent = 'Tiempo (s)';
    const InputT = document.createElement('input');
    InputT.type = 'number';
    InputT.step = '0.01';
    InputT.min = '0';
    InputT.max = String(Anim.Duracion);
    InputT.value = Clave.Tiempo.toFixed(3);
    InputT.disabled = Bloqueada;
    this.InputTiempoActual = InputT;
    InputT.onchange = () => {
      const NuevoT = Limitar(parseFloat(InputT.value) || 0, 0, Anim.Duracion);
      if (this.SnapshotValorActual) this.SnapshotValorActual.Tiempo = NuevoT;
      const Cmd = new ComandoModificarClave(Anim, Pista.Id, Clave.Id, { Tiempo: NuevoT });
      this.Contexto.Historial.Ejecutar(Cmd);
      this.Contexto.NotificarEstado(`Clave movida a ${FormatearTiempo(NuevoT)}.`, 'info', true);
    };
    CampoTiempo.append(LblT, InputT);
    Tarjeta.appendChild(CampoTiempo);

    // Selector visual de curva de interpolación
    const LabelCurva = document.createElement('div');
    LabelCurva.className = 'EtiquetaCompacta';
    LabelCurva.textContent = 'Interpolación hacia la siguiente clave:';
    const SelectorCurva = this.CrearSelectorCurvas(
      Clave.Interpolacion ?? 'Suave',
      (Tipo) => {
        const Cmd = new ComandoModificarClave(Anim, Pista.Id, Clave.Id, { Interpolacion: Tipo });
        this.Contexto.Historial.Ejecutar(Cmd);
      },
      Bloqueada
    );
    this.ContenedorCurvasActual = SelectorCurva;
    Tarjeta.append(LabelCurva, SelectorCurva);

    // Editor directo de valores
    const ContenedorValores = document.createElement('div');
    ContenedorValores.className = 'BloqueValoresClave';
    this.ConstruirEditoresValor(ContenedorValores, Pista, Clave, Bloqueada);
    Tarjeta.appendChild(ContenedorValores);

    // Acciones directas de sobrescritura, duplicado y borrado
    const Acciones = document.createElement('div');
    Acciones.className = 'ColumnaBotones';

    const BtnSobrescribir = document.createElement('button');
    BtnSobrescribir.type = 'button';
    BtnSobrescribir.className = 'BotonIconoTexto EstadoSobrescribir';
    BtnSobrescribir.disabled = Bloqueada;
    BtnSobrescribir.append(
      CrearIcono('keyFill'),
      document.createTextNode(' Sobrescribir con estado 3D actual')
    );
    BtnSobrescribir.onclick = () => {
      const ValorActual = Anim.ObtenerValorActualObjetivo(Pista.Tipo, Pista.Objetivo, Pista.PersonajeId);
      if (!ValorActual) {
        this.Contexto.NotificarEstado('No hay datos activos para sobrescribir este objetivo.', 'aviso');
        return;
      }
      const Cmd = new ComandoModificarClave(Anim, Pista.Id, Clave.Id, { Valor: ValorActual });
      this.Contexto.Historial.Ejecutar(Cmd);
      this.Contexto.NotificarEstado(`Clave de "${Pista.Objetivo}" sobrescrita con el estado actual.`, 'exito', true);
    };

    const FilaAcc = document.createElement('div');
    FilaAcc.className = 'FilaControles';

    const BtnDuplicar = document.createElement('button');
    BtnDuplicar.type = 'button';
    BtnDuplicar.className = 'BotonIconoTexto';
    BtnDuplicar.disabled = Bloqueada;
    BtnDuplicar.append(CrearIcono('duplicate'), document.createTextNode(' Al cabezal'));
    BtnDuplicar.onclick = () => {
      const Cmd = new ComandoGuardarClave(
        Anim, Pista.Tipo, Pista.Objetivo, Pista.Grupo,
        Anim.TiempoActual, [...Clave.Valor], Clave.Interpolacion ?? 'Suave',
        undefined, Pista.PersonajeId
      );
      this.Contexto.Historial.Ejecutar(Cmd);
      Estado.SeleccionarUna(Pista.Id, Cmd.ClaveResultanteId);
      this.Contexto.NotificarEstado(`Clave duplicada en ${FormatearTiempo(Anim.TiempoActual)}.`, 'exito', true);
    };

    const BtnEliminar = document.createElement('button');
    BtnEliminar.type = 'button';
    BtnEliminar.className = 'BotonIconoTexto BotonPeligro';
    BtnEliminar.disabled = Bloqueada;
    BtnEliminar.append(CrearIcono('trash'), document.createTextNode(' Eliminar'));
    BtnEliminar.onclick = () => {
      const Cmd = new ComandoEliminarClaves(Anim, [{ PistaId: Pista.Id, ClaveId: Clave.Id }], Estado);
      this.Contexto.Historial.Ejecutar(Cmd);
      this.Contexto.NotificarEstado('Clave eliminada.', 'info', true);
    };

    FilaAcc.append(BtnDuplicar, BtnEliminar);
    Acciones.append(BtnSobrescribir, FilaAcc);
    Tarjeta.appendChild(Acciones);

    this.Contenedor.appendChild(Tarjeta);
  }

  private ConstruirEditoresValor(
    Padre: HTMLElement,
    Pista: PistaAnimacion,
    Clave: ClaveAnimacion,
    Bloqueada: boolean
  ): void {
    const Anim = this.Contexto.Animacion;
    this.SnapshotValorActual = {
      Id: Clave.Id,
      Tiempo: Clave.Tiempo,
      Valor: [...Clave.Valor],
      Interpolacion: Clave.Interpolacion
    };
    this.EntradasValorActual = [];
    const EsRotacion = Pista.Tipo === 'HuesoRotacion';
    const Etiquetas = Clave.Valor.length === 3
      ? ['X', 'Y', 'Z']
      : [Pista.Tipo === 'Expresion' ? 'Peso (%)' : 'Valor'];

    for (let I = 0; I < Clave.Valor.length; I++) {
      const Fila = document.createElement('div');
      Fila.className = 'CampoLinea';

      const Lbl = document.createElement('label');
      Lbl.textContent = EsRotacion ? `${Etiquetas[I]} (°)` : Etiquetas[I];

      const Entrada = document.createElement('input');
      Entrada.type = 'number';
      Entrada.disabled = Bloqueada;

      if (EsRotacion) {
        Entrada.step = '1';
        Entrada.min = '-180';
        Entrada.max = '180';
      } else if (Pista.Tipo === 'Expresion') {
        Entrada.step = '1';
        Entrada.min = '0';
        Entrada.max = '100';
      } else {
        Entrada.step = '0.02';
      }
      Entrada.value = this.FormatearValorEntrada(Pista.Tipo, Clave.Valor[I]);
      this.EntradasValorActual.push({ Entrada, Tipo: Pista.Tipo });

      Entrada.oninput = () => {
        const Num = parseFloat(Entrada.value);
        if (!Number.isFinite(Num)) return;
        this.EditandoEnVivo = true;
        Clave.Valor[I] = EsRotacion ? ARadianes(Num) : Pista.Tipo === 'Expresion' ? Limitar(Num / 100, 0, 1) : Num;
        Anim.NotificarCambioPistas('edicion-valor-clave');
        Anim.EvaluarEn(Anim.TiempoActual);
      };

      Entrada.onchange = () => {
        this.EditandoEnVivo = false;
        const Num = parseFloat(Entrada.value);
        if (!Number.isFinite(Num)) return;
        const NuevoValor = [...Clave.Valor];
        NuevoValor[I] = EsRotacion ? ARadianes(Num) : Pista.Tipo === 'Expresion' ? Limitar(Num / 100, 0, 1) : Num;
        const SnapshotPrevio = this.SnapshotValorActual
          ? { ...this.SnapshotValorActual, Valor: [...this.SnapshotValorActual.Valor] }
          : undefined;
        this.SnapshotValorActual = {
          Id: Clave.Id,
          Tiempo: Clave.Tiempo,
          Valor: [...NuevoValor],
          Interpolacion: Clave.Interpolacion
        };
        const Cmd = new ComandoModificarClave(Anim, Pista.Id, Clave.Id, { Valor: NuevoValor }, SnapshotPrevio);
        this.Contexto.Historial.Ejecutar(Cmd);
      };

      Fila.append(Lbl, Entrada);
      Padre.appendChild(Fila);
    }
  }

  private RenderizarSeleccionMultiple(): void {
    const Anim = this.Contexto.Animacion;
    const Estado = this.Contexto.Estado;
    const Seleccion = Estado.SeleccionClaves;
    const PistasUnicas = new Set(Seleccion.map((S) => S.PistaId));

    const Tarjeta = document.createElement('div');
    Tarjeta.className = 'TarjetaInspector';

    const Titulo = document.createElement('div');
    Titulo.className = 'TituloTarjetaInspector';
    Titulo.textContent = `${Seleccion.length} claves seleccionadas`;

    const Sub = document.createElement('p');
    Sub.className = 'TextoTenue';
    Sub.textContent = `Distribuidas en ${PistasUnicas.size} pista(s). Arrastra para mover o usa Alt+Arrastre para duplicar.`;
    Tarjeta.append(Titulo, Sub);

    // Cambio de curva en lote
    const LblCurva = document.createElement('div');
    LblCurva.className = 'EtiquetaCompacta';
    LblCurva.textContent = 'Aplicar interpolación al lote:';
    const SelectorCurvas = this.CrearSelectorCurvas(undefined, (Tipo) => {
      const Cmd = new ComandoCambiarInterpolacionLote(Anim, [...Seleccion], Tipo);
      this.Contexto.Historial.Ejecutar(Cmd);
      this.Contexto.NotificarEstado(`Curva "${Tipo}" aplicada a ${Seleccion.length} clave(s).`, 'exito', true);
    });
    Tarjeta.append(LblCurva, SelectorCurvas);

    // Desplazamiento relativo
    const FilaDesp = document.createElement('div');
    FilaDesp.className = 'FilaControles';
    const InputDesp = document.createElement('input');
    InputDesp.type = 'number';
    InputDesp.step = '0.1';
    InputDesp.value = '0.5';
    InputDesp.style.width = '82px';
    const BtnDesp = document.createElement('button');
    BtnDesp.type = 'button';
    BtnDesp.textContent = 'Desplazar Δt (s)';
    BtnDesp.onclick = () => {
      const Delta = parseFloat(InputDesp.value) || 0;
      if (Math.abs(Delta) < 1e-4) return;
      const Movs = [];
      for (const Sel of Seleccion) {
        const Pista = Anim.Pistas.find((P) => P.Id === Sel.PistaId);
        const Clave = Pista?.Claves.find((C) => C.Id === Sel.ClaveId);
        if (Pista && Clave && !Pista.Bloqueada) {
          Movs.push({
            PistaId: Pista.Id,
            ClaveId: Clave.Id,
            TiempoAnterior: Clave.Tiempo,
            TiempoNuevo: Clave.Tiempo + Delta
          });
        }
      }
      if (Movs.length > 0) {
        const Cmd = new ComandoMoverClaves(Anim, Movs);
        this.Contexto.Historial.Ejecutar(Cmd);
        this.Contexto.NotificarEstado(`${Movs.length} clave(s) desplazadas ${Delta >= 0 ? '+' : ''}${Delta}s.`, 'info', true);
      }
    };
    FilaDesp.append(InputDesp, BtnDesp);
    Tarjeta.appendChild(FilaDesp);

    // Botones de lote
    const Acciones = document.createElement('div');
    Acciones.className = 'ColumnaBotones';

    const BtnDup = document.createElement('button');
    BtnDup.type = 'button';
    BtnDup.className = 'BotonIconoTexto';
    BtnDup.append(CrearIcono('duplicate'), document.createTextNode(' Duplicar al cabezal (Ctrl+D)'));
    BtnDup.onclick = () => {
      const Pares: Array<{ Pista: PistaAnimacion; Clave: ClaveAnimacion }> = [];
      let MinT = Infinity;
      for (const S of Seleccion) {
        const P = Anim.Pistas.find((Px) => Px.Id === S.PistaId);
        const C = P?.Claves.find((Cx) => Cx.Id === S.ClaveId);
        if (P && C) { Pares.push({ Pista: P, Clave: C }); if (C.Tiempo < MinT) MinT = C.Tiempo; }
      }
      if (Pares.length === 0) return;
      const Portapapeles = {
        TiempoOrigen: MinT,
        Claves: Pares.map(({ Pista, Clave }) => ({
          Tipo: Pista.Tipo, Objetivo: Pista.Objetivo, Grupo: Pista.Grupo,
          DeltaTiempo: Clave.Tiempo - MinT, Valor: [...Clave.Valor],
          Interpolacion: Clave.Interpolacion ?? 'Suave'
        }))
      };
      Estado.Portapapeles = Portapapeles;
      let Destino = Anim.TiempoActual;
      if (Math.abs(Destino - MinT) < 0.02) Destino = Math.min(Anim.Duracion, Destino + 0.25);
      const Cmd = new ComandoPegarClaves(Anim, Portapapeles, Destino, Estado);
      this.Contexto.Historial.Ejecutar(Cmd);
      this.Contexto.NotificarEstado(`${Cmd.ClavesPegadas.length} clave(s) duplicadas en ${FormatearTiempo(Destino)}.`, 'exito', true);
    };

    const BtnEliminar = document.createElement('button');
    BtnEliminar.type = 'button';
    BtnEliminar.className = 'BotonIconoTexto BotonPeligro';
    BtnEliminar.append(CrearIcono('trash'), document.createTextNode(` Eliminar ${Seleccion.length} clave(s)`));
    BtnEliminar.onclick = () => {
      const Cmd = new ComandoEliminarClaves(Anim, [...Seleccion], Estado);
      this.Contexto.Historial.Ejecutar(Cmd);
      this.Contexto.NotificarEstado(`Eliminadas ${Cmd.ClavesEliminadas} clave(s).`, 'info', true);
    };

    Acciones.append(BtnDup, BtnEliminar);
    Tarjeta.appendChild(Acciones);
    this.Contenedor.appendChild(Tarjeta);
  }
}

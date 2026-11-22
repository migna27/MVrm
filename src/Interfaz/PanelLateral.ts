// ============================================================================
// PanelLateral.ts — Paneles laterales del estudio organizados en pestañas
// Izquierda: Animar (Preajustes, Importación, Biblioteca) | Escena | Captura
// Derecha:   Pose (Huesos, Espejo, Claves) | Clave (InspectorClave) | Rostro
// ============================================================================

import * as THREE from 'three';
import { ContextoAplicacion } from '../Contexto';
import { CATALOGO_PREAJUSTES } from '../Nucleo/Preajustes';
import { NOMBRES_HUESOS_LEGIBLES } from '../Nucleo/GestorModelos';
import { TipoParticulas } from '../Nucleo/GestorEfectos';
import { PistaAnimacion } from '../Tipos';
import {
  ComandoEliminarClaves, ComandoGuardarClave, ComandoImportarAnimacion, ComandoLote
} from '../Arquitectura/ComandosAnimacion';
import { InspectorClave } from './Componentes/InspectorClave';
import { CrearIcono } from './Componentes/Iconos';
import {
  SeleccionarArchivo, AGrados, ARadianes, DescargarTexto, FormatearTiempo, GenerarId
} from '../Utilidades';

const HUESOS_RAPIDOS: [string, string][] = [
  ['Cabeza', 'head'],
  ['Cuello', 'neck'],
  ['Torso', 'spine'],
  ['Cadera', 'hips'],
  ['Brazo I', 'leftUpperArm'],
  ['Antebrazo I', 'leftLowerArm'],
  ['Mano I', 'leftHand'],
  ['Brazo D', 'rightUpperArm'],
  ['Antebrazo D', 'rightLowerArm'],
  ['Mano D', 'rightHand'],
  ['Muslo I', 'leftUpperLeg'],
  ['Muslo D', 'rightUpperLeg']
];

export class PanelLateral {
  public AlSolicitarImportacion?: (archivo: File) => void;

  // Controles dinámicos del inspector de pose / escena
  private SelectorHuesos!: HTMLSelectElement;
  private DeslizadoresHueso: HTMLInputElement[] = [];
  private SalidasHueso: HTMLOutputElement[] = [];
  private BotonClaveHueso!: HTMLButtonElement;
  private BotonBorrarClaveHueso!: HTMLButtonElement;
  private BotonClaveCadera!: HTMLButtonElement;
  private ContenedorExpresiones!: HTMLElement;
  private EtiquetaModelo!: HTMLElement;
  private EtiquetaAudio!: HTMLElement;
  private Inspector!: InspectorClave;
  private BadgeSeleccion!: HTMLElement;
  private BotonesClaveEfecto: Array<{ Tipo: 'Efecto' | 'Luz'; Objetivo: string; Boton: HTMLButtonElement }> = [];
  private BotonesClaveExpresion: Array<{ Expresion: string; Boton: HTMLButtonElement }> = [];
  private ChipsHuesosRapidos: Array<{ Hueso: string; Boton: HTMLButtonElement }> = [];
  private DeslizadoresGlobales: Array<{ Entrada: HTMLInputElement; Salida: HTMLOutputElement; Formato: (V: number) => string }> = [];
  private SincronizadoresEscena: Array<() => void> = [];
  private ContenedorBiblioteca: HTMLElement | null = null;
  private ArchivoVideo: File | null = null;
  private Desuscripciones: (() => void)[] = [];

  private CambiarPestanaDerecha?: (id: string) => void;

  constructor(
    private readonly RaizIzq: HTMLElement,
    private readonly RaizDer: HTMLElement,
    private readonly Contexto: ContextoAplicacion
  ) {
    this.Construir();
    this.SuscribirEventos();
  }

  public Destruir(): void {
    this.Inspector?.Destruir();
    for (const D of this.Desuscripciones) D();
    this.Desuscripciones = [];
  }

  private SuscribirEventos(): void {
    const Bus = this.Contexto.Bus;
    if (!Bus) return;
    this.Desuscripciones.push(
      Bus.Suscribir('seleccion:cambiada', (D) => {
        if (this.BadgeSeleccion) {
          this.BadgeSeleccion.textContent = String(D.seleccion.length);
          this.BadgeSeleccion.classList.toggle('Oculto', D.seleccion.length === 0);
        }
      }),
      Bus.Suscribir('pistas:cambiadas', () => this.ActualizarIndicadoresClave()),
      Bus.Suscribir('tiempo:cambiado', (D) => {
        if (D.fuente !== 'reproduccion') {
          this.ActualizarIndicadoresClave();
          this.SincronizarDeslizadoresHueso();
        }
      }),
      Bus.Suscribir('hueso:seleccionado', (D) => {
        if (D.hueso && this.SelectorHuesos.value !== D.hueso) {
          this.SelectorHuesos.value = D.hueso;
          this.SincronizarDeslizadoresHueso();
        }
        this.ActualizarChipsHuesoActivo(D.hueso);
        this.ActualizarIndicadoresClave();
      }),
      Bus.Suscribir('modelo:cargado', () => {
        this.ReiniciarDeslizadoresGlobales();
        this.RefrescarDinamico();
      }),
      Bus.Suscribir('proyecto:cargado', () => {
        this.SincronizarControlesEscena();
        this.RefrescarDinamico();
      }),
      Bus.Suscribir('audio:cambiado', () => this.ActualizarEtiquetaAudio())
    );
  }

  // --------------------------------------------------------------------------
  // Auxiliares de construcción de interfaz y pestañas accesibles
  // --------------------------------------------------------------------------

  private CrearSistemaPestanas(
    Raiz: HTMLElement,
    Prefijo: string,
    Definiciones: Array<{ Id: string; Titulo: string; ConBadge?: boolean }>
  ): { Paneles: Record<string, HTMLElement>; Activar: (id: string) => void } {
    Raiz.innerHTML = '';

    const Barra = document.createElement('div');
    Barra.className = 'BarraPestanas';
    Barra.setAttribute('role', 'tablist');

    const Cuerpo = document.createElement('div');
    Cuerpo.className = 'CuerpoPestanas';

    const Botones: HTMLButtonElement[] = [];
    const Paneles: Record<string, HTMLElement> = {};

    const Activar = (IdObjetivo: string) => {
      for (let I = 0; I < Definiciones.length; I++) {
        const Def = Definiciones[I];
        const Activa = Def.Id === IdObjetivo;
        Botones[I].setAttribute('aria-selected', String(Activa));
        Botones[I].tabIndex = Activa ? 0 : -1;
        Paneles[Def.Id].classList.toggle('Oculto', !Activa);
      }
    };

    Definiciones.forEach((Def, Indice) => {
      const TabId = `${Prefijo}-tab-${Def.Id}`;
      const PanelId = `${Prefijo}-panel-${Def.Id}`;

      const Btn = document.createElement('button');
      Btn.type = 'button';
      Btn.id = TabId;
      Btn.setAttribute('role', 'tab');
      Btn.setAttribute('aria-controls', PanelId);
      Btn.setAttribute('aria-selected', String(Indice === 0));
      Btn.tabIndex = Indice === 0 ? 0 : -1;
      Btn.appendChild(document.createTextNode(Def.Titulo));

      if (Def.ConBadge) {
        const Badge = document.createElement('span');
        Badge.className = 'BadgePestana Oculto';
        Badge.textContent = '0';
        this.BadgeSeleccion = Badge;
        Btn.appendChild(Badge);
      }

      Btn.onclick = () => Activar(Def.Id);
      Btn.addEventListener('keydown', (E) => {
        if (E.key !== 'ArrowRight' && E.key !== 'ArrowLeft') return;
        E.preventDefault();
        const Dir = E.key === 'ArrowRight' ? 1 : -1;
        const Sig = (Indice + Dir + Definiciones.length) % Definiciones.length;
        Activar(Definiciones[Sig].Id);
        Botones[Sig].focus();
      });

      const Panel = document.createElement('section');
      Panel.id = PanelId;
      Panel.className = 'PanelCuerpoTab' + (Indice === 0 ? '' : ' Oculto');
      Panel.setAttribute('role', 'tabpanel');
      Panel.setAttribute('aria-labelledby', TabId);

      Botones.push(Btn);
      Paneles[Def.Id] = Panel;
      Barra.appendChild(Btn);
      Cuerpo.appendChild(Panel);
    });

    Raiz.append(Barra, Cuerpo);
    return { Paneles, Activar };
  }

  private Seccion(Padre: HTMLElement, Titulo: string, Abierta = false): HTMLElement {
    const Detalles = document.createElement('details');
    Detalles.open = Abierta;
    const Resumen = document.createElement('summary');
    Resumen.textContent = Titulo;
    const Cuerpo = document.createElement('div');
    Cuerpo.className = 'CuerpoSeccion';
    Detalles.append(Resumen, Cuerpo);
    Padre.appendChild(Detalles);
    return Cuerpo;
  }

  private Boton(Etiqueta: string, AlClick: () => void, Clase = ''): HTMLButtonElement {
    const B = document.createElement('button');
    B.type = 'button';
    B.textContent = Etiqueta;
    if (Clase) B.className = Clase;
    B.onclick = AlClick;
    return B;
  }

  private Deslizador(
    Padre: HTMLElement,
    Etiqueta: string,
    Min: number,
    Max: number,
    Paso: number,
    Valor: number,
    AlCambiar: (V: number) => void,
    Formato: (V: number) => string = (V) => V.toFixed(2),
    OpcionesClave?: {
      AlKeyframe: (V: number) => void;
      RegistrarBoton?: (Btn: HTMLButtonElement) => void;
      AlFinalizarCambio?: (V: number) => void;
    },
    OpcionesDrag?: { Tipo: 'Efecto' | 'Luz'; Objetivo: string }
  ): { Entrada: HTMLInputElement; Salida: HTMLOutputElement } {
    const Grupo = document.createElement('div');
    Grupo.className = OpcionesClave ? 'GrupoDeslizador GrupoDeslizadorConClave' : 'GrupoDeslizador';

    if (OpcionesDrag) {
      Grupo.draggable = true;
      Grupo.title = 'Arrastra este control a la línea de tiempo para crear un clip con transición.';
      Grupo.ondragstart = (e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('animador/arrastrar-efecto', JSON.stringify({
            Tipo: OpcionesDrag.Tipo,
            Objetivo: OpcionesDrag.Objetivo,
            ValorBase: parseFloat(Entrada.value)
          }));
          e.dataTransfer.effectAllowed = 'copy';
        }
      };
    }

    const L = document.createElement('label');
    L.textContent = Etiqueta;
    if (OpcionesDrag) L.style.cursor = 'grab';

    const Entrada = document.createElement('input');
    Entrada.type = 'range';
    Entrada.min = String(Min);
    Entrada.max = String(Max);
    Entrada.step = String(Paso);
    Entrada.value = String(Valor);

    const Salida = document.createElement('output');
    Salida.textContent = Formato(Valor);

    Entrada.oninput = () => {
      const V = parseFloat(Entrada.value);
      Salida.textContent = Formato(V);
      AlCambiar(V);
    };

    if (OpcionesClave?.AlFinalizarCambio) {
      Entrada.onchange = () => {
        OpcionesClave.AlFinalizarCambio?.(parseFloat(Entrada.value));
      };
    }

    Grupo.append(L, Entrada, Salida);

    if (OpcionesClave) {
      const BtnClave = document.createElement('button');
      BtnClave.type = 'button';
      BtnClave.className = 'BotonIconoSolo';
      BtnClave.title = 'Insertar o sobrescribir clave en el tiempo actual';
      BtnClave.setAttribute('aria-label', `Clave para ${Etiqueta}`);
      BtnClave.appendChild(CrearIcono('key', 'IconoSvgPequeno'));
      BtnClave.onclick = () => OpcionesClave.AlKeyframe(parseFloat(Entrada.value));
      OpcionesClave.RegistrarBoton?.(BtnClave);
      Grupo.appendChild(BtnClave);
    }

    Padre.appendChild(Grupo);
    return { Entrada, Salida };
  }

  private Casilla(Padre: HTMLElement, Etiqueta: string, Valor: boolean, AlCambiar: (V: boolean) => void): HTMLInputElement {
    const L = document.createElement('label');
    L.className = 'EtiquetaCompacta';
    const Entrada = document.createElement('input');
    Entrada.type = 'checkbox';
    Entrada.checked = Valor;
    Entrada.onchange = () => AlCambiar(Entrada.checked);
    L.append(Entrada, document.createTextNode(' ' + Etiqueta));
    Padre.appendChild(L);
    return Entrada;
  }

  private Nota(Padre: HTMLElement, Texto: string): void {
    const P = document.createElement('p');
    P.className = 'TextoTenue';
    P.textContent = Texto;
    Padre.appendChild(P);
  }

  private EtiquetaArchivo(Padre: HTMLElement): HTMLElement {
    const P = document.createElement('p');
    P.className = 'NombreArchivo';
    P.textContent = 'Ningún archivo cargado';
    Padre.appendChild(P);
    return P;
  }

  // --------------------------------------------------------------------------
  // Construcción de paneles con pestañas
  // --------------------------------------------------------------------------

  private Construir(): void {
    const Izq = this.CrearSistemaPestanas(this.RaizIzq, 'izq', [
      { Id: 'animar', Titulo: 'Animar' },
      { Id: 'escena', Titulo: 'Escena' },
      { Id: 'captura', Titulo: 'Captura' }
    ]);

    this.ConstruirSeccionBiblioteca(Izq.Paneles.animar);
    this.ConstruirSeccionEscena(Izq.Paneles.escena);
    this.ConstruirSeccionEfectos(Izq.Paneles.escena);
    this.ConstruirSeccionCamara(Izq.Paneles.escena);
    this.ConstruirSeccionAudio(Izq.Paneles.escena);
    this.ConstruirSeccionSeguimiento(Izq.Paneles.captura);
    this.ConstruirSeccionVMC(Izq.Paneles.captura);

    const Der = this.CrearSistemaPestanas(this.RaizDer, 'der', [
      { Id: 'pose', Titulo: 'Pose' },
      { Id: 'clave', Titulo: 'Clave', ConBadge: true },
      { Id: 'rostro', Titulo: 'Rostro' }
    ]);
    this.CambiarPestanaDerecha = Der.Activar;

    this.ConstruirSeccionModelo(Der.Paneles.pose);
    this.ConstruirSeccionTransformacionGlobal(Der.Paneles.pose);

    const ContenedorInspector = document.createElement('div');
    Der.Paneles.clave.appendChild(ContenedorInspector);
    this.Inspector = new InspectorClave(ContenedorInspector, this.Contexto);

    this.ConstruirSeccionExpresiones(Der.Paneles.rostro);
  }

  public AbrirInspectorClave(): void {
    this.CambiarPestanaDerecha?.('clave');
  }

  // -------- Pestaña Pose (Modelo y Huesos) --------
  private ConstruirSeccionModelo(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Modelo y Esqueleto VRM', true);
    const Ctx = this.Contexto;

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    Fila.append(
      this.Boton('Cargar VRM…', async () => {
        const Archivo = await SeleccionarArchivo('.vrm');
        if (Archivo) await this.CargarModelo(Archivo);
      }, 'BotonPrimario'),
      this.Boton('Cargar ejemplo', async () => {
        Ctx.NotificarEstado('Descargando modelo de ejemplo…');
        try {
          await Ctx.Modelos.CargarVrmDesdeUrl(
            'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/three-vrm-girl.vrm'
          );
          this.TrasCargarModelo();
        } catch (E) { Ctx.NotificarEstado(`Error: ${(E as Error).message}`, 'error'); }
      })
    );
    Cuerpo.appendChild(Fila);
    this.EtiquetaModelo = this.EtiquetaArchivo(Cuerpo);

    const Fila2 = document.createElement('div');
    Fila2.className = 'FilaControles';
    Fila2.append(
      this.Boton('Restablecer pose', () => {
        Ctx.Modelos.RestablecerPose();
        this.SincronizarDeslizadoresHueso();
      }),
      this.Boton('Espejar L↔R', () => {
        if (Ctx.Animacion.EspejarPoseActual()) {
          this.SincronizarDeslizadoresHueso();
          Ctx.NotificarEstado('Pose espejada horizontalmente.', 'info');
        }
      }),
      this.Boton('Fijar reposo', () => {
        Ctx.Modelos.GuardarPoseReposo();
        Ctx.NotificarEstado('Pose actual guardada como pose de reposo.', 'exito');
      }),
      this.Boton('💾 Guardar pose (.json)', () => { void this.GuardarPoseJson(); })
    );
    Cuerpo.appendChild(Fila2);
    this.Casilla(Cuerpo, 'Mostrar esqueleto auxiliar', false, (V) => Ctx.Modelos.AlternarAyudante(V));

    // Chips rápidos de selección anatómica
    const ChipsHuesos = document.createElement('div');
    ChipsHuesos.className = 'ChipsFiltroGrupo';
    this.ChipsHuesosRapidos = [];
    for (const [Etiqueta, Hueso] of HUESOS_RAPIDOS) {
      const Chip = this.Boton(Etiqueta, () => {
        if (!Ctx.Modelos.Vrm) {
          Ctx.NotificarEstado('Carga primero un modelo VRM para seleccionar huesos.', 'aviso');
          return;
        }
        this.SeleccionarHueso(Hueso);
        Ctx.Estado.HuesoSeleccionado = Hueso;
        this.ActualizarChipsHuesoActivo(Hueso);
        const Nodo = Ctx.Modelos.ObtenerNodoHueso(Hueso);
        if (Nodo) Ctx.Escena.ControlTransformacion.attach(Nodo);
      }, 'ChipFiltro');
      Chip.setAttribute('aria-pressed', 'false');
      this.ChipsHuesosRapidos.push({ Hueso, Boton: Chip });
      ChipsHuesos.appendChild(Chip);
    }
    Cuerpo.appendChild(ChipsHuesos);

    this.SelectorHuesos = document.createElement('select');
    this.SelectorHuesos.setAttribute('aria-label', 'Hueso seleccionado');
    this.SelectorHuesos.onchange = () => {
      const Hueso = this.SelectorHuesos.value || null;
      Ctx.Estado.HuesoSeleccionado = Hueso;
      this.ActualizarChipsHuesoActivo(Hueso);
      this.SincronizarDeslizadoresHueso();
    };
    Cuerpo.appendChild(this.SelectorHuesos);

    this.DeslizadoresHueso = [];
    this.SalidasHueso = [];
    for (let Eje = 0; Eje < 3; Eje++) {
      const NombreEje = ['Rotación X', 'Rotación Y', 'Rotación Z'][Eje];
      const { Entrada, Salida } = this.Deslizador(
        Cuerpo, NombreEje, -180, 180, 1, 0,
        () => this.AplicarRotacionDesdeDeslizadores(),
        (V) => `${V.toFixed(0)}°`,
        {
          AlKeyframe: () => this.GuardarClaveHuesoActivo(),
          AlFinalizarCambio: () => {
            if (Ctx.Estado.AutoClave) this.GuardarClaveHuesoActivo(true);
          }
        }
      );
      this.DeslizadoresHueso.push(Entrada);
      this.SalidasHueso.push(Salida);
    }

    const Fila3 = document.createElement('div');
    Fila3.className = 'FilaControles';

    this.BotonClaveHueso = this.Boton('◆ Clave rotación', () => this.GuardarClaveHuesoActivo(), 'BotonPrimario');
    this.BotonBorrarClaveHueso = this.Boton('🗑 Borrar aquí', () => {
      const Nombre = this.SelectorHuesos.value;
      if (!Nombre) return;
      const Pista = Ctx.Animacion.BuscarPista('HuesoRotacion', Nombre, 'Manual');
      const Clave = Pista ? Ctx.Animacion.BuscarClaveEnTiempo(Pista, Ctx.Animacion.TiempoActual) : undefined;
      if (!Pista || !Clave) return;
      Ctx.Historial.Ejecutar(new ComandoEliminarClaves(Ctx.Animacion, [{ PistaId: Pista.Id, ClaveId: Clave.Id }], Ctx.Estado));
      Ctx.NotificarEstado(`Clave de ${Nombre} eliminada.`, 'info', true);
    }, 'BotonPeligro');

    this.BotonClaveCadera = this.Boton('◆ Posición cadera', () => {
      if (!Ctx.Modelos.Vrm) return;
      const Pos = Ctx.Modelos.ObtenerPosicionHueso('hips');
      const Cmd = new ComandoGuardarClave(
        Ctx.Animacion, 'HuesoPosicion', 'hips', 'Manual',
        Ctx.Animacion.TiempoActual, [Pos.x, Pos.y, Pos.z], Ctx.Estado.InterpolacionPorDefecto
      );
      Ctx.Historial.Ejecutar(Cmd);
      const Pista = Ctx.Animacion.BuscarPista('HuesoPosicion', 'hips', 'Manual');
      if (Pista) Ctx.Estado.SeleccionarUna(Pista.Id, Cmd.ClaveResultanteId);
      Ctx.NotificarEstado(
        Cmd.FueSobrescritura ? 'Clave de posición cadera sobrescrita.' : 'Clave de posición cadera insertada.',
        'exito', true
      );
    });

    Fila3.append(this.BotonClaveHueso, this.BotonBorrarClaveHueso, this.BotonClaveCadera);
    Cuerpo.appendChild(Fila3);
    this.Nota(Cuerpo, 'Haz clic directo en el modelo 3D para posar. Atajos: Q soltar, W mover, E rotar, R local/mundo, K pose.');
  }

  private GuardarClaveHuesoActivo(Silencioso = false): void {
    const Ctx = this.Contexto;
    const Nombre = this.SelectorHuesos.value;
    if (!Nombre || !Ctx.Modelos.Vrm) return;
    const Euler = Ctx.Modelos.ObtenerRotacionHueso(Nombre);
    const Cmd = new ComandoGuardarClave(
      Ctx.Animacion, 'HuesoRotacion', Nombre, 'Manual',
      Ctx.Animacion.TiempoActual, [Euler.x, Euler.y, Euler.z], Ctx.Estado.InterpolacionPorDefecto
    );
    Ctx.Historial.Ejecutar(Cmd);
    const Pista = Ctx.Animacion.BuscarPista('HuesoRotacion', Nombre, 'Manual');
    if (Pista && !Silencioso) Ctx.Estado.SeleccionarUna(Pista.Id, Cmd.ClaveResultanteId);
    if (!Silencioso) {
      Ctx.NotificarEstado(
        Cmd.FueSobrescritura
          ? `Sobrescrita clave de ${NOMBRES_HUESOS_LEGIBLES[Nombre] ?? Nombre} en ${FormatearTiempo(Ctx.Animacion.TiempoActual)}.`
          : `Clave insertada para ${NOMBRES_HUESOS_LEGIBLES[Nombre] ?? Nombre}.`,
        'exito', true
      );
    }
  }

  private async CargarModelo(Archivo: File): Promise<void> {
    const Ctx = this.Contexto;
    Ctx.NotificarEstado(`Cargando ${Archivo.name}…`);
    try {
      await Ctx.Modelos.CargarVrm(Archivo);
      this.TrasCargarModelo();
    } catch (E) {
      Ctx.NotificarEstado(`Error al cargar: ${(E as Error).message}`, 'error');
    }
  }

  private TrasCargarModelo(): void {
    const Ctx = this.Contexto;
    Ctx.Escena.ControlTransformacion.detach();
    this.EtiquetaModelo.textContent = `Modelo: ${Ctx.Modelos.NombreModelo}`;
    this.ActualizarListaHuesos();
    this.ActualizarExpresiones();
    Ctx.Bus?.Emitir('modelo:cargado', { nombre: Ctx.Modelos.NombreModelo });
    Ctx.NotificarEstado('Modelo listo. Usa la biblioteca, posa en 3D o importa una animación.', 'exito');
  }

  public ActualizarListaHuesos(): void {
    this.SelectorHuesos.innerHTML = '';
    for (const Nombre of this.Contexto.Modelos.ObtenerHuesosDisponibles()) {
      const Opcion = document.createElement('option');
      Opcion.value = Nombre;
      Opcion.textContent = NOMBRES_HUESOS_LEGIBLES[Nombre] ?? Nombre;
      this.SelectorHuesos.appendChild(Opcion);
    }
    this.SincronizarDeslizadoresHueso();
  }

  public SeleccionarHueso(Nombre: string): void {
    if (this.SelectorHuesos.value !== Nombre) {
      this.SelectorHuesos.value = Nombre;
      this.SincronizarDeslizadoresHueso();
    }
    this.ActualizarChipsHuesoActivo(Nombre);
  }

  private ActualizarChipsHuesoActivo(HuesoActivo: string | null): void {
    for (const Item of this.ChipsHuesosRapidos) {
      Item.Boton.setAttribute('aria-pressed', String(Item.Hueso === HuesoActivo));
    }
  }

  private async GuardarPoseJson(): Promise<void> {
    const Ctx = this.Contexto;
    if (!Ctx.Modelos.Vrm) {
      Ctx.NotificarEstado('Carga primero un modelo VRM para exportar su pose.', 'aviso');
      return;
    }

    const Pistas: PistaAnimacion[] = [];
    for (const Hueso of Ctx.Modelos.ObtenerHuesosDisponibles()) {
      const Rot = Ctx.Modelos.ObtenerRotacionHueso(Hueso);
      if (Math.abs(Rot.x) + Math.abs(Rot.y) + Math.abs(Rot.z) > 0.002) {
        Pistas.push({
          Id: GenerarId(),
          Nombre: `Pose · ${NOMBRES_HUESOS_LEGIBLES[Hueso] ?? Hueso}`,
          Tipo: 'HuesoRotacion',
          Objetivo: Hueso,
          Grupo: 'Manual',
          Claves: [{
            Id: GenerarId(),
            Tiempo: 0,
            Valor: [Rot.x, Rot.y, Rot.z],
            Interpolacion: Ctx.Estado.InterpolacionPorDefecto
          }]
        });
      }
    }

    const PosCadera = Ctx.Modelos.ObtenerPosicionHueso('hips');
    if (PosCadera.lengthSq() > 0.0001) {
      Pistas.push({
        Id: GenerarId(),
        Nombre: 'Pose · Posición cadera',
        Tipo: 'HuesoPosicion',
        Objetivo: 'hips',
        Grupo: 'Manual',
        Claves: [{
          Id: GenerarId(),
          Tiempo: 0,
          Valor: [PosCadera.x, PosCadera.y, PosCadera.z],
          Interpolacion: Ctx.Estado.InterpolacionPorDefecto
        }]
      });
    }

    for (const Exp of Ctx.Modelos.ObtenerExpresiones()) {
      const Val = Ctx.Modelos.ObtenerValorExpresion(Exp);
      if (Val > 0.005) {
        Pistas.push({
          Id: GenerarId(),
          Nombre: `Pose · ${Exp}`,
          Tipo: 'Expresion',
          Objetivo: Exp,
          Grupo: 'Manual',
          Claves: [{
            Id: GenerarId(),
            Tiempo: 0,
            Valor: [Val],
            Interpolacion: Ctx.Estado.InterpolacionPorDefecto
          }]
        });
      }
    }

    if (Pistas.length === 0) {
      Ctx.NotificarEstado('La pose está en reposo; ajusta huesos o expresiones antes de guardar.', 'aviso');
      return;
    }

    const Base = (Ctx.Modelos.NombreModelo || 'Pose').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_');
    const NombreArchivo = `${Base}_Pose.json`;
    const Contenido = JSON.stringify({ Version: 1, Duracion: 0.5, Pistas }, null, 2);
    DescargarTexto(Contenido, NombreArchivo);

    try {
      const Form = new FormData();
      Form.append('file', new File([Contenido], NombreArchivo, { type: 'application/json' }));
      Form.append('category', 'poses');
      const Res = await fetch('/api/upload', { method: 'POST', body: Form });
      if (Res.ok) this.RefrescarBibliotecaLocal();
    } catch {
      // Operación offline / build estático
    }

    Ctx.NotificarEstado(`Pose exportada (${Pistas.length} pistas) en "${NombreArchivo}".`, 'exito');
  }

  public SincronizarDeslizadoresHueso(): void {
    const Nombre = this.SelectorHuesos.value;
    if (!Nombre) return;
    const Euler = this.Contexto.Modelos.ObtenerRotacionHueso(Nombre);
    const Valores = [Euler.x, Euler.y, Euler.z];
    this.DeslizadoresHueso.forEach((Entrada, I) => {
      const Grados = AGrados(Valores[I]);
      Entrada.value = String(Grados);
      this.SalidasHueso[I].textContent = `${Grados.toFixed(0)}°`;
    });
  }

  private AplicarRotacionDesdeDeslizadores(): void {
    const Nombre = this.SelectorHuesos.value;
    if (!Nombre) return;
    const [X, Y, Z] = this.DeslizadoresHueso.map((E) => ARadianes(parseFloat(E.value)));
    this.Contexto.Modelos.EstablecerRotacionHueso(Nombre, new THREE.Euler(X, Y, Z));
  }

  private ConstruirSeccionTransformacionGlobal(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Posición y Rotación Global', false);
    const Ctx = this.Contexto;
    this.Nota(Cuerpo, 'Mueve o rota al personaje completo dentro del escenario.');
    this.DeslizadoresGlobales = [];

    const DeslizadoresPos: HTMLInputElement[] = [];
    const SincronizarPosicion = () => {
      if (!Ctx.Modelos.Vrm) return;
      Ctx.Modelos.Vrm.scene.position.set(
        parseFloat(DeslizadoresPos[0].value),
        parseFloat(DeslizadoresPos[1].value),
        parseFloat(DeslizadoresPos[2].value)
      );
    };

    for (const Eje of ['X Lateral', 'Y Altura', 'Z Profundidad']) {
      const FormatoM = (V: number) => `${V.toFixed(2)}m`;
      const Ctrl = this.Deslizador(Cuerpo, Eje, -10, 10, 0.05, 0, SincronizarPosicion, FormatoM);
      DeslizadoresPos.push(Ctrl.Entrada);
      this.DeslizadoresGlobales.push({ ...Ctrl, Formato: FormatoM });
    }

    const FormatoDeg = (V: number) => `${V.toFixed(0)}°`;
    const CtrlRot = this.Deslizador(
      Cuerpo, 'Girar Personaje', -180, 180, 1, 0,
      (V) => { if (Ctx.Modelos.Vrm) Ctx.Modelos.Vrm.scene.rotation.y = V * Math.PI / 180; },
      FormatoDeg
    );
    this.DeslizadoresGlobales.push({ ...CtrlRot, Formato: FormatoDeg });

    Cuerpo.appendChild(this.Boton('Restablecer al centro', () => {
      DeslizadoresPos.forEach((d) => { d.value = '0'; d.dispatchEvent(new Event('input')); });
      CtrlRot.Entrada.value = '0';
      CtrlRot.Entrada.dispatchEvent(new Event('input'));
    }));
  }

  private ReiniciarDeslizadoresGlobales(): void {
    for (const Item of this.DeslizadoresGlobales) {
      Item.Entrada.value = '0';
      Item.Salida.textContent = Item.Formato(0);
    }
  }

  // -------- Pestaña Rostro (Expresiones faciales) --------
  private ConstruirSeccionExpresiones(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Expresiones Faciales', true);
    this.ContenedorExpresiones = document.createElement('div');
    this.ContenedorExpresiones.className = 'ColumnaBotones';
    Cuerpo.appendChild(this.ContenedorExpresiones);

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    Fila.append(
      this.Boton('◆ Claves de expresión', () => {
        const Ctx = this.Contexto;
        const Sub = [];
        for (const Nombre of Ctx.Modelos.ObtenerExpresiones()) {
          const Peso = Ctx.Modelos.ObtenerValorExpresion(Nombre);
          const PistaExist = Ctx.Animacion.BuscarPista('Expresion', Nombre, 'Manual');
          if (Peso > 0.001 || (PistaExist && Ctx.Animacion.BuscarClaveEnTiempo(PistaExist, Ctx.Animacion.TiempoActual))) {
            Sub.push(new ComandoGuardarClave(
              Ctx.Animacion, 'Expresion', Nombre, 'Manual',
              Ctx.Animacion.TiempoActual, [Peso], Ctx.Estado.InterpolacionPorDefecto
            ));
          }
        }
        if (Sub.length > 0) {
          Ctx.Historial.Ejecutar(new ComandoLote('Claves de expresiones faciales', Sub));
          Ctx.NotificarEstado(`${Sub.length} clave(s) de expresión guardadas.`, 'exito', true);
        }
      }, 'BotonPrimario'),
      this.Boton('Limpiar rostro', () => this.Contexto.Modelos.LimpiarExpresiones())
    );
    Cuerpo.appendChild(Fila);
    this.ActualizarExpresiones();
  }

  public ActualizarExpresiones(): void {
    this.ContenedorExpresiones.innerHTML = '';
    this.BotonesClaveExpresion = [];
    const Ctx = this.Contexto;
    const Expresiones = Ctx.Modelos.ObtenerExpresiones();
    if (Expresiones.length === 0) {
      this.Nota(this.ContenedorExpresiones, 'Carga un modelo VRM para ver y animar sus expresiones.');
      return;
    }

    for (const Nombre of Expresiones) {
      const GuardarExp = (Val: number, Silencioso = false) => {
        const Cmd = new ComandoGuardarClave(
          Ctx.Animacion, 'Expresion', Nombre, 'Manual',
          Ctx.Animacion.TiempoActual, [Val], Ctx.Estado.InterpolacionPorDefecto
        );
        Ctx.Historial.Ejecutar(Cmd);
        if (!Silencioso) {
          Ctx.NotificarEstado(
            Cmd.FueSobrescritura ? `Expresión "${Nombre}" sobrescrita.` : `Clave de "${Nombre}" añadida.`,
            'exito', true
          );
        }
      };

      this.Deslizador(
        this.ContenedorExpresiones, Nombre, 0, 1, 0.01,
        Ctx.Modelos.ObtenerValorExpresion(Nombre),
        (V) => Ctx.Modelos.EstablecerExpresion(Nombre, V),
        (V) => `${Math.round(V * 100)}%`,
        {
          AlKeyframe: (V) => GuardarExp(V),
          AlFinalizarCambio: (V) => { if (Ctx.Estado.AutoClave) GuardarExp(V, true); },
          RegistrarBoton: (Btn) => this.BotonesClaveExpresion.push({ Expresion: Nombre, Boton: Btn })
        }
      );
    }
    this.ActualizarIndicadoresClave();
  }

  // -------- Pestaña Animar (Preajustes, Importación y Biblioteca Local) --------
  private ConstruirSeccionBiblioteca(Padre: HTMLElement): void {
    const Ctx = this.Contexto;
    const CuerpoPre = this.Seccion(Padre, 'Preajustes Rápidos', true);

    const Filtros = document.createElement('div');
    Filtros.className = 'ChipsFiltroGrupo';
    const Rejilla = document.createElement('div');
    Rejilla.className = 'RejillaBotones';

    const RenderPreajustes = (Cat: string) => {
      Rejilla.innerHTML = '';
      for (const Pre of CATALOGO_PREAJUSTES) {
        const PistasPreview = Pre.Generar(0);
        const EsPose = Pre.Duracion <= 1 && PistasPreview.every((P) => P.Claves.length <= 1);
        const EsRostro = PistasPreview.every((P) => P.Tipo === 'Expresion');
        if (Cat === 'poses' && !EsPose) continue;
        if (Cat === 'ciclos' && (EsPose || EsRostro)) continue;
        if (Cat === 'rostro' && !EsRostro) continue;

        const B = this.Boton(Pre.Nombre, () => {
          if (!Ctx.Modelos.Vrm) {
            Ctx.NotificarEstado('Carga primero un modelo VRM.', 'aviso');
            return;
          }
          const Pistas = Pre.Generar(Ctx.Animacion.TiempoActual);
          const Cmd = new ComandoImportarAnimacion(
            Ctx.Animacion,
            Pistas,
            {
              TiempoInicio: Ctx.Animacion.TiempoActual,
              Modo: 'Combinar',
              EscalaTiempo: 1,
              FpsMuestreo: 24,
              Simplificar: false,
              ToleranciaSimplificacion: 0.015,
              GrupoDestino: 'Preajuste'
            },
            Pre.Duracion,
            Pre.Nombre
          );
          Ctx.Historial.Ejecutar(Cmd);
          const EntradaDur = document.getElementById('EntradaDuracion') as HTMLInputElement | null;
          if (EntradaDur) EntradaDur.value = String(Ctx.Animacion.Duracion);
          Ctx.NotificarEstado(
            `Preajuste "${Pre.Nombre}" insertado en ${FormatearTiempo(Ctx.Animacion.TiempoActual)}.`,
            'exito', true
          );
        });
        B.title = `${Pre.Descripcion} (${Pre.Duracion}s)`;
        Rejilla.appendChild(B);
      }
    };

    const Categorias: [string, string][] = [
      ['todos', 'Todos'], ['poses', 'Poses'], ['ciclos', 'Ciclos'], ['rostro', 'Rostro']
    ];
    let CatActiva = 'todos';
    const ChipsCat: HTMLButtonElement[] = [];
    for (const [Id, Etq] of Categorias) {
      const Chip = this.Boton(Etq, () => {
        CatActiva = Id;
        ChipsCat.forEach((C, idx) => C.setAttribute('aria-pressed', String(Categorias[idx][0] === CatActiva)));
        RenderPreajustes(CatActiva);
      }, 'ChipFiltro');
      Chip.setAttribute('aria-pressed', String(Id === 'todos'));
      ChipsCat.push(Chip);
      Filtros.appendChild(Chip);
    }

    RenderPreajustes('todos');
    CuerpoPre.append(Filtros, Rejilla);

    const CuerpoImp = this.Seccion(Padre, 'Importar / Exportar Animaciones', true);
    const FilaImp = document.createElement('div');
    FilaImp.className = 'FilaControles';

    const BtnImportar = this.Boton('⬇ Importar (.vrma/.bvh/.glb/.json)…', async () => {
      const Archivo = await SeleccionarArchivo('.vrma,.bvh,.glb,.gltf,.json');
      if (!Archivo) return;
      if (this.AlSolicitarImportacion) {
        this.AlSolicitarImportacion(Archivo);
      }
    }, 'BotonPrimario');

    const BtnExportarJson = this.Boton('Exportar JSON', () => {
      DescargarTexto(Ctx.Animacion.ExportarJSON(), 'AnimacionVRM.json');
    });

    FilaImp.append(BtnImportar, BtnExportarJson);
    CuerpoImp.appendChild(FilaImp);
    this.Nota(CuerpoImp, 'Asistente con punto de inserción, velocidad, modo de fusión/sobrescritura y optimización automática de keyframes.');

    const CuerpoLib = this.Seccion(Padre, 'Biblioteca Local', false);
    const ContenedorNavegador = document.createElement('div');
    this.ContenedorBiblioteca = ContenedorNavegador;
    CuerpoLib.appendChild(ContenedorNavegador);
    void this.ConstruirNavegadorArchivos(ContenedorNavegador);
  }

  public RefrescarBibliotecaLocal(): void {
    if (this.ContenedorBiblioteca) {
      void this.ConstruirNavegadorArchivos(this.ContenedorBiblioteca);
    }
  }

  private async ConstruirNavegadorArchivos(Contenedor: HTMLElement): Promise<void> {
    const Ctx = this.Contexto;
    try {
      const Res = await fetch('/api/library');
      if (!Res.ok) return;
      const Libreria = await Res.json();

      const CrearLista = (Titulo: string, Archivos: any[], AlHacerClic: (Ruta: string, Nombre: string) => void) => {
        if (!Archivos || Archivos.length === 0) return;
        const TituloElem = document.createElement('h3');
        TituloElem.className = 'TituloSubLista';
        TituloElem.textContent = Titulo;
        Contenedor.appendChild(TituloElem);

        const Lista = document.createElement('div');
        Lista.className = 'ColumnaBotones';
        for (const Arch of Archivos) {
          const Item = this.Boton((Arch.isUser ? '👤 ' : '📦 ') + Arch.name, () => AlHacerClic(Arch.path, Arch.name), 'ItemBiblioteca');
          Lista.appendChild(Item);
        }
        Contenedor.appendChild(Lista);
      };

      Contenedor.innerHTML = '';

      CrearLista('Modelos (.vrm)', Libreria.models, async (Ruta, Nombre) => {
        Ctx.NotificarEstado(`Cargando modelo ${Nombre}…`);
        try {
          const ResUrl = await fetch(Ruta);
          const Archivo = new File([await ResUrl.blob()], Nombre);
          await Ctx.Modelos.CargarVrm(Archivo);
          this.TrasCargarModelo();
        } catch (E) { Ctx.NotificarEstado(`Error: ${(E as Error).message}`, 'error'); }
      });

      CrearLista('Animaciones (.vrma)', Libreria.animations, async (Ruta, Nombre) => {
        try {
          const ResUrl = await fetch(Ruta);
          const Archivo = new File([await ResUrl.blob()], Nombre);
          this.AlSolicitarImportacion?.(Archivo);
        } catch (E) { Ctx.NotificarEstado(`Error: ${(E as Error).message}`, 'error'); }
      });

      CrearLista('Poses (.json)', Libreria.poses, async (Ruta, Nombre) => {
        try {
          const ResUrl = await fetch(Ruta);
          const Archivo = new File([await ResUrl.blob()], Nombre);
          this.AlSolicitarImportacion?.(Archivo);
        } catch (E) { Ctx.NotificarEstado(`Error: ${(E as Error).message}`, 'error'); }
      });
    } catch {
      // Ignorar si no hay backend local activo (build estático)
    }
  }

  // -------- Pestaña Escena (Fondo, Efectos, Cámara, Audio) --------
  private ConstruirSeccionEscena(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Escenario y Fondo', true);
    const Ctx = this.Contexto;

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    const EntradaColor = document.createElement('input');
    EntradaColor.type = 'color';
    EntradaColor.value = '#1b1e26';
    EntradaColor.setAttribute('aria-label', 'Color de fondo');
    EntradaColor.oninput = () => Ctx.Escena.EstablecerFondoColor(EntradaColor.value);
    this.SincronizadoresEscena.push(() => {
      const Fondo = Ctx.Escena.Escena.background as { getHexString?: () => string } | null;
      if (Fondo?.getHexString) EntradaColor.value = `#${Fondo.getHexString()}`;
    });
    Fila.append(
      EntradaColor,
      this.Boton('Imagen fondo…', async () => {
        const Archivo = await SeleccionarArchivo('image/*');
        if (Archivo) Ctx.Escena.EstablecerFondoImagen(URL.createObjectURL(Archivo));
      }),
      this.Boton('Modelo 3D…', async () => {
        const Archivo = await SeleccionarArchivo('.glb,.gltf,.vrm');
        if (!Archivo) return;
        try {
          const Objeto = await Ctx.Modelos.CargarModeloFondo(Archivo);
          Ctx.Escena.EstablecerModeloFondo(Objeto);
          Ctx.NotificarEstado(`Fondo 3D cargado: ${Archivo.name}`, 'exito');
        } catch (E) { Ctx.NotificarEstado(`Error: ${(E as Error).message}`, 'error'); }
      }),
      this.Boton('Quitar 3D', () => Ctx.Escena.QuitarModeloFondo())
    );
    Cuerpo.appendChild(Fila);
    this.Casilla(Cuerpo, 'Mostrar rejilla de piso', true, (V) => Ctx.Escena.AlternarRejilla(V));
  }

  private ConstruirSeccionEfectos(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Iluminación y Efectos', false);
    const Ctx = this.Contexto;
    this.BotonesClaveEfecto = [];

    const AgregarClave = (Tipo: 'Efecto' | 'Luz', Objetivo: string, Valor: number) => {
      const Cmd = new ComandoGuardarClave(
        Ctx.Animacion, Tipo, Objetivo, 'Manual',
        Ctx.Animacion.TiempoActual, [Valor], Ctx.Estado.InterpolacionPorDefecto
      );
      Ctx.Historial.Ejecutar(Cmd);
      Ctx.NotificarEstado(
        Cmd.FueSobrescritura ? `Sobrescrita clave de ${Objetivo}.` : `Clave de ${Objetivo} añadida.`,
        'exito', true
      );
    };

    const RegEfecto = (Tipo: 'Efecto' | 'Luz', Objetivo: string) => ({
      AlKeyframe: (V: number) => AgregarClave(Tipo, Objetivo, V),
      AlFinalizarCambio: (V: number) => { if (Ctx.Estado.AutoClave) AgregarClave(Tipo, Objetivo, V); },
      RegistrarBoton: (Btn: HTMLButtonElement) => this.BotonesClaveEfecto.push({ Tipo, Objetivo, Boton: Btn })
    });

    this.Nota(Cuerpo, 'Pulsa ◆ o arrastra cualquier deslizador hacia el timeline para animar.');

    const FormatoDec = (V: number) => V.toFixed(2);
    const CtrlExp = this.Deslizador(Cuerpo, 'Exposición', 0.1, 3.0, 0.1, 1.0,
      (V) => Ctx.Escena.EstablecerExposicion(V), FormatoDec,
      RegEfecto('Luz', 'Exposicion'), { Tipo: 'Luz', Objetivo: 'Exposicion' });

    const CtrlDir = this.Deslizador(Cuerpo, 'Luz Direccional', 0, 5, 0.1, 2.2,
      (V) => Ctx.Escena.EstablecerLuzDireccional(V), FormatoDec,
      RegEfecto('Luz', 'LuzDireccional'), { Tipo: 'Luz', Objetivo: 'LuzDireccional' });

    const CtrlAmb = this.Deslizador(Cuerpo, 'Luz Ambiental', 0, 3, 0.1, 0.85,
      (V) => Ctx.Escena.EstablecerLuzAmbiental(V), FormatoDec,
      RegEfecto('Luz', 'LuzAmbiental'), { Tipo: 'Luz', Objetivo: 'LuzAmbiental' });

    const CasillaBloom = this.Casilla(Cuerpo, 'Brillo (Bloom)', false, (V) => {
      Ctx.Escena.EstablecerBloom(
        V,
        parseFloat(CtrlBloomFuerza.Entrada.value),
        parseFloat(CtrlBloomRadio.Entrada.value),
        parseFloat(CtrlBloomUmbral.Entrada.value)
      );
    });
    const CtrlBloomFuerza = this.Deslizador(Cuerpo, 'Fuerza Bloom', 0, 3, 0.1, 0.55,
      (V) => Ctx.Escena.EstablecerBloom(CasillaBloom.checked, V, parseFloat(CtrlBloomRadio.Entrada.value), parseFloat(CtrlBloomUmbral.Entrada.value)),
      FormatoDec, RegEfecto('Efecto', 'BloomFuerza'), { Tipo: 'Efecto', Objetivo: 'BloomFuerza' });
    const CtrlBloomRadio = this.Deslizador(Cuerpo, 'Radio Bloom', 0, 1, 0.05, 0.6,
      (V) => Ctx.Escena.EstablecerBloom(CasillaBloom.checked, parseFloat(CtrlBloomFuerza.Entrada.value), V, parseFloat(CtrlBloomUmbral.Entrada.value)),
      FormatoDec, RegEfecto('Efecto', 'BloomRadio'), { Tipo: 'Efecto', Objetivo: 'BloomRadio' });
    const CtrlBloomUmbral = this.Deslizador(Cuerpo, 'Umbral Bloom', 0, 1, 0.05, 0.85,
      (V) => Ctx.Escena.EstablecerBloom(CasillaBloom.checked, parseFloat(CtrlBloomFuerza.Entrada.value), parseFloat(CtrlBloomRadio.Entrada.value), V),
      FormatoDec, RegEfecto('Efecto', 'BloomUmbral'), { Tipo: 'Efecto', Objetivo: 'BloomUmbral' });

    const CasillaRGB = this.Casilla(Cuerpo, 'Aberración Cromática', false, (V) => {
      Ctx.Escena.EstablecerAberracionCromatica(V, parseFloat(CtrlRGB.Entrada.value));
    });
    const CtrlRGB = this.Deslizador(Cuerpo, 'RGB Shift', 0, 0.02, 0.001, 0.0025,
      (V) => Ctx.Escena.EstablecerAberracionCromatica(CasillaRGB.checked, V),
      (V) => V.toFixed(4), RegEfecto('Efecto', 'RGBShift'), { Tipo: 'Efecto', Objetivo: 'RGBShift' });

    const CasillaRuido = this.Casilla(Cuerpo, 'Ruido de Película', false, (V) => {
      Ctx.Escena.EstablecerRuido(V, parseFloat(CtrlRuido.Entrada.value));
    });
    const CtrlRuido = this.Deslizador(Cuerpo, 'Intensidad Ruido', 0, 1, 0.05, 0.35,
      (V) => Ctx.Escena.EstablecerRuido(CasillaRuido.checked, V),
      FormatoDec, RegEfecto('Efecto', 'RuidoIntensidad'), { Tipo: 'Efecto', Objetivo: 'RuidoIntensidad' });

    const CasillaVigneta = this.Casilla(Cuerpo, 'Viñeta Oscura', false, (V) => {
      Ctx.Escena.EstablecerVigneta(V, parseFloat(CtrlVigneta.Entrada.value), 1.0);
    });
    const CtrlVigneta = this.Deslizador(Cuerpo, 'Intensidad Viñeta', 0, 3, 0.1, 1.2,
      (V) => Ctx.Escena.EstablecerVigneta(CasillaVigneta.checked, V, 1.0),
      FormatoDec, RegEfecto('Efecto', 'VignetaOscuridad'), { Tipo: 'Efecto', Objetivo: 'VignetaOscuridad' });

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    const Etiqueta = document.createElement('label');
    Etiqueta.className = 'EtiquetaCompacta';
    const Selector = document.createElement('select');
    for (const Tipo of ['Ninguno', 'Nieve', 'Lluvia', 'Petalos', 'Chispas', 'Burbujas', 'Magia']) {
      const O = document.createElement('option');
      O.value = Tipo; O.textContent = Tipo;
      Selector.appendChild(O);
    }
    Selector.onchange = () => Ctx.Efectos.EstablecerParticulas(Selector.value as TipoParticulas);
    Etiqueta.append(document.createTextNode('Partículas '), Selector);
    Fila.appendChild(Etiqueta);
    Cuerpo.appendChild(Fila);

    const CtrlCantidad = this.Deslizador(Cuerpo, 'Cantidad', 50, 1000, 10, 300, (V) => {
      if (Ctx.Efectos.Tipo !== 'Ninguno') Ctx.Efectos.EstablecerParticulas(Ctx.Efectos.Tipo, V);
    }, (V) => String(Math.round(V)));

    this.SincronizadoresEscena.push(() => {
      const SetVal = (C: { Entrada: HTMLInputElement; Salida: HTMLOutputElement }, Val: number, Fmt: (v: number) => string = FormatoDec) => {
        C.Entrada.value = String(Val);
        C.Salida.textContent = Fmt(Val);
      };
      SetVal(CtrlExp, Ctx.Escena.Renderer.toneMappingExposure);
      SetVal(CtrlDir, Ctx.Escena.LuzDireccional.intensity);
      SetVal(CtrlAmb, Ctx.Escena.LuzAmbiental.intensity);
      CasillaBloom.checked = Ctx.Escena.BloomActivo;
      SetVal(CtrlBloomFuerza, Ctx.Escena.BloomFuerza);
      CasillaRGB.checked = Ctx.Escena.AberracionCromaticaActiva;
      CasillaRuido.checked = Ctx.Escena.RuidoActivo;
      CasillaVigneta.checked = Ctx.Escena.VignetaActiva;
      Selector.value = Ctx.Efectos.Tipo;
      SetVal(CtrlCantidad, Ctx.Efectos.Cantidad, (V) => String(Math.round(V)));
    });
  }

  private ConstruirSeccionCamara(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Cámara', false);
    const Ctx = this.Contexto;

    this.Nota(Cuerpo, 'Encuadra el visor 3D y guarda la toma actual en el timeline.');
    Cuerpo.appendChild(this.Boton('🎥 Grabar clave de cámara', () => {
      const Pos = Ctx.Escena.Camara.position;
      const Obj = Ctx.Escena.Controles.target;
      const FOV = Ctx.Escena.Camara.fov;
      const T = Ctx.Animacion.TiempoActual;
      const Interp = Ctx.Estado.InterpolacionPorDefecto;

      const Cmd = new ComandoLote(`Clave de cámara (${T.toFixed(2)}s)`, [
        new ComandoGuardarClave(Ctx.Animacion, 'CamaraPosicion', 'Posición', 'Manual', T, [Pos.x, Pos.y, Pos.z], Interp),
        new ComandoGuardarClave(Ctx.Animacion, 'CamaraObjetivo', 'Objetivo', 'Manual', T, [Obj.x, Obj.y, Obj.z], Interp),
        new ComandoGuardarClave(Ctx.Animacion, 'CamaraFOV', 'Campo de Visión', 'Manual', T, [FOV], Interp)
      ]);
      Ctx.Historial.Ejecutar(Cmd);
      Ctx.NotificarEstado('Toma de cámara guardada en el instante actual.', 'exito', true);
    }));

    const CtrlFov = this.Deslizador(Cuerpo, 'Campo Visión (FOV)', 10, 120, 1, Ctx.Escena.Camara.fov,
      (V) => { Ctx.Escena.Camara.fov = V; Ctx.Escena.Camara.updateProjectionMatrix(); },
      (V) => `${V.toFixed(0)}°`,
      {
        AlKeyframe: (V) => {
          const Cmd = new ComandoGuardarClave(
            Ctx.Animacion, 'CamaraFOV', 'Campo de Visión', 'Manual',
            Ctx.Animacion.TiempoActual, [V], Ctx.Estado.InterpolacionPorDefecto
          );
          Ctx.Historial.Ejecutar(Cmd);
          Ctx.NotificarEstado('Clave de FOV guardada.', 'exito', true);
        }
      }
    );
    this.SincronizadoresEscena.push(() => {
      CtrlFov.Entrada.value = String(Ctx.Escena.Camara.fov);
      CtrlFov.Salida.textContent = `${Ctx.Escena.Camara.fov.toFixed(0)}°`;
    });
  }

  private ConstruirSeccionAudio(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Pista de Audio', false);
    const Ctx = this.Contexto;

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    Fila.append(
      this.Boton('Cargar audio…', async () => {
        const Archivo = await SeleccionarArchivo('audio/*');
        if (!Archivo) return;
        try {
          await Ctx.Audio.Cargar(Archivo);
          this.ActualizarEtiquetaAudio();
          Ctx.Bus.Emitir('audio:cambiado', {});
          Ctx.NotificarEstado('Audio cargado y sincronizado con la onda.', 'exito');
        } catch (E) { Ctx.NotificarEstado(`Error de audio: ${(E as Error).message}`, 'error'); }
      }),
      this.Boton('Quitar', () => {
        Ctx.Audio.Quitar();
        this.ActualizarEtiquetaAudio();
        Ctx.Bus.Emitir('audio:cambiado', {});
      })
    );
    Cuerpo.appendChild(Fila);
    this.EtiquetaAudio = this.EtiquetaArchivo(Cuerpo);

    const CtrlVolumen = this.Deslizador(Cuerpo, 'Volumen', 0, 1, 0.01, 0.9, (V) => Ctx.Audio.EstablecerVolumen(V));

    const Fila2 = document.createElement('div');
    Fila2.className = 'FilaControles';
    const Etiqueta = document.createElement('label');
    Etiqueta.className = 'EtiquetaCompacta';
    const EntradaDesplazamiento = document.createElement('input');
    EntradaDesplazamiento.type = 'number';
    EntradaDesplazamiento.step = '0.1';
    EntradaDesplazamiento.value = '0';
    EntradaDesplazamiento.onchange = () => {
      Ctx.Audio.Desplazamiento = parseFloat(EntradaDesplazamiento.value) || 0;
      Ctx.Bus.Emitir('audio:cambiado', {});
    };
    Etiqueta.append(document.createTextNode('Desplazamiento (s) '), EntradaDesplazamiento);
    Fila2.appendChild(Etiqueta);
    Cuerpo.appendChild(Fila2);

    this.SincronizadoresEscena.push(() => {
      CtrlVolumen.Entrada.value = String(Ctx.Audio.Volumen);
      CtrlVolumen.Salida.textContent = Ctx.Audio.Volumen.toFixed(2);
      EntradaDesplazamiento.value = String(Ctx.Audio.Desplazamiento);
    });
  }

  // -------- Pestaña Captura (Tracking IA Python + VMC OSC) --------
  private ConstruirSeccionSeguimiento(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Tracking por IA (MediaPipe Python)', true);
    const Ctx = this.Contexto;
    this.Nota(Cuerpo, 'Rastrea cuerpo y manos con MediaPipe Holistic local usando cámara web o video.');

    const FilaCamara = document.createElement('div');
    FilaCamara.className = 'FilaControles';
    let EstadoCamara = false;

    const BotonCamara = this.Boton('📷 Activar Cámara en vivo', async () => {
      if (!Ctx.Modelos.Vrm) { Ctx.NotificarEstado('Carga un modelo primero.', 'aviso'); return; }

      if (!EstadoCamara) {
        if (Ctx.VMC.Estado === 'Desconectado') {
          Ctx.VMC.Iniciar(39539, () => {});
        }
        BotonCamara.textContent = 'Iniciando IA…';
        BotonCamara.disabled = true;

        try {
          const Res = await fetch('/api/tracker/start-live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ engine: 'mediapipe' })
          });
          if (Res.ok) {
            EstadoCamara = true;
            BotonCamara.textContent = '⏹ Detener Cámara';
            BotonCamara.classList.add('BotonPeligro');
            BotonCamara.disabled = false;
            Ctx.NotificarEstado('Cámara e IA MediaPipe activadas.', 'exito');
          }
        } catch {
          Ctx.NotificarEstado('Error al arrancar el motor Python.', 'error');
          BotonCamara.textContent = '📷 Activar Cámara en vivo';
          BotonCamara.disabled = false;
        }
      } else {
        try { await fetch('/api/tracker/stop', { method: 'POST' }); } catch {}
        EstadoCamara = false;
        BotonCamara.textContent = '📷 Activar Cámara en vivo';
        BotonCamara.classList.remove('BotonPeligro');
        Ctx.NotificarEstado('Cámara detenida.', 'info');
      }
    }, 'BotonPrimario');

    const BotonMovil = this.Boton('📱 Cámara Móvil (Pronto)', () => {
      Ctx.NotificarEstado('Próximamente: cámara móvil por código QR vía IP local.', 'info');
    });

    FilaCamara.append(BotonCamara, BotonMovil);
    Cuerpo.appendChild(FilaCamara);

    const FilaVideo = document.createElement('div');
    FilaVideo.className = 'FilaControles';
    let ArchivoVideoTemp: string | null = null;
    const EtiquetaVideo = this.EtiquetaArchivo(Cuerpo);

    const BotonCargar = this.Boton('Cargar Video…', async () => {
      const Archivo = await SeleccionarArchivo('video/*');
      if (!Archivo) return;
      this.ArchivoVideo = Archivo;
      Ctx.NotificarEstado('Subiendo video al servidor local…');
      const form = new FormData();
      form.append('file', Archivo);
      form.append('category', 'videos');
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: form });
        const data = await res.json();
        if (data.success) {
          ArchivoVideoTemp = data.path;
          EtiquetaVideo.textContent = `Video: ${this.ArchivoVideo.name}`;
          Ctx.NotificarEstado('Video listo para analizar.', 'exito');
        }
      } catch {
        Ctx.NotificarEstado('Error al subir video.', 'error');
      }
    });

    const EtiquetaProgreso = document.createElement('p');
    EtiquetaProgreso.className = 'TextoTenue';

    let IntervaloProgreso: any = null;
    const BotonProcesar = this.Boton('▶ Procesar Video', async () => {
      if (!ArchivoVideoTemp) { Ctx.NotificarEstado('Carga primero un video.', 'aviso'); return; }
      if (!Ctx.Modelos.Vrm) { Ctx.NotificarEstado('Carga primero un modelo VRM.', 'aviso'); return; }

      BotonProcesar.disabled = true;
      BotonProcesar.textContent = 'Procesando…';
      EtiquetaProgreso.textContent = 'Iniciando proceso en Python…';

      IntervaloProgreso = setInterval(async () => {
        try {
          const s = await fetch('/api/tracker/status');
          const txt = await s.text();
          if (txt) EtiquetaProgreso.textContent = txt;
        } catch {}
      }, 1000);

      try {
        const res = await fetch('/api/tracker/process-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoPath: ArchivoVideoTemp, engine: 'mediapipe' })
        });
        const data = await res.json();
        if (data.success && data.jsonUrl) {
          const resJson = await fetch(data.jsonUrl);
          const datosAnim = await resJson.json();
          const MaxT = Math.max(0.1, ...datosAnim.Pistas.flatMap((P: any) => P.Claves.map((C: any) => C.Tiempo)));
          Ctx.Historial.Ejecutar(new ComandoImportarAnimacion(
            Ctx.Animacion,
            datosAnim.Pistas,
            {
              TiempoInicio: 0,
              Modo: 'ReemplazarGrupo',
              EscalaTiempo: 1,
              FpsMuestreo: 24,
              Simplificar: false,
              ToleranciaSimplificacion: 0.015,
              GrupoDestino: 'SeguimientoCuerpo'
            },
            MaxT,
            this.ArchivoVideo?.name ?? 'Tracking Video'
          ));
          const EntradaDur = document.getElementById('EntradaDuracion') as HTMLInputElement | null;
          if (EntradaDur) EntradaDur.value = String(Ctx.Animacion.Duracion);
          Ctx.NotificarEstado(`Tracking completado: ${datosAnim.Pistas.length} pistas.`, 'exito', true);
          EtiquetaProgreso.textContent = 'Proceso completado.';
        } else {
          Ctx.NotificarEstado('Falló el procesamiento en Python.', 'error');
          EtiquetaProgreso.textContent = 'Error interno del motor Python.';
        }
      } catch {
        Ctx.NotificarEstado('Error de conexión con el servidor local.', 'error');
        EtiquetaProgreso.textContent = 'Error de conexión.';
      } finally {
        if (IntervaloProgreso) clearInterval(IntervaloProgreso);
        BotonProcesar.disabled = false;
        BotonProcesar.textContent = '▶ Procesar Video';
      }
    }, 'BotonPrimario');

    FilaVideo.append(BotonCargar, BotonProcesar);
    Cuerpo.append(FilaVideo, EtiquetaProgreso);
  }

  private ConstruirSeccionVMC(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Receptor VMC (OSC en vivo)', false);
    const Ctx = this.Contexto;
    this.Nota(Cuerpo, 'Recibe datos en tiempo real vía UDP OSC (puerto 39539) desde VSeeFace, Waidayo o Python.');

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';

    const EtiquetaEstado = document.createElement('p');
    EtiquetaEstado.className = 'TextoTenue';
    EtiquetaEstado.textContent = 'Estado: Desconectado';

    const BotonConectar = this.Boton('Iniciar Servidor', () => {
      if (Ctx.VMC.Estado === 'Desconectado') {
        Ctx.VMC.Iniciar(39539, (E: string) => {
          EtiquetaEstado.textContent = `Estado: ${E}`;
          BotonConectar.textContent = E === 'Escuchando' || E === 'Conectando' ? 'Detener Servidor' : 'Iniciar Servidor';
        });
      } else {
        Ctx.VMC.Detener();
      }
    }, 'BotonPrimario');

    const BotonGrabar = this.Boton('⏺ Grabar a Timeline', () => {
      if (!Ctx.Modelos.Vrm) { Ctx.NotificarEstado('Carga un modelo primero.', 'aviso'); return; }
      if (Ctx.VMC.Estado !== 'Escuchando') { Ctx.NotificarEstado('Inicia primero el servidor VMC.', 'aviso'); return; }

      if (!Ctx.VMC.Grabando) {
        Ctx.VMC.IniciarGrabacion();
        BotonGrabar.textContent = '⏹ Detener Grabación';
        BotonGrabar.classList.add('BotonPeligro');
      } else {
        Ctx.VMC.DetenerGrabacion();
        BotonGrabar.textContent = '⏺ Grabar a Timeline';
        BotonGrabar.classList.remove('BotonPeligro');
      }
    });

    Fila.append(BotonConectar, BotonGrabar);
    Cuerpo.append(Fila, EtiquetaEstado);
  }

  // --------------------------------------------------------------------------
  // Sincronización visual reactiva
  // --------------------------------------------------------------------------

  private ActualizarIndicadoresClave(): void {
    const Anim = this.Contexto.Animacion;
    const T = Anim.TiempoActual;
    const Hueso = this.SelectorHuesos?.value;

    if (this.BotonClaveHueso && Hueso) {
      const Pista = Anim.BuscarPista('HuesoRotacion', Hueso, 'Manual');
      const Existe = Pista ? Anim.BuscarClaveEnTiempo(Pista, T) !== undefined : false;
      this.BotonClaveHueso.textContent = Existe ? '◆ Sobrescribir rotación' : '◆ Clave rotación';
      this.BotonClaveHueso.classList.toggle('EstadoSobrescribir', Existe);
      this.BotonBorrarClaveHueso.disabled = !Existe;
    }

    if (this.BotonClaveCadera) {
      const PistaPos = Anim.BuscarPista('HuesoPosicion', 'hips', 'Manual');
      const ExistePos = PistaPos ? Anim.BuscarClaveEnTiempo(PistaPos, T) !== undefined : false;
      this.BotonClaveCadera.textContent = ExistePos ? '◆ Sobrescribir cadera' : '◆ Posición cadera';
      this.BotonClaveCadera.classList.toggle('EstadoSobrescribir', ExistePos);
    }

    for (const Item of this.BotonesClaveEfecto) {
      const Pista = Anim.BuscarPista(Item.Tipo, Item.Objetivo, 'Manual');
      const Existe = Pista ? Anim.BuscarClaveEnTiempo(Pista, T) !== undefined : false;
      Item.Boton.classList.toggle('EstadoSobrescribir', Existe);
      Item.Boton.title = Existe
        ? 'Sobrescribir clave existente en este instante'
        : 'Insertar clave en este instante';
    }

    for (const Item of this.BotonesClaveExpresion) {
      const Pista = Anim.BuscarPista('Expresion', Item.Expresion, 'Manual');
      const Existe = Pista ? Anim.BuscarClaveEnTiempo(Pista, T) !== undefined : false;
      Item.Boton.classList.toggle('EstadoSobrescribir', Existe);
    }
  }

  private ActualizarEtiquetaAudio(): void {
    const Audio = this.Contexto.Audio;
    this.EtiquetaAudio.textContent = Audio.Buffer
      ? `Audio: ${Audio.NombreArchivo} (${Audio.ObtenerDuracion().toFixed(1)}s)`
      : 'Ningún archivo cargado';
  }

  public SincronizarControlesEscena(): void {
    for (const Sync of this.SyncsEscena()) Sync();
  }

  private SyncsEscena(): Array<() => void> {
    return this.SincronizadoresEscena;
  }

  public RefrescarDinamico(): void {
    this.ActualizarListaHuesos();
    this.ActualizarExpresiones();
    this.ActualizarEtiquetaAudio();
    this.EtiquetaModelo.textContent = this.Contexto.Modelos.Vrm
      ? `Modelo: ${this.Contexto.Modelos.NombreModelo}`
      : 'Ningún archivo cargado';
    this.ActualizarChipsHuesoActivo(this.Contexto.Estado.HuesoSeleccionado);
    this.ActualizarIndicadoresClave();
  }
}

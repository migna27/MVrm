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
import { PRESETS_ENTORNO, PresetEntornoId } from '../Nucleo/GestorEntorno';
import { PRESETS_PROPS } from '../Nucleo/GestorProps';
import { AnalizarLipSyncDesdeAudio, VOCALES_LIPSYNC, VocalVrm } from '../Nucleo/MotorLipSync';
import { ModoAutoFocus, PistaAnimacion, TipoCielo, TipoPiso } from '../Tipos';
import {
  ComandoEliminarClaves, ComandoEliminarPista, ComandoGuardarClave, ComandoImportarAnimacion, ComandoLote
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
  private ListaPersonajesContenedor?: HTMLElement;
  private ListaLucesContenedor?: HTMLElement;
  private ListaCapasContenedor?: HTMLElement;
  private ListaPropsContenedor?: HTMLElement;
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
        this.SincronizarDeslizadoresGlobalesDesdePersonaje();
        this.RefrescarDinamico();
      }),
      Bus.Suscribir('personajes:cambiados', () => {
        this.SincronizarDeslizadoresGlobalesDesdePersonaje();
        this.RefrescarDinamico();
      }),
      Bus.Suscribir('proyecto:cargado', () => {
        this.SincronizarControlesEscena();
        this.RefrescarListaLuces();
        this.RefrescarListaCapas();
        this.RefrescarListaProps();
        this.RefrescarDinamico();
      }),
      Bus.Suscribir('entorno:cambiado', () => {
        this.RefrescarListaCapas();
        this.SincronizarControlesEscena();
      }),
      Bus.Suscribir('luces:cambiadas', () => {
        this.RefrescarListaLuces();
        this.SincronizarControlesEscena();
      }),
      Bus.Suscribir('props:cambiados', () => this.RefrescarListaProps()),
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
    this.ConstruirSeccionProps(Izq.Paneles.escena);
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

    // Reparto Multi-VRM
    const BloqueReparto = document.createElement('div');
    BloqueReparto.className = 'ColumnaBotones';
    const FilaReparto = document.createElement('div');
    FilaReparto.className = 'FilaControles';
    FilaReparto.append(
      this.Boton('+ Añadir VRM', async () => {
        const Archivo = await SeleccionarArchivo('.vrm');
        if (Archivo) await this.CargarModelo(Archivo, true);
      }),
      this.Boton('+ Ejemplo', async () => {
        Ctx.NotificarEstado('Descargando personaje adicional…');
        try {
          await Ctx.Modelos.CargarVrmDesdeUrl(
            'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/three-vrm-girl.vrm',
            true
          );
          this.TrasCargarModelo();
        } catch (E) { Ctx.NotificarEstado(`Error: ${(E as Error).message}`, 'error'); }
      })
    );
    this.ListaPersonajesContenedor = document.createElement('div');
    this.ListaPersonajesContenedor.className = 'ListaPersonajes';
    BloqueReparto.append(FilaReparto, this.ListaPersonajesContenedor);
    Cuerpo.appendChild(BloqueReparto);
    this.RefrescarListaPersonajes();

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
      const PersId = Ctx.Modelos.PersonajeActivoId ?? undefined;
      const Pos = Ctx.Modelos.ObtenerPosicionHueso('hips', PersId);
      const Cmd = new ComandoGuardarClave(
        Ctx.Animacion, 'HuesoPosicion', 'hips', 'Manual',
        Ctx.Animacion.TiempoActual, [Pos.x, Pos.y, Pos.z], Ctx.Estado.InterpolacionPorDefecto,
        undefined, PersId
      );
      Ctx.Historial.Ejecutar(Cmd);
      const Pista = Ctx.Animacion.BuscarPista('HuesoPosicion', 'hips', 'Manual', PersId);
      if (Pista) Ctx.Estado.SeleccionarUna(Pista.Id, Cmd.ClaveResultanteId);
      Ctx.NotificarEstado(
        Cmd.FueSobrescritura ? 'Clave de posición cadera sobrescrita.' : 'Clave de posición cadera insertada.',
        'exito', true
      );
    });

    Fila3.append(this.BotonClaveHueso, this.BotonBorrarClaveHueso, this.BotonClaveCadera);
    Cuerpo.appendChild(Fila3);
    this.Nota(Cuerpo, 'Haz clic directo en el modelo 3D para posar o cambiar de personaje. Atajos: Q/W/E/R, K pose, Shift+F Cine.');
  }

  private GuardarClaveHuesoActivo(Silencioso = false): void {
    const Ctx = this.Contexto;
    const Nombre = this.SelectorHuesos.value;
    const PersId = Ctx.Modelos.PersonajeActivoId ?? undefined;
    if (!Nombre || !Ctx.Modelos.Vrm) return;
    const Euler = Ctx.Modelos.ObtenerRotacionHueso(Nombre, PersId);
    const Cmd = new ComandoGuardarClave(
      Ctx.Animacion, 'HuesoRotacion', Nombre, 'Manual',
      Ctx.Animacion.TiempoActual, [Euler.x, Euler.y, Euler.z], Ctx.Estado.InterpolacionPorDefecto,
      undefined, PersId
    );
    Ctx.Historial.Ejecutar(Cmd);
    const Pista = Ctx.Animacion.BuscarPista('HuesoRotacion', Nombre, 'Manual', PersId);
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

  private async CargarModelo(Archivo: File, AgregarComoNuevo = false): Promise<void> {
    const Ctx = this.Contexto;
    Ctx.NotificarEstado(`Cargando ${Archivo.name}…`);
    try {
      await Ctx.Modelos.CargarVrm(Archivo, { AgregarComoNuevo });
      this.TrasCargarModelo();
    } catch (E) {
      Ctx.NotificarEstado(`Error al cargar: ${(E as Error).message}`, 'error');
    }
  }

  private TrasCargarModelo(): void {
    const Ctx = this.Contexto;
    Ctx.Escena.ControlTransformacion.detach();
    Ctx.Animacion.ReasignarPersonajesFaltantes();
    Ctx.Animacion.EvaluarEn(Ctx.Animacion.TiempoActual);
    this.EtiquetaModelo.textContent = `Modelo: ${Ctx.Modelos.NombreModelo}`;
    this.ActualizarListaHuesos();
    this.ActualizarExpresiones();
    this.RefrescarListaPersonajes();
    Ctx.Bus?.Emitir('personajes:cambiados', {
      cantidad: Ctx.Modelos.Personajes.length,
      activoId: Ctx.Modelos.PersonajeActivoId
    });
    Ctx.Bus?.Emitir('modelo:cargado', { nombre: Ctx.Modelos.NombreModelo });
    Ctx.NotificarEstado('Modelo listo. Usa la biblioteca, posa en 3D o importa una animación.', 'exito');
  }

  private RefrescarListaPersonajes(): void {
    const Contenedor = this.ListaPersonajesContenedor;
    if (!Contenedor) return;
    Contenedor.innerHTML = '';
    const Ctx = this.Contexto;
    const Lista = Ctx.Modelos.Personajes;
    if (Lista.length === 0) return;

    for (let I = 0; I < Lista.length; I++) {
      const P = Lista[I];
      const EsActivo = P.Id === Ctx.Modelos.PersonajeActivoId;
      const Fila = document.createElement('div');
      Fila.className = EsActivo ? 'ItemPersonaje Activo' : 'ItemPersonaje';

      const BtnSel = document.createElement('button');
      BtnSel.type = 'button';
      BtnSel.className = 'BotonNombrePersonaje';
      BtnSel.textContent = `${EsActivo ? '● ' : ''}${I + 1}. ${P.Nombre.replace(/\.vrm$/i, '')}`;
      BtnSel.title = `Seleccionar personaje ${P.Nombre}`;
      BtnSel.onclick = () => {
        if (Ctx.Modelos.SeleccionarPersonaje(P.Id)) {
          Ctx.Escena.ControlTransformacion.detach();
          Ctx.Bus?.Emitir('personajes:cambiados', {
            cantidad: Ctx.Modelos.Personajes.length,
            activoId: P.Id
          });
        }
      };
      Fila.appendChild(BtnSel);

      if (Lista.length > 1) {
        const BtnDel = document.createElement('button');
        BtnDel.type = 'button';
        BtnDel.className = 'BotonIconoSolo BotonPeligro';
        BtnDel.textContent = '✕';
        BtnDel.title = `Quitar a ${P.Nombre} de la escena`;
        BtnDel.setAttribute('aria-label', `Quitar ${P.Nombre}`);
        BtnDel.onclick = () => {
          Ctx.Escena.ControlTransformacion.detach();
          Ctx.Props?.LimpiarPersonaje(P.Id);
          Ctx.Modelos.EliminarPersonaje(P.Id);
          Ctx.Bus?.Emitir('personajes:cambiados', {
            cantidad: Ctx.Modelos.Personajes.length,
            activoId: Ctx.Modelos.PersonajeActivoId
          });
        };
        Fila.appendChild(BtnDel);
      }
      Contenedor.appendChild(Fila);
    }
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

  private SincronizarDeslizadoresGlobalesDesdePersonaje(): void {
    if (this.DeslizadoresGlobales.length < 4) return;
    const Vrm = this.Contexto.Modelos.Vrm;
    const Vals = Vrm
      ? [Vrm.scene.position.x, Vrm.scene.position.y, Vrm.scene.position.z, AGrados(Vrm.scene.rotation.y)]
      : [0, 0, 0, 0];
    this.DeslizadoresGlobales.forEach((Item, I) => {
      const V = Vals[I] ?? 0;
      Item.Entrada.value = String(V);
      Item.Salida.textContent = Item.Formato(V);
    });
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
        const PersId = Ctx.Modelos.PersonajeActivoId ?? undefined;
        const Sub = [];
        for (const Nombre of Ctx.Modelos.ObtenerExpresiones(PersId)) {
          const Peso = Ctx.Modelos.ObtenerValorExpresion(Nombre, PersId);
          const PistaExist = Ctx.Animacion.BuscarPista('Expresion', Nombre, 'Manual', PersId);
          if (Peso > 0.001 || (PistaExist && Ctx.Animacion.BuscarClaveEnTiempo(PistaExist, Ctx.Animacion.TiempoActual))) {
            Sub.push(new ComandoGuardarClave(
              Ctx.Animacion, 'Expresion', Nombre, 'Manual',
              Ctx.Animacion.TiempoActual, [Peso], Ctx.Estado.InterpolacionPorDefecto,
              undefined, PersId
            ));
          }
        }
        if (Sub.length > 0) {
          Ctx.Historial.Ejecutar(new ComandoLote('Claves de expresiones faciales', Sub));
          Ctx.NotificarEstado(`${Sub.length} clave(s) de expresión guardadas.`, 'exito', true);
        }
      }, 'BotonPrimario'),
      this.Boton('🗣 Lip-Sync Audio', () => this.GenerarLipSyncDesdeAudioActual()),
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
        const PersId = Ctx.Modelos.PersonajeActivoId ?? undefined;
        const Cmd = new ComandoGuardarClave(
          Ctx.Animacion, 'Expresion', Nombre, 'Manual',
          Ctx.Animacion.TiempoActual, [Val], Ctx.Estado.InterpolacionPorDefecto,
          undefined, PersId
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
          const PersId = Ctx.Modelos.PersonajeActivoId ?? undefined;
          const Pistas = Pre.Generar(Ctx.Animacion.TiempoActual).map((P) => (
            (P.Tipo === 'HuesoRotacion' || P.Tipo === 'HuesoPosicion' || P.Tipo === 'Expresion') && PersId
              ? { ...P, PersonajeId: PersId }
              : P
          ));
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
              GrupoDestino: 'Preajuste',
              PersonajeId: PersId
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

    const BtnImportar = this.Boton('⬇ Importar (.vrma/.vmd/.bvh/.glb/.json)…', async () => {
      const Archivo = await SeleccionarArchivo('.vrma,.vmd,.bvh,.glb,.gltf,.json');
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

      CrearLista('Animaciones (.vrma / .vmd)', Libreria.animations, async (Ruta, Nombre) => {
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

      CrearLista('Props 3D (.glb)', Libreria.props, async (Ruta, Nombre) => {
        if (!Ctx.Props) return;
        try {
          const Hueso = Nombre.toLowerCase().includes('hand') ? 'rightHand' : null;
          const Prop = await Ctx.Props.CargarDesdeUrl(Ruta, Nombre.replace(/\.(glb|gltf)$/i, ''), {
            Modelos: Ctx.Modelos,
            PersonajeId: Hueso ? Ctx.Modelos.PersonajeActivoId : null,
            Hueso
          });
          Ctx.Escena.ControlTransformacion.attach(Prop.Objeto);
          Ctx.Escena.ControlTransformacion.setMode('translate');
          Ctx.NotificarEstado(`Prop añadido: ${Prop.Nombre}`, 'exito');
        } catch (E) { Ctx.NotificarEstado(`Error prop: ${(E as Error).message}`, 'error'); }
      });

      CrearLista('Texturas FX (.png)', Libreria.textures, (Ruta, Nombre) => {
        Ctx.Escena.EstablecerLensDirt(true, Ruta, Ctx.Escena.LensDirtIntensidad);
        this.SincronizarControlesEscena();
        Ctx.NotificarEstado(`Lens Dirt aplicado: ${Nombre}`, 'exito');
      });
    } catch {
      // Ignorar si no hay backend local activo (build estático)
    }
  }

  // -------- Pestaña Escena (Entorno, Cine/Iluminación, Props, Cámara, Audio) --------
  private ConstruirSeccionEscena(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Entorno y Escenario', true);
    const Ctx = this.Contexto;

    // Presets en 1 clic
    const RejillaPresets = document.createElement('div');
    RejillaPresets.className = 'RejillaBotones';
    for (const Pre of PRESETS_ENTORNO) {
      const Btn = this.Boton(Pre.Nombre, () => {
        Ctx.Entorno?.AplicarPreset(Pre.Id as PresetEntornoId, Ctx.Efectos);
        this.RefrescarListaLuces();
        this.RefrescarListaCapas();
        Ctx.NotificarEstado(`Entorno "${Pre.Nombre}" aplicado.`, 'exito');
      });
      Btn.title = Pre.Descripcion;
      RejillaPresets.appendChild(Btn);
    }
    Cuerpo.appendChild(RejillaPresets);

    // Piso procedural
    const FilaPiso = document.createElement('div');
    FilaPiso.className = 'FilaCompacta';
    const LblPiso = document.createElement('label');
    LblPiso.className = 'EtiquetaCompacta';
    LblPiso.textContent = 'Piso ';
    const SelPiso = document.createElement('select');
    for (const [Val, Txt] of [
      ['Rejilla', 'Rejilla'],
      ['Reflectivo', 'Espejo Reflectivo'],
      ['Agua', 'Agua Animada'],
      ['EscenarioNeon', 'Escenario Neón'],
      ['Ninguno', 'Sin piso']
    ]) {
      const O = document.createElement('option');
      O.value = Val; O.textContent = Txt;
      SelPiso.appendChild(O);
    }
    const ColorPiso = document.createElement('input');
    ColorPiso.type = 'color';
    ColorPiso.value = '#283042';
    ColorPiso.setAttribute('aria-label', 'Color del piso');
    SelPiso.onchange = () => Ctx.Entorno?.EstablecerPiso(SelPiso.value as TipoPiso, ColorPiso.value);
    ColorPiso.oninput = () => Ctx.Entorno?.EstablecerPiso(SelPiso.value as TipoPiso, ColorPiso.value);
    LblPiso.appendChild(SelPiso);
    FilaPiso.append(LblPiso, ColorPiso);
    Cuerpo.appendChild(FilaPiso);

    const CtrlTamPiso = this.Deslizador(Cuerpo, 'Tamaño piso', 4, 30, 1, 12, (V) => {
      Ctx.Entorno?.EstablecerPiso(SelPiso.value as TipoPiso, ColorPiso.value, V);
    }, (V) => `${Math.round(V)}m`);

    // Cielo / Fondo / Video / 360
    const FilaCielo = document.createElement('div');
    FilaCielo.className = 'FilaCompacta';
    const LblCielo = document.createElement('label');
    LblCielo.className = 'EtiquetaCompacta';
    LblCielo.textContent = 'Cielo ';
    const SelCielo = document.createElement('select');
    for (const [Val, Txt] of [
      ['Solido', 'Color sólido'],
      ['Dia', 'Cielo Día'],
      ['Atardecer', 'Atardecer'],
      ['Noche', 'Cielo Noche'],
      ['EspacioDinamico', 'Espacio Dinámico']
    ]) {
      const O = document.createElement('option');
      O.value = Val; O.textContent = Txt;
      SelCielo.appendChild(O);
    }
    const EntradaColor = document.createElement('input');
    EntradaColor.type = 'color';
    EntradaColor.value = '#1b1e26';
    EntradaColor.setAttribute('aria-label', 'Color de fondo');
    SelCielo.onchange = () => Ctx.Entorno?.EstablecerCielo(SelCielo.value as TipoCielo, { ColorFondo: EntradaColor.value });
    EntradaColor.oninput = () => {
      if (Ctx.Entorno) Ctx.Entorno.EstablecerCielo('Solido', { ColorFondo: EntradaColor.value });
      else Ctx.Escena.EstablecerFondoColor(EntradaColor.value);
    };
    LblCielo.appendChild(SelCielo);
    FilaCielo.append(LblCielo, EntradaColor);
    Cuerpo.appendChild(FilaCielo);

    const FilaMedia = document.createElement('div');
    FilaMedia.className = 'FilaControles';
    FilaMedia.append(
      this.Boton('Imagen / 360°…', async () => {
        const Archivo = await SeleccionarArchivo('image/*');
        if (!Archivo) return;
        if (Ctx.Entorno) Ctx.Entorno.EstablecerImagen360(Archivo);
        else Ctx.Escena.EstablecerFondoImagen(URL.createObjectURL(Archivo));
      }),
      this.Boton('Video fondo…', async () => {
        const Archivo = await SeleccionarArchivo('video/*');
        if (Archivo && Ctx.Entorno) Ctx.Entorno.EstablecerVideoFondo(Archivo);
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
    Cuerpo.appendChild(FilaMedia);

    // Niebla atmosférica
    const FilaNiebla = document.createElement('div');
    FilaNiebla.className = 'FilaCompacta';
    const ColorNiebla = document.createElement('input');
    ColorNiebla.type = 'color';
    ColorNiebla.value = '#1b1e26';
    ColorNiebla.setAttribute('aria-label', 'Color de niebla');
    const CasillaNiebla = this.Casilla(FilaNiebla, 'Niebla atmosférica', false, (V) => {
      Ctx.Entorno?.EstablecerNiebla(V, ColorNiebla.value, parseFloat(CtrlNieblaDens.Entrada.value));
    });
    ColorNiebla.oninput = () => {
      Ctx.Entorno?.EstablecerNiebla(CasillaNiebla.checked, ColorNiebla.value, parseFloat(CtrlNieblaDens.Entrada.value));
    };
    FilaNiebla.appendChild(ColorNiebla);
    Cuerpo.appendChild(FilaNiebla);

    const CtrlNieblaDens = this.Deslizador(Cuerpo, 'Densidad Niebla', 0, 0.15, 0.002, 0.035, (V) => {
      Ctx.Entorno?.EstablecerNiebla(CasillaNiebla.checked, ColorNiebla.value, V);
    }, (V) => V.toFixed(3), {
      AlKeyframe: (V) => {
        const Cmd = new ComandoGuardarClave(Ctx.Animacion, 'Efecto', 'NieblaDensidad', 'Manual', Ctx.Animacion.TiempoActual, [V], Ctx.Estado.InterpolacionPorDefecto);
        Ctx.Historial.Ejecutar(Cmd);
      },
      AlFinalizarCambio: (V) => {
        if (Ctx.Estado.AutoClave) {
          Ctx.Historial.Ejecutar(new ComandoGuardarClave(Ctx.Animacion, 'Efecto', 'NieblaDensidad', 'Manual', Ctx.Animacion.TiempoActual, [V], Ctx.Estado.InterpolacionPorDefecto));
        }
      },
      RegistrarBoton: (Btn) => this.BotonesClaveEfecto.push({ Tipo: 'Efecto', Objetivo: 'NieblaDensidad', Boton: Btn })
    }, { Tipo: 'Efecto', Objetivo: 'NieblaDensidad' });

    Cuerpo.appendChild(this.Boton('📥 Importar JSON VRMLiveViewer…', async () => {
      const Archivo = await SeleccionarArchivo('.json');
      if (!Archivo || !Ctx.Entorno) return;
      try {
        const Mensaje = Ctx.Entorno.ImportarJsonVRMLV(await Archivo.text(), Ctx.Efectos);
        this.RefrescarListaLuces();
        this.RefrescarListaCapas();
        this.SincronizarControlesEscena();
        Ctx.NotificarEstado(Mensaje, 'exito');
      } catch (E) { Ctx.NotificarEstado(`Error JSON VRMLV: ${(E as Error).message}`, 'error'); }
    }));

    this.SincronizadoresEscena.push(() => {
      if (!Ctx.Entorno) return;
      const C = Ctx.Entorno.Config;
      SelPiso.value = C.Piso;
      ColorPiso.value = C.ColorPiso;
      CtrlTamPiso.Entrada.value = String(C.TamanoPiso);
      CtrlTamPiso.Salida.textContent = `${Math.round(C.TamanoPiso)}m`;
      if (['Solido', 'Dia', 'Atardecer', 'Noche', 'EspacioDinamico'].includes(C.Cielo)) {
        SelCielo.value = C.Cielo;
      }
      EntradaColor.value = C.ColorFondo;
      CasillaNiebla.checked = C.NieblaActiva;
      ColorNiebla.value = C.NieblaColor;
      CtrlNieblaDens.Entrada.value = String(C.NieblaDensidad);
      CtrlNieblaDens.Salida.textContent = C.NieblaDensidad.toFixed(3);
    });
  }

  private ConstruirSeccionEfectos(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Iluminación, Cine y Partículas', false);
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
    const CtrlExp = this.Deslizador(Cuerpo, 'Exposición', 0.1, 3.0, 0.05, 1.0,
      (V) => Ctx.Escena.EstablecerExposicion(V), FormatoDec,
      RegEfecto('Luz', 'Exposicion'), { Tipo: 'Luz', Objetivo: 'Exposicion' });

    const CtrlDir = this.Deslizador(Cuerpo, 'Luz Direccional', 0, 5, 0.1, 2.2,
      (V) => Ctx.Escena.EstablecerLuzDireccional(V), FormatoDec,
      RegEfecto('Luz', 'LuzDireccional'), { Tipo: 'Luz', Objetivo: 'LuzDireccional' });

    const CtrlAmb = this.Deslizador(Cuerpo, 'Luz Ambiental', 0, 3, 0.05, 0.85,
      (V) => Ctx.Escena.EstablecerLuzAmbiental(V), FormatoDec,
      RegEfecto('Luz', 'LuzAmbiental'), { Tipo: 'Luz', Objetivo: 'LuzAmbiental' });

    // Luz dedicada al Personaje
    const FilaLuzPers = document.createElement('div');
    FilaLuzPers.className = 'FilaCompacta';
    const ColorLuzPers = document.createElement('input');
    ColorLuzPers.type = 'color';
    ColorLuzPers.value = '#ffffff';
    ColorLuzPers.setAttribute('aria-label', 'Color luz personaje');
    const CasillaLuzPers = this.Casilla(FilaLuzPers, 'Luz Personaje', Ctx.Escena.LuzPersonajeActiva, (V) => {
      Ctx.Escena.EstablecerLuzPersonaje(V, parseFloat(CtrlLuzPers.Entrada.value), ColorLuzPers.value);
    });
    ColorLuzPers.oninput = () => Ctx.Escena.EstablecerLuzPersonaje(CasillaLuzPers.checked, parseFloat(CtrlLuzPers.Entrada.value), ColorLuzPers.value);
    FilaLuzPers.appendChild(ColorLuzPers);
    Cuerpo.appendChild(FilaLuzPers);
    const CtrlLuzPers = this.Deslizador(Cuerpo, 'Fuerza Luz Pers.', 0, 4, 0.05, Ctx.Escena.IntensidadLuzPersonaje,
      (V) => Ctx.Escena.EstablecerLuzPersonaje(CasillaLuzPers.checked, V, ColorLuzPers.value),
      FormatoDec, RegEfecto('Luz', 'LuzPersonaje'), { Tipo: 'Luz', Objetivo: 'LuzPersonaje' });

    // Focos de Escenario Volumétricos
    const TitFocos = document.createElement('h3');
    TitFocos.className = 'TituloSubLista';
    TitFocos.textContent = 'Focos de Escenario (Volumétricos)';
    const BarraFocos = document.createElement('div');
    BarraFocos.className = 'FilaControles';
    BarraFocos.append(
      this.Boton('+ Foco Spot', () => {
        const L = Ctx.Escena.AgregarLuzEscenario({ Tipo: 'Spot' });
        Ctx.Escena.ControlTransformacion.attach(L.Luz);
        Ctx.Escena.ControlTransformacion.setMode('translate');
        this.RefrescarListaLuces();
      }),
      this.Boton('✨ 5 Focos Neón', () => {
        Ctx.Escena.AplicarPresetCincoFocos();
        this.RefrescarListaLuces();
      }),
      this.Boton('Limpiar', () => {
        Ctx.Escena.LimpiarLucesEscenario();
        this.RefrescarListaLuces();
      })
    );
    this.ListaLucesContenedor = document.createElement('div');
    this.ListaLucesContenedor.className = 'ListaCompacta';
    Cuerpo.append(TitFocos, BarraFocos, this.ListaLucesContenedor);
    this.RefrescarListaLuces();

    // Bloom HDR & Lens Dirt
    const CasillaBloom = this.Casilla(Cuerpo, 'Brillo HDR (Bloom)', false, (V) => {
      Ctx.Escena.EstablecerBloom(V, parseFloat(CtrlBloomFuerza.Entrada.value), parseFloat(CtrlBloomRadio.Entrada.value), parseFloat(CtrlBloomUmbral.Entrada.value));
    });
    const CtrlBloomFuerza = this.Deslizador(Cuerpo, 'Fuerza Bloom', 0, 3, 0.05, 0.55,
      (V) => Ctx.Escena.EstablecerBloom(CasillaBloom.checked, V, parseFloat(CtrlBloomRadio.Entrada.value), parseFloat(CtrlBloomUmbral.Entrada.value)),
      FormatoDec, RegEfecto('Efecto', 'BloomFuerza'), { Tipo: 'Efecto', Objetivo: 'BloomFuerza' });
    const CtrlBloomRadio = this.Deslizador(Cuerpo, 'Radio Bloom', 0, 1, 0.05, 0.6,
      (V) => Ctx.Escena.EstablecerBloom(CasillaBloom.checked, parseFloat(CtrlBloomFuerza.Entrada.value), V, parseFloat(CtrlBloomUmbral.Entrada.value)),
      FormatoDec, RegEfecto('Efecto', 'BloomRadio'), { Tipo: 'Efecto', Objetivo: 'BloomRadio' });
    const CtrlBloomUmbral = this.Deslizador(Cuerpo, 'Umbral Bloom', 0, 1.5, 0.05, 0.85,
      (V) => Ctx.Escena.EstablecerBloom(CasillaBloom.checked, parseFloat(CtrlBloomFuerza.Entrada.value), parseFloat(CtrlBloomRadio.Entrada.value), V),
      FormatoDec, RegEfecto('Efecto', 'BloomUmbral'), { Tipo: 'Efecto', Objetivo: 'BloomUmbral' });

    const FilaDirt = document.createElement('div');
    FilaDirt.className = 'FilaCompacta';
    const CasillaDirt = this.Casilla(FilaDirt, 'Lens Dirt', false, (V) => {
      Ctx.Escena.EstablecerLensDirt(V, Ctx.Escena.LensDirtTextura || '/assets/textures/LensDirt_Vertical.png', parseFloat(CtrlDirtInt.Entrada.value));
    });
    FilaDirt.appendChild(this.Boton('Textura…', async () => {
      const Arch = await SeleccionarArchivo('image/*');
      if (Arch) {
        CasillaDirt.checked = true;
        Ctx.Escena.EstablecerLensDirt(true, URL.createObjectURL(Arch), parseFloat(CtrlDirtInt.Entrada.value));
      }
    }));
    Cuerpo.appendChild(FilaDirt);
    const CtrlDirtInt = this.Deslizador(Cuerpo, 'Intensidad Dirt', 0, 1.5, 0.05, 0.35,
      (V) => Ctx.Escena.EstablecerLensDirt(CasillaDirt.checked, undefined, V),
      FormatoDec, RegEfecto('Efecto', 'LensDirtIntensidad'), { Tipo: 'Efecto', Objetivo: 'LensDirtIntensidad' });

    // Profundidad de Campo (DoF + AutoFocus)
    const FilaDof = document.createElement('div');
    FilaDof.className = 'FilaCompacta';
    const CasillaDof = this.Casilla(FilaDof, 'Desenfoque (DoF)', false, (V) => {
      Ctx.Escena.EstablecerDOF(V, { Modo: SelAutoFocus.value as ModoAutoFocus, Apertura: parseFloat(CtrlDofAp.Entrada.value) });
    });
    const SelAutoFocus = document.createElement('select');
    SelAutoFocus.setAttribute('aria-label', 'Modo Auto-Focus DoF');
    for (const [Val, Txt] of [
      ['CabezaActivo', 'Auto: Rostro Activo'],
      ['MultiPersonaje', 'Auto: Multi-VRM'],
      ['Manual', 'Enfoque Manual']
    ]) {
      const O = document.createElement('option');
      O.value = Val; O.textContent = Txt;
      SelAutoFocus.appendChild(O);
    }
    SelAutoFocus.onchange = () => Ctx.Escena.EstablecerDOF(CasillaDof.checked, { Modo: SelAutoFocus.value as ModoAutoFocus });
    FilaDof.appendChild(SelAutoFocus);
    Cuerpo.appendChild(FilaDof);

    const CtrlDofDist = this.Deslizador(Cuerpo, 'Distancia DoF', 0.3, 25, 0.1, 2.5,
      (V) => Ctx.Escena.EstablecerDOF(CasillaDof.checked, { Distancia: V }),
      (V) => `${V.toFixed(1)}m`, RegEfecto('Efecto', 'DofDistancia'), { Tipo: 'Efecto', Objetivo: 'DofDistancia' });
    const CtrlDofAp = this.Deslizador(Cuerpo, 'Apertura DoF', 0.2, 6, 0.1, 1.8,
      (V) => Ctx.Escena.EstablecerDOF(CasillaDof.checked, { Apertura: V }),
      FormatoDec, RegEfecto('Efecto', 'DofApertura'), { Tipo: 'Efecto', Objetivo: 'DofApertura' });

    // Gradación de Color Cinematográfica
    const CasillaCG = this.Casilla(Cuerpo, 'Gradación de Color (LUT)', false, (V) => {
      Ctx.Escena.EstablecerColorGrading(V, {
        Temperatura: parseFloat(CtrlTemp.Entrada.value),
        Tinte: parseFloat(CtrlTinte.Entrada.value),
        Saturacion: parseFloat(CtrlSat.Entrada.value),
        Contraste: parseFloat(CtrlCont.Entrada.value)
      });
    });
    const CtrlTemp = this.Deslizador(Cuerpo, 'Temperatura', -1, 1, 0.05, 0,
      (V) => Ctx.Escena.EstablecerColorGrading(CasillaCG.checked, { Temperatura: V }),
      FormatoDec, RegEfecto('Efecto', 'Temperatura'), { Tipo: 'Efecto', Objetivo: 'Temperatura' });
    const CtrlTinte = this.Deslizador(Cuerpo, 'Tinte M/V', -1, 1, 0.05, 0,
      (V) => Ctx.Escena.EstablecerColorGrading(CasillaCG.checked, { Tinte: V }));
    const CtrlSat = this.Deslizador(Cuerpo, 'Saturación', -1, 1, 0.05, 0,
      (V) => Ctx.Escena.EstablecerColorGrading(CasillaCG.checked, { Saturacion: V }),
      FormatoDec, RegEfecto('Efecto', 'Saturacion'), { Tipo: 'Efecto', Objetivo: 'Saturacion' });
    const CtrlCont = this.Deslizador(Cuerpo, 'Contraste', -1, 1, 0.05, 0,
      (V) => Ctx.Escena.EstablecerColorGrading(CasillaCG.checked, { Contraste: V }),
      FormatoDec, RegEfecto('Efecto', 'Contraste'), { Tipo: 'Efecto', Objetivo: 'Contraste' });

    // Viñeta Coloreada, RGB, Ruido, FXAA
    const FilaVigneta = document.createElement('div');
    FilaVigneta.className = 'FilaCompacta';
    const ColorVigneta = document.createElement('input');
    ColorVigneta.type = 'color';
    ColorVigneta.value = '#000000';
    ColorVigneta.setAttribute('aria-label', 'Color de viñeta');
    const CasillaVigneta = this.Casilla(FilaVigneta, 'Viñeta Cine', false, (V) => {
      Ctx.Escena.EstablecerVigneta(V, parseFloat(CtrlVigneta.Entrada.value), undefined, ColorVigneta.value);
    });
    ColorVigneta.oninput = () => Ctx.Escena.EstablecerVigneta(CasillaVigneta.checked, parseFloat(CtrlVigneta.Entrada.value), undefined, ColorVigneta.value);
    FilaVigneta.appendChild(ColorVigneta);
    Cuerpo.appendChild(FilaVigneta);
    const CtrlVigneta = this.Deslizador(Cuerpo, 'Intensidad Viñeta', 0, 1.5, 0.05, 0.4,
      (V) => Ctx.Escena.EstablecerVigneta(CasillaVigneta.checked, V, undefined, ColorVigneta.value),
      FormatoDec, RegEfecto('Efecto', 'VignetaOscuridad'), { Tipo: 'Efecto', Objetivo: 'VignetaOscuridad' });

    const CasillaRGB = this.Casilla(Cuerpo, 'Aberración Cromática', false, (V) => {
      Ctx.Escena.EstablecerAberracionCromatica(V, parseFloat(CtrlRGB.Entrada.value));
    });
    const CtrlRGB = this.Deslizador(Cuerpo, 'RGB Shift', 0, 0.02, 0.001, 0.0025,
      (V) => Ctx.Escena.EstablecerAberracionCromatica(CasillaRGB.checked, V),
      (V) => V.toFixed(4), RegEfecto('Efecto', 'RGBShift'), { Tipo: 'Efecto', Objetivo: 'RGBShift' });

    const CasillaRuido = this.Casilla(Cuerpo, 'Ruido de Película', false, (V) => {
      Ctx.Escena.EstablecerRuido(V, parseFloat(CtrlRuido.Entrada.value));
    });
    const CtrlRuido = this.Deslizador(Cuerpo, 'Intensidad Ruido', 0, 1, 0.05, 0.25,
      (V) => Ctx.Escena.EstablecerRuido(CasillaRuido.checked, V),
      FormatoDec, RegEfecto('Efecto', 'RuidoIntensidad'), { Tipo: 'Efecto', Objetivo: 'RuidoIntensidad' });

    const CasillaFXAA = this.Casilla(Cuerpo, 'Suavizado FXAA', false, (V) => Ctx.Escena.EstablecerFXAA(V));

    // Partículas HDR Multi-Capa
    const TitPart = document.createElement('h3');
    TitPart.className = 'TituloSubLista';
    TitPart.textContent = 'Partículas HDR Multi-Capa';
    const FilaPart = document.createElement('div');
    FilaPart.className = 'FilaCompacta';
    const SelTipoPart = document.createElement('select');
    SelTipoPart.setAttribute('aria-label', 'Tipo de partículas');
    for (const Tipo of ['KiraKira', 'SakuraGlow', 'Estrellas', 'Chispas', 'Magia', 'Nieve', 'Lluvia', 'Petalos', 'Burbujas', 'Confeti']) {
      const O = document.createElement('option');
      O.value = Tipo; O.textContent = Tipo;
      SelTipoPart.appendChild(O);
    }
    const SelAnclaPart = document.createElement('select');
    SelAnclaPart.setAttribute('aria-label', 'Ancla de partículas');
    for (const [Val, Txt] of [
      ['', 'Escenario libre'],
      ['hips', 'Anclar: Cadera'],
      ['chest', 'Anclar: Pecho'],
      ['head', 'Anclar: Cabeza'],
      ['rightHand', 'Anclar: Mano D'],
      ['leftHand', 'Anclar: Mano I']
    ]) {
      const O = document.createElement('option');
      O.value = Val; O.textContent = Txt;
      SelAnclaPart.appendChild(O);
    }
    FilaPart.append(
      SelTipoPart,
      SelAnclaPart,
      this.Boton('+ Capa', () => {
        const Hueso = SelAnclaPart.value;
        Ctx.Efectos.AgregarCapa({
          Tipo: SelTipoPart.value as Exclude<TipoParticulas, 'Ninguno'>,
          AnclaHueso: Hueso ? { PersonajeId: Ctx.Modelos.PersonajeActivoId, Hueso } : null
        });
        this.RefrescarListaCapas();
      }),
      this.Boton('Limpiar', () => {
        Ctx.Efectos.LimpiarTodas();
        this.RefrescarListaCapas();
      })
    );
    this.ListaCapasContenedor = document.createElement('div');
    this.ListaCapasContenedor.className = 'ListaCompacta';
    Cuerpo.append(TitPart, FilaPart, this.ListaCapasContenedor);
    this.RefrescarListaCapas();

    this.SincronizadoresEscena.push(() => {
      const SetVal = (C: { Entrada: HTMLInputElement; Salida: HTMLOutputElement }, Val: number, Fmt: (v: number) => string = FormatoDec) => {
        C.Entrada.value = String(Val);
        C.Salida.textContent = Fmt(Val);
      };
      SetVal(CtrlExp, Ctx.Escena.Renderer.toneMappingExposure);
      SetVal(CtrlDir, Ctx.Escena.LuzDireccional.intensity);
      SetVal(CtrlAmb, Ctx.Escena.LuzAmbiental.intensity);
      CasillaLuzPers.checked = Ctx.Escena.LuzPersonajeActiva;
      SetVal(CtrlLuzPers, Ctx.Escena.IntensidadLuzPersonaje);
      if (Ctx.Escena.LuzPersonaje?.color) ColorLuzPers.value = `#${Ctx.Escena.LuzPersonaje.color.getHexString()}`;
      CasillaBloom.checked = Ctx.Escena.BloomActivo;
      SetVal(CtrlBloomFuerza, Ctx.Escena.BloomFuerza);
      SetVal(CtrlBloomRadio, Ctx.Escena.BloomRadio);
      SetVal(CtrlBloomUmbral, Ctx.Escena.BloomUmbral);
      CasillaDirt.checked = Ctx.Escena.LensDirtActivo;
      SetVal(CtrlDirtInt, Ctx.Escena.LensDirtIntensidad);
      CasillaDof.checked = Ctx.Escena.DofActivo;
      SelAutoFocus.value = Ctx.Escena.DofModoAutoFocus;
      SetVal(CtrlDofDist, Ctx.Escena.DofDistancia, (V) => `${V.toFixed(1)}m`);
      SetVal(CtrlDofAp, Ctx.Escena.DofApertura);
      CasillaCG.checked = Ctx.Escena.ColorGradingActivo;
      SetVal(CtrlTemp, Ctx.Escena.Temperatura);
      SetVal(CtrlTinte, Ctx.Escena.Tinte);
      SetVal(CtrlSat, Ctx.Escena.Saturacion);
      SetVal(CtrlCont, Ctx.Escena.Contraste);
      CasillaVigneta.checked = Ctx.Escena.VignetaActiva;
      ColorVigneta.value = Ctx.Escena.VignetaColor;
      SetVal(CtrlVigneta, Ctx.Escena.VignetaOscuridad);
      CasillaRGB.checked = Ctx.Escena.AberracionCromaticaActiva;
      SetVal(CtrlRGB, Ctx.Escena.AberracionCantidad, (V) => V.toFixed(4));
      CasillaRuido.checked = Ctx.Escena.RuidoActivo;
      SetVal(CtrlRuido, Ctx.Escena.RuidoIntensidad);
      CasillaFXAA.checked = Ctx.Escena.FxaaActivo;
    });
  }

  private RefrescarListaLuces(): void {
    const Cont = this.ListaLucesContenedor;
    if (!Cont) return;
    Cont.innerHTML = '';
    const Ctx = this.Contexto;

    for (const Item of Ctx.Escena.LucesEscenario) {
      const Cfg = Item.Config;
      const Card = document.createElement('div');
      Card.className = 'TarjetaMini';

      const Sup = document.createElement('div');
      Sup.className = 'FilaCompacta';
      const ActivaChk = document.createElement('input');
      ActivaChk.type = 'checkbox';
      ActivaChk.checked = Cfg.Activa;
      ActivaChk.onchange = () => Ctx.Escena.ActualizarLuzEscenario(Cfg.Id, { Activa: ActivaChk.checked });

      const NombreSpan = document.createElement('span');
      NombreSpan.textContent = Cfg.Nombre;
      NombreSpan.style.flex = '1';
      NombreSpan.style.fontSize = '11.5px';

      const ColorIn = document.createElement('input');
      ColorIn.type = 'color';
      ColorIn.value = Cfg.Color.slice(0, 7);
      ColorIn.oninput = () => Ctx.Escena.ActualizarLuzEscenario(Cfg.Id, { Color: ColorIn.value });

      const BtnGizmo = this.Boton('🎯 Gizmo', () => {
        Ctx.Escena.ControlTransformacion.attach(Item.Luz);
        Ctx.Escena.ControlTransformacion.setMode('translate');
        Ctx.NotificarEstado(`Gizmo anclado a "${Cfg.Nombre}".`, 'info');
      });
      const BtnDel = this.Boton('✕', () => {
        Ctx.Escena.EliminarLuzEscenario(Cfg.Id);
        this.RefrescarListaLuces();
      }, 'BotonIconoSolo BotonPeligro');

      Sup.append(ActivaChk, NombreSpan, ColorIn, BtnGizmo, BtnDel);
      Card.appendChild(Sup);

      this.Deslizador(Card, 'Intensidad', 0, 120, 1, Cfg.Intensidad,
        (V) => Ctx.Escena.ActualizarLuzEscenario(Cfg.Id, { Intensidad: V }),
        (V) => String(Math.round(V)));

      const Inf = document.createElement('div');
      Inf.className = 'FilaCompacta';
      this.Casilla(Inf, 'Haz vol.', Cfg.Volumetrica, (V) => Ctx.Escena.ActualizarLuzEscenario(Cfg.Id, { Volumetrica: V }));
      this.Casilla(Inf, 'Seguir VRM', Boolean(Cfg.SeguirPersonaje), (V) => Ctx.Escena.ActualizarLuzEscenario(Cfg.Id, { SeguirPersonaje: V }));
      Card.appendChild(Inf);

      this.Deslizador(Card, 'Auto-Rotar', -2, 2, 0.05, Cfg.AutoRotarVelocidad ?? 0,
        (V) => Ctx.Escena.ActualizarLuzEscenario(Cfg.Id, { AutoRotarVelocidad: V }),
        (V) => V.toFixed(2));

      Cont.appendChild(Card);
    }
  }

  private RefrescarListaCapas(): void {
    const Cont = this.ListaCapasContenedor;
    if (!Cont) return;
    Cont.innerHTML = '';
    const Ctx = this.Contexto;

    for (const Capa of Ctx.Efectos.Capas) {
      const Cfg = Capa.Config;
      const Card = document.createElement('div');
      Card.className = 'TarjetaMini';

      const Sup = document.createElement('div');
      Sup.className = 'FilaCompacta';
      const Chk = document.createElement('input');
      Chk.type = 'checkbox';
      Chk.checked = Cfg.Activa;
      Chk.onchange = () => Ctx.Efectos.ActualizarCapa(Cfg.Id, { Activa: Chk.checked });

      const Txt = document.createElement('span');
      Txt.textContent = Cfg.AnclaHueso ? `${Cfg.Nombre} (${Cfg.AnclaHueso.Hueso})` : Cfg.Nombre;
      Txt.style.flex = '1';
      Txt.style.fontSize = '11.5px';
      Sup.append(Chk, Txt);

      const ColorIn = document.createElement('input');
      ColorIn.type = 'color';
      ColorIn.value = Cfg.Color.slice(0, 7);
      ColorIn.oninput = () => Ctx.Efectos.ActualizarCapa(Cfg.Id, { Color: ColorIn.value });

      const BtnDel = this.Boton('✕', () => {
        Ctx.Efectos.EliminarCapa(Cfg.Id);
        this.RefrescarListaCapas();
      }, 'BotonIconoSolo BotonPeligro');

      Sup.append(ColorIn, BtnDel);
      Card.appendChild(Sup);

      this.Deslizador(Card, 'Emisión HDR', 0.2, 5.0, 0.1, Cfg.IntensidadEmision,
        (V) => Ctx.Efectos.ActualizarCapa(Cfg.Id, { IntensidadEmision: V }),
        (V) => V.toFixed(1));
      Cont.appendChild(Card);
    }
  }

  private ConstruirSeccionProps(Padre: HTMLElement): void {
    const Cuerpo = this.Seccion(Padre, 'Props 3D y Accesorios', false);
    const Ctx = this.Contexto;

    const FilaAdd = document.createElement('div');
    FilaAdd.className = 'FilaCompacta';
    const SelPreset = document.createElement('select');
    SelPreset.setAttribute('aria-label', 'Preajuste de Prop 3D');
    for (const P of PRESETS_PROPS) {
      const O = document.createElement('option');
      O.value = P.Id;
      O.textContent = P.HuesoSugerido ? `${P.Nombre} (Hueso)` : P.Nombre;
      SelPreset.appendChild(O);
    }

    FilaAdd.append(
      SelPreset,
      this.Boton('+ Añadir Prop', async () => {
        const Pre = PRESETS_PROPS.find((X) => X.Id === SelPreset.value);
        if (!Pre || !Ctx.Props) return;
        try {
          const Prop = await Ctx.Props.CargarDesdeUrl(Pre.Url, Pre.Nombre, {
            Modelos: Ctx.Modelos,
            PersonajeId: Pre.HuesoSugerido ? Ctx.Modelos.PersonajeActivoId : null,
            Hueso: Pre.HuesoSugerido,
            IntensidadEmision: Pre.IntensidadEmisionInicial
          });
          Ctx.Escena.ControlTransformacion.attach(Prop.Objeto);
          Ctx.Escena.ControlTransformacion.setMode('translate');
          Ctx.NotificarEstado(`Prop "${Pre.Nombre}" añadido. Usa W/E/S para mover, rotar o escalar.`, 'exito');
        } catch (E) { Ctx.NotificarEstado(`Error al cargar prop: ${(E as Error).message}`, 'error'); }
      }, 'BotonPrimario'),
      this.Boton('Cargar .glb…', async () => {
        const Arch = await SeleccionarArchivo('.glb,.gltf');
        if (!Arch || !Ctx.Props) return;
        try {
          const Prop = await Ctx.Props.CargarDesdeArchivo(Arch, { Modelos: Ctx.Modelos });
          Ctx.Escena.ControlTransformacion.attach(Prop.Objeto);
          Ctx.Escena.ControlTransformacion.setMode('translate');
          Ctx.NotificarEstado(`Prop cargado: ${Prop.Nombre}`, 'exito');
        } catch (E) { Ctx.NotificarEstado(`Error GLB: ${(E as Error).message}`, 'error'); }
      })
    );

    this.ListaPropsContenedor = document.createElement('div');
    this.ListaPropsContenedor.className = 'ListaCompacta';
    Cuerpo.append(FilaAdd, this.ListaPropsContenedor);
    this.RefrescarListaProps();
  }

  private RefrescarListaProps(): void {
    const Cont = this.ListaPropsContenedor;
    if (!Cont) return;
    Cont.innerHTML = '';
    const Ctx = this.Contexto;
    const Lista = Ctx.Props?.ObtenerProps() ?? [];
    if (Lista.length === 0) {
      this.Nota(Cont, 'Sin props en escena. Añade un podio, barra de luz o tu propio archivo .glb.');
      return;
    }

    for (const Prop of Lista) {
      const Card = document.createElement('div');
      Card.className = 'TarjetaMini';

      const Sup = document.createElement('div');
      Sup.className = 'FilaCompacta';
      const Chk = document.createElement('input');
      Chk.type = 'checkbox';
      Chk.checked = Prop.Visible;
      Chk.onchange = () => Ctx.Props?.EstablecerVisibilidad(Prop.Id, Chk.checked);

      const Nombre = document.createElement('span');
      Nombre.textContent = Prop.Nombre;
      Nombre.style.flex = '1';
      Nombre.style.fontSize = '11.5px';

      const BtnGizmo = this.Boton('🎯 Gizmo', () => {
        Ctx.Props?.SeleccionarProp(Prop.Id);
        Ctx.Escena.ControlTransformacion.attach(Prop.Objeto);
        Ctx.NotificarEstado(`Prop "${Prop.Nombre}" listo (W=Mover, E=Rotar, S=Escalar).`, 'info');
      });

      const BtnDel = this.Boton('✕', () => {
        Ctx.Props?.EliminarProp(Prop.Id, (Obj) => {
          if (Ctx.Escena.ControlTransformacion.object === Obj) Ctx.Escena.ControlTransformacion.detach();
        });
      }, 'BotonIconoSolo BotonPeligro');

      Sup.append(Chk, Nombre, BtnGizmo, BtnDel);
      Card.appendChild(Sup);

      // Adjuntar a hueso del personaje
      const FilaHueso = document.createElement('div');
      FilaHueso.className = 'FilaCompacta';
      const SelHueso = document.createElement('select');
      SelHueso.setAttribute('aria-label', `Adjuntar ${Prop.Nombre} a hueso`);
      for (const [Val, Txt] of [
        ['', 'Libre en escenario'],
        ['rightHand', 'Mano derecha'],
        ['leftHand', 'Mano izquierda'],
        ['head', 'Cabeza'],
        ['chest', 'Pecho'],
        ['spine', 'Columna'],
        ['hips', 'Cadera'],
        ['rightFoot', 'Pie derecho'],
        ['leftFoot', 'Pie izquierdo']
      ]) {
        const O = document.createElement('option');
        O.value = Val; O.textContent = Txt;
        SelHueso.appendChild(O);
      }
      SelHueso.value = Prop.Hueso ?? '';
      SelHueso.onchange = () => {
        const Hueso = SelHueso.value || null;
        const PersId = Hueso ? Ctx.Modelos.PersonajeActivoId : null;
        Ctx.Props?.AdjuntarAHueso(Prop.Id, PersId, Hueso, Ctx.Modelos);
      };
      FilaHueso.append(SelHueso);
      Card.appendChild(FilaHueso);

      // Emisión HDR
      const FilaEmision = document.createElement('div');
      FilaEmision.className = 'FilaCompacta';
      const ColorEm = document.createElement('input');
      ColorEm.type = 'color';
      ColorEm.value = Prop.ColorEmision;
      ColorEm.oninput = () => Ctx.Props?.EstablecerEmision(Prop.Id, ColorEm.value, Prop.IntensidadEmision);
      FilaEmision.appendChild(ColorEm);
      Card.appendChild(FilaEmision);

      this.Deslizador(Card, 'Brillo HDR', 0, 8, 0.1, Prop.IntensidadEmision,
        (V) => Ctx.Props?.EstablecerEmision(Prop.Id, ColorEm.value, V),
        (V) => V.toFixed(1));

      Cont.appendChild(Card);
    }
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
        new ComandoGuardarClave(Ctx.Animacion, 'CamaraFOV', 'Campo de Visión', 'Manual', T, [FOV], Interp),
        new ComandoGuardarClave(Ctx.Animacion, 'CamaraRoll', 'Inclinación (Roll)', 'Manual', T, [Ctx.Escena.RollCamara], Interp)
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
    const CtrlRoll = this.Deslizador(Cuerpo, 'Inclinación (Roll)', -180, 180, 1, AGrados(Ctx.Escena.RollCamara),
      (V) => Ctx.Escena.EstablecerRollCamara(ARadianes(V)),
      (V) => `${V.toFixed(0)}°`,
      {
        AlKeyframe: (V) => {
          const Cmd = new ComandoGuardarClave(
            Ctx.Animacion, 'CamaraRoll', 'Inclinación (Roll)', 'Manual',
            Ctx.Animacion.TiempoActual, [ARadianes(V)], Ctx.Estado.InterpolacionPorDefecto
          );
          Ctx.Historial.Ejecutar(Cmd);
          Ctx.NotificarEstado('Clave de Roll guardada.', 'exito', true);
        }
      }
    );

    const FilaSeg = document.createElement('div');
    FilaSeg.className = 'FilaControles';
    const LblSeg = document.createElement('label');
    LblSeg.className = 'EtiquetaCompacta';
    const SelSeg = document.createElement('select');
    for (const [Val, Etq] of [['Ninguno', 'Libre'], ['Cabeza', 'Seguir Cabeza'], ['Cuerpo', 'Seguir Cuerpo']]) {
      const O = document.createElement('option');
      O.value = Val; O.textContent = Etq;
      SelSeg.appendChild(O);
    }
    SelSeg.onchange = () => { Ctx.Escena.SeguimientoCamara = SelSeg.value as any; };
    LblSeg.append(document.createTextNode('Auto-Follow '), SelSeg);
    FilaSeg.appendChild(LblSeg);
    Cuerpo.appendChild(FilaSeg);

    this.Deslizador(Cuerpo, 'Vibración mano', 0, 1, 0.05, Ctx.Escena.VibracionCamara,
      (V) => { Ctx.Escena.VibracionCamara = V; });

    this.SincronizadoresEscena.push(() => {
      CtrlFov.Entrada.value = String(Ctx.Escena.Camara.fov);
      CtrlFov.Salida.textContent = `${Ctx.Escena.Camara.fov.toFixed(0)}°`;
      const RollDeg = AGrados(Ctx.Escena.RollCamara);
      CtrlRoll.Entrada.value = String(RollDeg);
      CtrlRoll.Salida.textContent = `${RollDeg.toFixed(0)}°`;
      SelSeg.value = Ctx.Escena.SeguimientoCamara;
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

    // Lip-Sync automático desde audio (Goertzel F1/F2)
    const TitLip = document.createElement('h3');
    TitLip.className = 'TituloSubLista';
    TitLip.textContent = 'Lip-Sync Automático (Vocales VRM)';
    const CtrlSensLip = this.Deslizador(Cuerpo, 'Sensibilidad', 0.6, 3.5, 0.1, 1.6, () => {});
    const CtrlSuavLip = this.Deslizador(Cuerpo, 'Suavizado', 0.0, 0.85, 0.05, 0.42, () => {});
    const CasillaReempLip = this.Casilla(Cuerpo, 'Reemplazar lip-sync anterior', true, () => {});
    const BtnLip = this.Boton('🗣 Generar Lip-Sync en Timeline', () => {
      this.GenerarLipSyncDesdeAudioActual({
        Sensibilidad: parseFloat(CtrlSensLip.Entrada.value),
        Suavizado: parseFloat(CtrlSuavLip.Entrada.value),
        Reemplazar: CasillaReempLip.checked
      });
    }, 'BotonPrimario');
    Cuerpo.append(TitLip, BtnLip);

    this.SincronizadoresEscena.push(() => {
      CtrlVolumen.Entrada.value = String(Ctx.Audio.Volumen);
      CtrlVolumen.Salida.textContent = Ctx.Audio.Volumen.toFixed(2);
      EntradaDesplazamiento.value = String(Ctx.Audio.Desplazamiento);
    });
  }

  private GenerarLipSyncDesdeAudioActual(Opts?: { Sensibilidad?: number; Suavizado?: number; Reemplazar?: boolean }): void {
    const Ctx = this.Contexto;
    if (!Ctx.Audio.Buffer) {
      Ctx.NotificarEstado('Carga una pista de audio primero para analizar los formantes.', 'aviso');
      return;
    }
    const PersId = Ctx.Modelos.PersonajeActivoId ?? undefined;
    if (!PersId) {
      Ctx.NotificarEstado('Carga un modelo VRM primero para recibir las claves faciales.', 'aviso');
      return;
    }

    const Resultado = AnalizarLipSyncDesdeAudio(Ctx.Audio.Buffer, {
      Fps: 24,
      Sensibilidad: Opts?.Sensibilidad ?? 1.6,
      Suavizado: Opts?.Suavizado ?? 0.42,
      Desplazamiento: Ctx.Audio.Desplazamiento
    });

    const ExpsModelo = Ctx.Modelos.ObtenerExpresiones(PersId);
    const Alias0: Record<VocalVrm, string> = { aa: 'a', ih: 'i', ou: 'u', ee: 'e', oh: 'o' };
    const MapNombre = (V: VocalVrm) => (ExpsModelo.includes(V) ? V : (ExpsModelo.includes(Alias0[V]) ? Alias0[V] : V));
    const SetVocales = new Set(['aa', 'ih', 'ou', 'ee', 'oh', 'a', 'i', 'u', 'e', 'o']);

    const Pers = Ctx.Modelos.ObtenerPersonaje(PersId);
    const Prefijo = Pers && Ctx.Modelos.Personajes.length > 1 ? `[${Pers.Nombre.replace(/\.vrm$/i, '').slice(0, 12)}] ` : '';

    const NuevasPistas: PistaAnimacion[] = [];
    let TotalClaves = 0;
    for (const V of VOCALES_LIPSYNC) {
      const ClavesRaw = Resultado.ClavesPorVocal[V];
      if (!ClavesRaw.some((C) => C.Valor > 0.03)) continue;
      const Obj = MapNombre(V);
      TotalClaves += ClavesRaw.length;
      NuevasPistas.push({
        Id: GenerarId(),
        Nombre: `${Prefijo}Rostro · Lip-Sync ${Obj}`,
        Tipo: 'Expresion',
        Objetivo: Obj,
        Grupo: 'SeguimientoRostro',
        PersonajeId: PersId,
        Claves: ClavesRaw.map((C) => ({
          Id: GenerarId(),
          Tiempo: C.Tiempo,
          Valor: [C.Valor],
          Interpolacion: 'Suave'
        }))
      });
    }

    if (NuevasPistas.length === 0) {
      Ctx.NotificarEstado('No se detectó energía vocal suficiente en la pista de audio.', 'aviso');
      return;
    }

    const Comandos = [];
    if (Opts?.Reemplazar !== false) {
      for (const P of Ctx.Animacion.Pistas) {
        const MismoPers = !PersId || !P.PersonajeId || P.PersonajeId === PersId;
        if (P.Grupo === 'SeguimientoRostro' && P.Tipo === 'Expresion' && SetVocales.has(P.Objetivo.toLowerCase()) && MismoPers) {
          Comandos.push(new ComandoEliminarPista(Ctx.Animacion, { tipo: 'pista', pistaId: P.Id, nombre: P.Nombre }, Ctx.Estado));
        }
      }
    }

    Comandos.push(new ComandoImportarAnimacion(
      Ctx.Animacion,
      NuevasPistas,
      {
        TiempoInicio: 0,
        EscalaTiempo: 1,
        FpsMuestreo: 24,
        Modo: 'Combinar',
        Simplificar: false,
        ToleranciaSimplificacion: 0.02,
        GrupoDestino: 'SeguimientoRostro',
        PersonajeId: PersId
      },
      Resultado.Duracion,
      Ctx.Audio.NombreArchivo || 'LipSync'
    ));

    Ctx.Historial.Ejecutar(new ComandoLote('Generar Lip-Sync desde Audio', Comandos));
    Ctx.NotificarEstado(`Lip-Sync generado: ${NuevasPistas.length} vocales, ${TotalClaves} claves (${Resultado.Picos} picos).`, 'exito', true);
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
    const PersId = this.Contexto.Modelos.PersonajeActivoId ?? undefined;

    if (this.BotonClaveHueso && Hueso) {
      const Pista = Anim.BuscarPista('HuesoRotacion', Hueso, 'Manual', PersId);
      const Existe = Pista ? Anim.BuscarClaveEnTiempo(Pista, T) !== undefined : false;
      this.BotonClaveHueso.textContent = Existe ? '◆ Sobrescribir rotación' : '◆ Clave rotación';
      this.BotonClaveHueso.classList.toggle('EstadoSobrescribir', Existe);
      this.BotonBorrarClaveHueso.disabled = !Existe;
    }

    if (this.BotonClaveCadera) {
      const PistaPos = Anim.BuscarPista('HuesoPosicion', 'hips', 'Manual', PersId);
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
      const Pista = Anim.BuscarPista('Expresion', Item.Expresion, 'Manual', PersId);
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
    this.RefrescarListaPersonajes();
    this.EtiquetaModelo.textContent = this.Contexto.Modelos.Vrm
      ? `Modelo (${this.Contexto.Modelos.Personajes.length}): ${this.Contexto.Modelos.NombreModelo}`
      : 'Ningún archivo cargado';
    this.ActualizarChipsHuesoActivo(this.Contexto.Estado.HuesoSeleccionado);
    this.ActualizarIndicadoresClave();
  }
}

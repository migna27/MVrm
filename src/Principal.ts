// ============================================================================
// Principal.ts — Punto de entrada e integrador arquitectónico del Estudio VRM
// Conecta BusEventos, HistorialComandos, EstadoEstudio, ServicioImportacion,
// LineaTiempo, PanelLateral, modales nativos, Auto-Clave y el bucle 3D.
// ============================================================================

import * as THREE from 'three';
import './Interfaz/Estilos.css';
import { GestorEscena } from './Nucleo/GestorEscena';
import { GestorModelos, NOMBRES_HUESOS_LEGIBLES } from './Nucleo/GestorModelos';
import { GestorAnimacion } from './Nucleo/GestorAnimacion';
import { GestorAudio } from './Nucleo/GestorAudio';
import { GestorEfectos, TipoParticulas } from './Nucleo/GestorEfectos';
import { GestorExportacion } from './Nucleo/GestorExportacion';
import { GestorVMC } from './Nucleo/GestorVMC';
import { BusEventos } from './Arquitectura/BusEventos';
import { HistorialComandos } from './Arquitectura/HistorialComandos';
import { EstadoEstudio } from './Arquitectura/EstadoEstudio';
import { ServicioAutoguardado } from './Arquitectura/ServicioAutoguardado';
import { LISTA_INTERPOLACIONES } from './Arquitectura/EstrategiasInterpolacion';
import { ServicioImportacion } from './Arquitectura/ImportadoresAnimacion';
import {
  ComandoCambiarInterpolacionLote, ComandoDesplazarPistas, ComandoEliminarClaves,
  ComandoEliminarPista, ComandoGuardarClave, ComandoInsertarPose, ComandoSimplificarPistas
} from './Arquitectura/ComandosAnimacion';
import { ContextoAplicacion } from './Contexto';
import { DatosProyecto, GrupoPista, SeleccionClave } from './Tipos';
import { LineaTiempo, ObjetivoContextoTimeline } from './Interfaz/LineaTiempo';
import { PanelLateral } from './Interfaz/PanelLateral';
import { ModalExportacion } from './Interfaz/ModalExportacion';
import { ModalImportacion } from './Interfaz/ModalImportacion';
import { SistemaNotificaciones } from './Interfaz/Componentes/SistemaNotificaciones';
import { ModalAtajos } from './Interfaz/Componentes/ModalAtajos';
import { ElementoMenuContextual, MenuContextual } from './Interfaz/Componentes/MenuContextual';
import { ConfirmarAccion, SolicitarNumeroDialogo } from './Interfaz/Componentes/UtilidadesDialogo';
import {
  FormatearTiempo, SeleccionarArchivo, LeerArchivoTexto, DescargarTexto, Limitar
} from './Utilidades';

// ----------------------------------------------------------------------------
// Inicialización arquitectónica y creación de gestores
// ----------------------------------------------------------------------------

const Bus = new BusEventos();
const Historial = new HistorialComandos(Bus);
const Estado = new EstadoEstudio(Bus);

const Escena = new GestorEscena();
Escena.Inicializar(document.getElementById('Visor3D')!);

const Modelos = new GestorModelos(Escena.Escena);
const Animacion = new GestorAnimacion(Modelos, Escena, Bus);
const Audio = new GestorAudio();
const Efectos = new GestorEfectos(Escena.Escena);
const Exportador = new GestorExportacion();
const Importador = new ServicioImportacion();
const Notificaciones = new SistemaNotificaciones(Bus, Historial);
const MenuCtx = new MenuContextual();

let Linea!: LineaTiempo;
let Panel!: PanelLateral;

const Contexto: ContextoAplicacion = {
  Bus,
  Historial,
  Estado,
  Escena,
  Modelos,
  Animacion,
  Audio,
  Efectos,
  Exportador,
  VMC: null as unknown as GestorVMC,
  Importador,
  NotificarEstado: (Mensaje, Tipo = 'info', PermitirDeshacer = false) => {
    Bus.Emitir('estado:notificar', { mensaje: Mensaje, tipo: Tipo, permitirDeshacer: PermitirDeshacer });
  },
  RefrescarLineaTiempo: () => Linea?.SolicitarDibujo(),
  RefrescarPanel: () => Panel?.RefrescarDinamico()
};

Contexto.VMC = new GestorVMC(Contexto);
Panel = new PanelLateral(
  document.getElementById('PanelIzquierdo')!,
  document.getElementById('PanelDerecho')!,
  Contexto
);
Linea = new LineaTiempo(document.getElementById('LienzoLineaTiempo') as HTMLCanvasElement, Contexto);
new ModalExportacion(Contexto);
const ModalImp = new ModalImportacion(Contexto);

Panel.AlSolicitarImportacion = (Archivo) => void ModalImp.AbrirConArchivo(Archivo);

const ModalGuiaAtajos = new ModalAtajos();
let MostrarRecuperarInicio = false;

const BotonRecuperarAutosave = document.getElementById('BotonRecuperarAutosave') as HTMLButtonElement;
const BotonAtajos = document.getElementById('BotonAtajos') as HTMLButtonElement;
const TarjetaBienvenida = document.getElementById('TarjetaBienvenida')!;

function ActualizarVisibilidadAutosave(): void {
  const Resumen = MostrarRecuperarInicio ? Autoguardado.ObtenerResumen() : null;
  if (Resumen) {
    BotonRecuperarAutosave.classList.remove('Oculto');
    BotonRecuperarAutosave.title = `Recuperar sesión autoguardada (${Resumen.Pistas} pistas · ${Resumen.Duracion}s)`;
  } else {
    BotonRecuperarAutosave.classList.add('Oculto');
  }
}

const Autoguardado = new ServicioAutoguardado(Contexto, () => ActualizarVisibilidadAutosave());
MostrarRecuperarInicio = Autoguardado.TieneRespaldo();
ActualizarVisibilidadAutosave();

Bus.Suscribir('pistas:cambiadas', (D) => {
  if (D.motivo !== 'autoguardado-restaurado' && MostrarRecuperarInicio) {
    MostrarRecuperarInicio = false;
    ActualizarVisibilidadAutosave();
  }
});

BotonAtajos.onclick = () => ModalGuiaAtajos.Abrir();

BotonRecuperarAutosave.onclick = async () => {
  if (Animacion.Pistas.length > 0) {
    const Ok = await ConfirmarAccion({
      Titulo: 'Restaurar sesión autoguardada',
      Mensaje: 'Se reemplazará la animación actual con la última copia autoguardada.',
      TextoConfirmar: 'Restaurar'
    });
    if (!Ok) return;
  }
  MostrarRecuperarInicio = false;
  ActualizarVisibilidadAutosave();
  if (Autoguardado.Restaurar()) {
    EntradaDuracion.value = String(Animacion.Duracion);
    Panel.SincronizarControlesEscena();
    Linea.AjustarVista();
  }
};

document.getElementById('BotonOcultarBienvenida')!.onclick = () => TarjetaBienvenida.classList.add('Oculto');
document.getElementById('BotonBienvenidaCargar')!.onclick = async () => {
  const Archivo = await SeleccionarArchivo('.vrm');
  if (!Archivo) return;
  try {
    Contexto.NotificarEstado(`Cargando ${Archivo.name}…`);
    Escena.ControlTransformacion.detach();
    await Modelos.CargarVrm(Archivo);
    Panel.RefrescarDinamico();
    Bus.Emitir('modelo:cargado', { nombre: Archivo.name });
    void SubirArchivoLocal(Archivo, 'models');
    Contexto.NotificarEstado(`Modelo listo: ${Archivo.name}`, 'exito');
  } catch (E) {
    Contexto.NotificarEstado(`Error al cargar: ${(E as Error).message}`, 'error');
  }
};

const BotonBienvenidaEjemplo = document.getElementById('BotonBienvenidaEjemplo') as HTMLButtonElement;
BotonBienvenidaEjemplo.onclick = async () => {
  BotonBienvenidaEjemplo.disabled = true;
  BotonBienvenidaEjemplo.textContent = 'Cargando ejemplo…';
  Contexto.NotificarEstado('Descargando modelo de ejemplo…');
  try {
    Escena.ControlTransformacion.detach();
    await Modelos.CargarVrmDesdeUrl(
      'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/three-vrm-girl.vrm'
    );
    Panel.RefrescarDinamico();
    Bus.Emitir('modelo:cargado', { nombre: Modelos.NombreModelo });
    Contexto.NotificarEstado('Modelo de ejemplo listo para animar.', 'exito');
  } catch (E) {
    Contexto.NotificarEstado(`Error al cargar ejemplo: ${(E as Error).message}`, 'error');
  } finally {
    BotonBienvenidaEjemplo.disabled = false;
    BotonBienvenidaEjemplo.textContent = '✨ Probar modelo de ejemplo';
  }
};

Bus.Suscribir('modelo:cargado', () => {
  TarjetaBienvenida.classList.add('Oculto');
});

// ----------------------------------------------------------------------------
// Referencias del DOM y actualización reactiva de interfaz
// ----------------------------------------------------------------------------

const AplicacionElem = document.getElementById('Aplicacion')!;
const IndicadorFps = document.getElementById('IndicadorFps')!;
const IndicadorTiempo = document.getElementById('IndicadorTiempo')!;
const IndicadorCuadro = document.getElementById('IndicadorCuadro')!;
const InsigniaHueso = document.getElementById('InsigniaHueso')!;
const IndicadorAutoClave = document.getElementById('IndicadorAutoClave')!;

const BotonDeshacer = document.getElementById('BotonDeshacer') as HTMLButtonElement;
const BotonRehacer = document.getElementById('BotonRehacer') as HTMLButtonElement;
const BotonReproducir = document.getElementById('BotonReproducir') as HTMLButtonElement;
const BotonBucle = document.getElementById('BotonBucle') as HTMLButtonElement;
const BotonRangoBucle = document.getElementById('BotonRangoBucle') as HTMLButtonElement;
const SelectorVelocidad = document.getElementById('SelectorVelocidad') as HTMLSelectElement;
const EntradaDuracion = document.getElementById('EntradaDuracion') as HTMLInputElement;
const BotonAutoClave = document.getElementById('BotonAutoClave') as HTMLButtonElement;
const BotonInsertarPose = document.getElementById('BotonInsertarPose') as HTMLButtonElement;
const BotonEliminarClave = document.getElementById('BotonEliminarClave') as HTMLButtonElement;
const BotonIman = document.getElementById('BotonIman') as HTMLButtonElement;
const SelectorPasoIman = document.getElementById('SelectorPasoIman') as HTMLSelectElement;
const FiltroPistas = document.getElementById('FiltroPistas') as HTMLInputElement;
const DeslizadorZoom = document.getElementById('DeslizadorZoom') as HTMLInputElement;

const BotonGizmoNinguno = document.getElementById('BotonGizmoNinguno') as HTMLButtonElement;
const BotonGizmoMover = document.getElementById('BotonGizmoMover') as HTMLButtonElement;
const BotonGizmoRotar = document.getElementById('BotonGizmoRotar') as HTMLButtonElement;
const BotonGizmoEspacio = document.getElementById('BotonGizmoEspacio') as HTMLButtonElement;
const BotonEsqueletoVisor = document.getElementById('BotonEsqueletoVisor') as HTMLButtonElement;

let UltimoTextoTiempo = '';
let UltimoTextoCuadro = '';

function ActualizarIndicadoresTiempo(): void {
  const TextoT = `${FormatearTiempo(Animacion.TiempoActual)} / ${FormatearTiempo(Animacion.Duracion)}`;
  if (TextoT !== UltimoTextoTiempo) {
    UltimoTextoTiempo = TextoT;
    IndicadorTiempo.textContent = TextoT;
  }
  const Cuadro = Math.round(Animacion.TiempoActual * 30);
  const TextoC = `F${String(Cuadro).padStart(3, '0')}`;
  if (TextoC !== UltimoTextoCuadro) {
    UltimoTextoCuadro = TextoC;
    IndicadorCuadro.textContent = TextoC;
  }
}

function ActualizarEstadoBotonPose(): void {
  const HayAqui = Animacion.ExisteClaveEnTiempo(Animacion.TiempoActual);
  BotonInsertarPose.textContent = HayAqui ? '◆ Sobrescribir pose' : '◆ Insertar pose';
  BotonInsertarPose.classList.toggle('EstadoSobrescribir', HayAqui);
}

function SincronizarBotonesGizmo(): void {
  const Modo = Escena.ControlTransformacion.mode;
  const TieneObj = Boolean(Escena.ControlTransformacion.object);
  BotonGizmoNinguno.setAttribute('aria-pressed', String(!TieneObj));
  BotonGizmoMover.setAttribute('aria-pressed', String(TieneObj && Modo === 'translate'));
  BotonGizmoRotar.setAttribute('aria-pressed', String(TieneObj && Modo === 'rotate'));
  const EsMundo = Escena.ControlTransformacion.space === 'world';
  BotonGizmoEspacio.setAttribute('aria-pressed', String(EsMundo));
  BotonGizmoEspacio.textContent = EsMundo ? 'Mundo R' : 'Local R';
}

Bus.Suscribir('historial:cambiado', (H) => {
  BotonDeshacer.setAttribute('aria-disabled', String(!H.puedeDeshacer));
  BotonRehacer.setAttribute('aria-disabled', String(!H.puedeRehacer));
  BotonDeshacer.title = H.ultimoDeshacer ? `Deshacer: ${H.ultimoDeshacer} (Ctrl+Z)` : 'Nada para deshacer (Ctrl+Z)';
  BotonRehacer.title = H.ultimoRehacer ? `Rehacer: ${H.ultimoRehacer} (Ctrl+Y)` : 'Nada para rehacer (Ctrl+Y)';
});

Bus.Suscribir('seleccion:cambiada', (S) => {
  BotonEliminarClave.setAttribute('aria-disabled', String(S.seleccion.length === 0));
  BotonEliminarClave.textContent = S.seleccion.length > 1 ? `🗑 Claves (${S.seleccion.length})` : '🗑 Clave';
});

Bus.Suscribir('pistas:cambiadas', () => {
  ActualizarEstadoBotonPose();
  ActualizarIndicadoresTiempo();
});

Bus.Suscribir('tiempo:cambiado', () => {
  ActualizarIndicadoresTiempo();
  ActualizarEstadoBotonPose();
});

Bus.Suscribir('reproduccion:cambiada', (R) => {
  BotonReproducir.textContent = R.reproduciendo ? '⏸' : '▶';
  BotonReproducir.setAttribute('aria-pressed', String(R.reproduciendo));
  if (!R.reproduciendo) ActualizarEstadoBotonPose();
});

Bus.Suscribir('hueso:seleccionado', (D) => {
  InsigniaHueso.textContent = D.hueso
    ? `Hueso: ${NOMBRES_HUESOS_LEGIBLES[D.hueso] ?? D.hueso}`
    : 'Hueso: —';
});

Bus.Suscribir('estudio:configuracion', () => {
  BotonAutoClave.setAttribute('aria-pressed', String(Estado.AutoClave));
  IndicadorAutoClave.classList.toggle('Oculto', !Estado.AutoClave);
  BotonIman.setAttribute('aria-pressed', String(Estado.ImanActivo));
  BotonRangoBucle.setAttribute('aria-pressed', String(Estado.RangoBucle.Activo));
});

// ----------------------------------------------------------------------------
// Acciones de transporte, historial, teclado y visor
// ----------------------------------------------------------------------------

function AlternarReproduccion(): void {
  if (Animacion.Reproduciendo) {
    Animacion.Pausar();
    Audio.Detener();
  } else {
    if (Estado.RangoBucle.Activo && Animacion.TiempoActual < Estado.RangoBucle.Inicio) {
      Animacion.EstablecerTiempo(Estado.RangoBucle.Inicio, 'usuario');
    }
    Animacion.Reproducir();
    Audio.ReproducirDesde(Animacion.TiempoActual);
  }
}

function IrAClave(Direccion: 'anterior' | 'siguiente'): void {
  const T = Direccion === 'anterior'
    ? Animacion.BuscarTiempoClaveAnterior(Animacion.TiempoActual)
    : Animacion.BuscarTiempoClaveSiguiente(Animacion.TiempoActual);
  if (T === null) {
    Contexto.NotificarEstado(
      Direccion === 'anterior' ? 'No hay claves anteriores.' : 'No hay claves posteriores.',
      'info'
    );
    return;
  }
  Animacion.EstablecerTiempo(T, 'usuario');
  Animacion.EvaluarEn(T);
  Panel.SincronizarDeslizadoresHueso();
}

function EjecutarPoseCompleta(): void {
  if (!Modelos.Vrm) {
    Contexto.NotificarEstado('Carga primero un modelo VRM.', 'aviso');
    return;
  }
  const Cmd = new ComandoInsertarPose(Animacion, Animacion.TiempoActual, Estado.InterpolacionPorDefecto);
  Historial.Ejecutar(Cmd);
  Contexto.NotificarEstado(
    `Pose guardada en ${FormatearTiempo(Animacion.TiempoActual)} (${Cmd.Insertadas} nueva(s), ${Cmd.Sobrescritas} sobrescrita(s)).`,
    'exito', true
  );
}

BotonDeshacer.onclick = () => {
  if (BotonDeshacer.getAttribute('aria-disabled') === 'true') return;
  Historial.Deshacer();
  Panel.SincronizarDeslizadoresHueso();
};

BotonRehacer.onclick = () => {
  if (BotonRehacer.getAttribute('aria-disabled') === 'true') return;
  Historial.Rehacer();
  Panel.SincronizarDeslizadoresHueso();
};

BotonReproducir.onclick = AlternarReproduccion;
document.getElementById('BotonInicio')!.onclick = () => {
  const T = Estado.RangoBucle.Activo ? Estado.RangoBucle.Inicio : 0;
  Animacion.EstablecerTiempo(T, 'usuario');
  if (Animacion.Reproduciendo) Audio.ReproducirDesde(T);
  Animacion.EvaluarEn(T);
};
document.getElementById('BotonDetener')!.onclick = () => {
  Animacion.Detener();
  Audio.Detener();
  Animacion.EvaluarEn(0);
};
document.getElementById('BotonClaveAnterior')!.onclick = () => IrAClave('anterior');
document.getElementById('BotonClaveSiguiente')!.onclick = () => IrAClave('siguiente');

BotonBucle.onclick = () => {
  Animacion.EnBucle = !Animacion.EnBucle;
  BotonBucle.setAttribute('aria-pressed', String(Animacion.EnBucle));
};

BotonRangoBucle.onclick = () => {
  const Activo = !Estado.RangoBucle.Activo;
  if (Activo && Estado.RangoBucle.Fin > Animacion.Duracion) {
    Estado.EstablecerRangoBucle({ Activo, Inicio: 0, Fin: Animacion.Duracion }, Animacion.Duracion);
  } else {
    Estado.EstablecerRangoBucle({ Activo }, Animacion.Duracion);
  }
};

SelectorVelocidad.onchange = () => {
  Estado.VelocidadReproduccion = parseFloat(SelectorVelocidad.value) || 1;
};

EntradaDuracion.onchange = () => {
  Animacion.Duracion = Limitar(parseFloat(EntradaDuracion.value) || 10, 1, 600);
  EntradaDuracion.value = String(Animacion.Duracion);
  ActualizarIndicadoresTiempo();
  Linea.SolicitarDibujo();
};

BotonAutoClave.onclick = () => {
  Estado.AutoClave = !Estado.AutoClave;
  Contexto.NotificarEstado(
    Estado.AutoClave ? 'Auto-Clave activado: posar huesos grabará claves automáticamente.' : 'Auto-Clave desactivado.',
    'info'
  );
};

BotonInsertarPose.onclick = EjecutarPoseCompleta;
BotonEliminarClave.onclick = () => {
  if (BotonEliminarClave.getAttribute('aria-disabled') === 'true') return;
  Linea.EliminarSeleccion();
};

document.getElementById('BotonImportarAnimacion')!.onclick = async () => {
  const Archivo = await SeleccionarArchivo('.vrma,.bvh,.glb,.gltf,.json');
  if (Archivo) void ModalImp.AbrirConArchivo(Archivo);
};

BotonIman.onclick = () => { Estado.ImanActivo = !Estado.ImanActivo; };
SelectorPasoIman.onchange = () => { Estado.PasoIman = parseFloat(SelectorPasoIman.value) || 1 / 24; };
FiltroPistas.oninput = () => { Estado.FiltroPistas = FiltroPistas.value; };
document.getElementById('BotonAjustarVista')!.onclick = () => Linea.AjustarVista();

DeslizadorZoom.oninput = () => {
  Linea.PxPorSegundo = parseFloat(DeslizadorZoom.value);
  Linea.SolicitarDibujo();
};
Linea.AlCambiarZoom = (Px) => { DeslizadorZoom.value = String(Math.round(Px)); };

(document.getElementById('SelectorCalidadPrevia') as HTMLSelectElement).onchange = (E) => {
  Escena.EstablecerEscalaPrevia(parseFloat((E.target as HTMLSelectElement).value));
};

// Barra flotante del visor 3D
BotonGizmoNinguno.onclick = () => { Escena.ControlTransformacion.detach(); SincronizarBotonesGizmo(); };
BotonGizmoMover.onclick = () => {
  if (!Escena.ControlTransformacion.object && Estado.HuesoSeleccionado) {
    const N = Modelos.ObtenerNodoHueso(Estado.HuesoSeleccionado);
    if (N) Escena.ControlTransformacion.attach(N);
  }
  Escena.ControlTransformacion.setMode('translate');
  SincronizarBotonesGizmo();
};
BotonGizmoRotar.onclick = () => {
  if (!Escena.ControlTransformacion.object && Estado.HuesoSeleccionado) {
    const N = Modelos.ObtenerNodoHueso(Estado.HuesoSeleccionado);
    if (N) Escena.ControlTransformacion.attach(N);
  }
  Escena.ControlTransformacion.setMode('rotate');
  SincronizarBotonesGizmo();
};
BotonGizmoEspacio.onclick = () => {
  Escena.ControlTransformacion.setSpace(Escena.ControlTransformacion.space === 'local' ? 'world' : 'local');
  SincronizarBotonesGizmo();
};
let EsqueletoVisible = false;
BotonEsqueletoVisor.onclick = () => {
  EsqueletoVisible = !EsqueletoVisible;
  Modelos.AlternarAyudante(EsqueletoVisible);
  BotonEsqueletoVisor.setAttribute('aria-pressed', String(EsqueletoVisible));
};
document.getElementById('BotonEspejarVisor')!.onclick = () => {
  if (Animacion.EspejarPoseActual()) {
    Panel.SincronizarDeslizadoresHueso();
    Contexto.NotificarEstado('Pose espejada izquierda ↔ derecha.', 'info');
  }
};
document.getElementById('BotonReposoVisor')!.onclick = () => {
  Modelos.RestablecerPose();
  Panel.SincronizarDeslizadoresHueso();
};
document.getElementById('BotonCamFrontal')!.onclick = () => Escena.EnfocarVistaPreajuste('frontal');
document.getElementById('BotonCamTresCuartos')!.onclick = () => Escena.EnfocarVistaPreajuste('tresCuartos');
document.getElementById('BotonCamPerfil')!.onclick = () => Escena.EnfocarVistaPreajuste('perfil');
document.getElementById('BotonCamRostro')!.onclick = () => Escena.EnfocarVistaPreajuste('rostro');

// ----------------------------------------------------------------------------
// Divisor redimensionable del timeline (ratón + teclado)
// ----------------------------------------------------------------------------

const DivisorTimeline = document.getElementById('DivisorTimeline')!;
let AltoTimelineActual = 258;

function AplicarAltoTimeline(Px: number): void {
  AltoTimelineActual = Limitar(Math.round(Px), 150, Math.min(480, window.innerHeight - 240));
  AplicacionElem.style.setProperty('--AltoTimeline', `${AltoTimelineActual}px`);
  Escena.Redimensionar();
  Linea.SolicitarDibujo();
}

let ArrastrandoDivisor = false;
DivisorTimeline.addEventListener('pointerdown', (E) => {
  ArrastrandoDivisor = true;
  DivisorTimeline.setPointerCapture(E.pointerId);
});
DivisorTimeline.addEventListener('pointermove', (E) => {
  if (!ArrastrandoDivisor) return;
  AplicarAltoTimeline(window.innerHeight - E.clientY);
});
DivisorTimeline.addEventListener('pointerup', () => { ArrastrandoDivisor = false; });
DivisorTimeline.addEventListener('keydown', (E) => {
  if (E.key === 'ArrowUp') { E.preventDefault(); AplicarAltoTimeline(AltoTimelineActual + 18); }
  else if (E.key === 'ArrowDown') { E.preventDefault(); AplicarAltoTimeline(AltoTimelineActual - 18); }
});

// ----------------------------------------------------------------------------
// Fallback progresivo de roving-tabindex para toolbars sin focusgroup nativo
// ----------------------------------------------------------------------------

if (!('focusGroup' in HTMLElement.prototype)) {
  document.querySelectorAll<HTMLElement>('[role="toolbar"][focusgroup]').forEach((Barra) => {
    const Controles = [...Barra.querySelectorAll<HTMLElement>('button, select, input')];
    if (Controles.length === 0) return;
    Controles.forEach((B, I) => { B.tabIndex = I === 0 ? 0 : -1; });

    Barra.addEventListener('focusin', (E) => {
      const T = E.target as HTMLElement;
      if (Controles.includes(T)) {
        Controles.forEach((B) => { B.tabIndex = B === T ? 0 : -1; });
      }
    });

    Barra.addEventListener('keydown', (E) => {
      const Activo = document.activeElement as HTMLElement | null;
      if (!Activo || Activo.tagName === 'INPUT' || Activo.tagName === 'SELECT') return;
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(E.key)) return;

      const Indice = Controles.indexOf(Activo);
      if (Indice < 0) return;
      const Rtl = getComputedStyle(Barra).direction === 'rtl';
      let Sig = Indice;
      if (E.key === 'Home') Sig = 0;
      else if (E.key === 'End') Sig = Controles.length - 1;
      else if (E.key === 'ArrowRight') Sig = (Indice + (Rtl ? -1 : 1) + Controles.length) % Controles.length;
      else if (E.key === 'ArrowLeft') Sig = (Indice + (Rtl ? 1 : -1) + Controles.length) % Controles.length;

      E.preventDefault();
      Controles[Sig].focus({ preventScroll: true });
    });
  });
}

// ----------------------------------------------------------------------------
// Interacción 3D con huesos + Auto-Clave al soltar gizmo
// ----------------------------------------------------------------------------

const Raycaster = new THREE.Raycaster();
const PosicionRaton = new THREE.Vector2();

document.getElementById('Visor3D')!.addEventListener('mousedown', (E) => {
  if (Escena.ControlTransformacion.dragging) return;
  const Rect = (E.target as HTMLElement).getBoundingClientRect();
  PosicionRaton.x = ((E.clientX - Rect.left) / Rect.width) * 2 - 1;
  PosicionRaton.y = -((E.clientY - Rect.top) / Rect.height) * 2 + 1;

  Raycaster.setFromCamera(PosicionRaton, Escena.Camara);
  const Intersecciones = Raycaster.intersectObjects(Modelos.Colliders);
  if (Intersecciones.length > 0) {
    const NombreHueso = Intersecciones[0].object.userData.boneName as string;
    const NodoHueso = Modelos.ObtenerNodoHueso(NombreHueso);
    if (NodoHueso) {
      Escena.ControlTransformacion.attach(NodoHueso);
      Panel.SeleccionarHueso(NombreHueso);
      Estado.HuesoSeleccionado = NombreHueso;
      SincronizarBotonesGizmo();
    }
  }
});

Escena.ControlTransformacion.addEventListener('change', () => {
  if (Escena.ControlTransformacion.object) {
    Panel.SincronizarDeslizadoresHueso();
  }
});

Escena.ControlTransformacion.addEventListener('dragging-changed', (E) => {
  if (E.value) return; // Solo grabamos al finalizar el arrastre del gizmo
  if (!Estado.AutoClave || !Modelos.Vrm || !Escena.ControlTransformacion.object) return;
  const Obj = Escena.ControlTransformacion.object;
  const Nombre = Modelos.ObtenerHuesosDisponibles().find((N) => Modelos.ObtenerNodoHueso(N) === Obj);
  if (!Nombre) return;

  const EsTraslacion = Escena.ControlTransformacion.mode === 'translate' && Nombre === 'hips';
  const Tipo = EsTraslacion ? 'HuesoPosicion' : 'HuesoRotacion';
  const Valor = Animacion.ObtenerValorActualObjetivo(Tipo, Nombre);
  if (!Valor) return;

  const Cmd = new ComandoGuardarClave(
    Animacion, Tipo, Nombre, 'Manual',
    Animacion.TiempoActual, Valor, Estado.InterpolacionPorDefecto
  );
  Historial.Ejecutar(Cmd);
});

// ----------------------------------------------------------------------------
// Menú contextual de la línea de tiempo
// ----------------------------------------------------------------------------

Linea.AlAbrirMenuContextual = (E: MouseEvent, Obj: ObjetivoContextoTimeline) => {
  const Items: ElementoMenuContextual[] = [];

  if (Obj.Tipo === 'clave' && Obj.Pista && Obj.Clave) {
    const Seleccion = Estado.SeleccionClaves.length > 0
      ? [...Estado.SeleccionClaves]
      : [{ PistaId: Obj.Pista.Id, ClaveId: Obj.Clave.Id }];
    const Pista = Obj.Pista;
    const Clave = Obj.Clave;

    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Inspeccionar clave en panel',
      AlActivar: () => Panel.AbrirInspectorClave()
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Sobrescribir con estado 3D actual',
      Deshabilitado: Boolean(Pista.Bloqueada),
      AlActivar: () => {
        const Valor = Animacion.ObtenerValorActualObjetivo(Pista.Tipo, Pista.Objetivo);
        if (!Valor) return;
        const Cmd = new ComandoGuardarClave(
          Animacion, Pista.Tipo, Pista.Objetivo, Pista.Grupo,
          Clave.Tiempo, Valor, Clave.Interpolacion ?? Estado.InterpolacionPorDefecto, 0.008
        );
        Historial.Ejecutar(Cmd);
        Contexto.NotificarEstado(`Clave de "${Pista.Objetivo}" sobrescrita.`, 'exito', true);
      }
    });
    Items.push({ Tipo: 'separador' });

    for (const Est of LISTA_INTERPOLACIONES) {
      Items.push({
        Tipo: 'accion',
        Etiqueta: `Curva: ${Est.Etiqueta}`,
        Marcado: (Clave.Interpolacion ?? 'Suave') === Est.Tipo,
        Deshabilitado: Boolean(Pista.Bloqueada),
        AlActivar: () => {
          Historial.Ejecutar(new ComandoCambiarInterpolacionLote(Animacion, Seleccion, Est.Tipo));
        }
      });
    }

    Items.push({ Tipo: 'separador' });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Copiar seleccionada(s)',
      Atajo: 'Ctrl+C',
      AlActivar: () => Linea.CopiarSeleccion()
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Duplicar al cabezal',
      Atajo: 'Ctrl+D',
      AlActivar: () => Linea.DuplicarSeleccionAlCabezal()
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: Seleccion.length > 1 ? `Eliminar ${Seleccion.length} claves` : 'Eliminar clave',
      Atajo: 'Supr',
      Peligroso: true,
      Deshabilitado: Boolean(Pista.Bloqueada),
      AlActivar: () => Linea.EliminarSeleccion()
    });
  } else if (Obj.Tipo === 'pista' && Obj.Pista) {
    const Pista = Obj.Pista;
    const HayAqui = Animacion.BuscarClaveEnTiempo(Pista, Obj.Tiempo) !== undefined;
    Items.push({
      Tipo: 'accion',
      Etiqueta: HayAqui
        ? `Sobrescribir clave en ${FormatearTiempo(Obj.Tiempo)}`
        : `Insertar clave en ${FormatearTiempo(Obj.Tiempo)}`,
      Deshabilitado: Boolean(Pista.Bloqueada),
      AlActivar: () => {
        const Val = Animacion.ObtenerValorActualObjetivo(Pista.Tipo, Pista.Objetivo);
        if (!Val) return;
        const Cmd = new ComandoGuardarClave(
          Animacion, Pista.Tipo, Pista.Objetivo, Pista.Grupo,
          Estado.AjustarTiempoConIman(Obj.Tiempo), Val, Estado.InterpolacionPorDefecto
        );
        Historial.Ejecutar(Cmd);
        Estado.SeleccionarUna(Pista.Id, Cmd.ClaveResultanteId);
      }
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Desplazar claves en el tiempo…',
      Deshabilitado: Boolean(Pista.Bloqueada),
      AlActivar: async () => {
        const Delta = await SolicitarNumeroDialogo({
          Titulo: `Desplazar "${Pista.Nombre}"`,
          Etiqueta: 'Desplazamiento',
          ValorInicial: 0.5,
          Paso: 0.1,
          Unidad: 's'
        });
        if (Delta !== null && Math.abs(Delta) > 1e-4) {
          Historial.Ejecutar(new ComandoDesplazarPistas(Animacion, [Pista.Id], Delta));
        }
      }
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Simplificar claves (optimizar)',
      Deshabilitado: Boolean(Pista.Bloqueada) || Pista.Claves.length <= 2,
      AlActivar: () => {
        const Cmd = new ComandoSimplificarPistas(Animacion, [Pista.Id], 0.015);
        Historial.Ejecutar(Cmd);
        Contexto.NotificarEstado(`Pista optimizada: ${Cmd.ClavesAntesTotal} → ${Cmd.ClavesDespuesTotal} claves.`, 'exito', true);
      }
    });
    Items.push({ Tipo: 'separador' });
    Items.push({
      Tipo: 'accion',
      Etiqueta: Pista.Silenciada ? 'Activar pista (Unmute)' : 'Silenciar pista (Mute)',
      AlActivar: () => {
        Pista.Silenciada = !Pista.Silenciada;
        Animacion.NotificarCambioPistas('silencio-pista');
        Animacion.EvaluarEn(Animacion.TiempoActual);
      }
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: Pista.Bloqueada ? 'Desbloquear pista' : 'Bloquear pista',
      AlActivar: () => {
        Pista.Bloqueada = !Pista.Bloqueada;
        Animacion.NotificarCambioPistas('bloqueo-pista');
      }
    });
    Items.push({ Tipo: 'separador' });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Eliminar pista completa',
      Peligroso: true,
      AlActivar: async () => {
        if (await ConfirmarAccion({
          Titulo: 'Eliminar pista',
          Mensaje: `¿Seguro que deseas eliminar la pista "${Pista.Nombre}" y todas sus claves?`,
          TextoConfirmar: 'Eliminar pista',
          Peligroso: true
        })) {
          Historial.Ejecutar(new ComandoEliminarPista(Animacion, { tipo: 'pista', pistaId: Pista.Id, nombre: Pista.Nombre }, Estado));
        }
      }
    });
  } else if (Obj.Tipo === 'grupo' && Obj.Grupo) {
    const Grupo = Obj.Grupo as GrupoPista;
    const PistasG = Animacion.Pistas.filter((P) => P.Grupo === Grupo);
    const IdsG = PistasG.map((P) => P.Id);

    Items.push({
      Tipo: 'accion',
      Etiqueta: `Desplazar capa "${Animacion.NombreGrupo(Grupo)}"…`,
      AlActivar: async () => {
        const Delta = await SolicitarNumeroDialogo({
          Titulo: `Desplazar capa "${Animacion.NombreGrupo(Grupo)}"`,
          Etiqueta: 'Desplazamiento',
          ValorInicial: 0.5,
          Paso: 0.1,
          Unidad: 's'
        });
        if (Delta !== null && Math.abs(Delta) > 1e-4) {
          Historial.Ejecutar(new ComandoDesplazarPistas(Animacion, IdsG, Delta));
        }
      }
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Simplificar toda la capa (optimizar)',
      AlActivar: () => {
        const Cmd = new ComandoSimplificarPistas(Animacion, IdsG, 0.015);
        Historial.Ejecutar(Cmd);
        Contexto.NotificarEstado(`Capa optimizada: ${Cmd.ClavesAntesTotal} → ${Cmd.ClavesDespuesTotal} claves.`, 'exito', true);
      }
    });
    Items.push({ Tipo: 'separador' });
    Items.push({
      Tipo: 'accion',
      Etiqueta: `Eliminar toda la capa "${Animacion.NombreGrupo(Grupo)}"`,
      Peligroso: true,
      AlActivar: async () => {
        if (await ConfirmarAccion({
          Titulo: 'Eliminar capa',
          Mensaje: `¿Eliminar las ${PistasG.length} pistas de la capa "${Animacion.NombreGrupo(Grupo)}"? Esta acción se puede deshacer con Ctrl+Z.`,
          TextoConfirmar: 'Eliminar capa',
          Peligroso: true
        })) {
          Historial.Ejecutar(new ComandoEliminarPista(Animacion, { tipo: 'grupo', grupo: Grupo }, Estado));
        }
      }
    });
  } else {
    const ClavesEnTiempo = Animacion.ObtenerClavesEnTiempo(Obj.Tiempo);
    Items.push({
      Tipo: 'accion',
      Etiqueta: ClavesEnTiempo.length > 0 ? 'Sobrescribir pose completa aquí' : 'Insertar pose completa aquí',
      Atajo: 'K',
      Deshabilitado: !Modelos.Vrm,
      AlActivar: () => {
        Animacion.EstablecerTiempo(Estado.AjustarTiempoConIman(Obj.Tiempo), 'usuario');
        EjecutarPoseCompleta();
      }
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Pegar claves aquí',
      Atajo: 'Ctrl+V',
      Deshabilitado: !Estado.Portapapeles,
      AlActivar: () => Linea.PegarEnCabezal(Estado.AjustarTiempoConIman(Obj.Tiempo))
    });
    Items.push({
      Tipo: 'accion',
      Etiqueta: 'Importar animación aquí…',
      AlActivar: async () => {
        Animacion.EstablecerTiempo(Estado.AjustarTiempoConIman(Obj.Tiempo), 'usuario');
        const Archivo = await SeleccionarArchivo('.vrma,.bvh,.glb,.gltf,.json');
        if (Archivo) void ModalImp.AbrirConArchivo(Archivo);
      }
    });
    if (ClavesEnTiempo.length > 0) {
      Items.push({ Tipo: 'separador' });
      Items.push({
        Tipo: 'accion',
        Etiqueta: `Eliminar ${ClavesEnTiempo.length} clave(s) en ${FormatearTiempo(Obj.Tiempo)}`,
        Peligroso: true,
        AlActivar: () => {
          const Sel: SeleccionClave[] = ClavesEnTiempo.map((Par) => ({ PistaId: Par.Pista.Id, ClaveId: Par.Clave.Id }));
          Historial.Ejecutar(new ComandoEliminarClaves(Animacion, Sel, Estado));
        }
      });
    }
  }

  MenuCtx.Abrir(E.clientX, E.clientY, Items);
};

// ----------------------------------------------------------------------------
// Proyecto: nuevo, abrir y guardar
// ----------------------------------------------------------------------------

document.getElementById('BotonNuevoProyecto')!.onclick = async () => {
  if (Animacion.Pistas.length > 0) {
    const Ok = await ConfirmarAccion({
      Titulo: 'Nuevo proyecto',
      Mensaje: 'Se limpiarán todas las pistas de animación y el audio actual.',
      TextoConfirmar: 'Crear nuevo',
      Peligroso: true
    });
    if (!Ok) return;
  }
  Animacion.Limpiar();
  Audio.Quitar();
  Historial.Limpiar();
  Estado.LimpiarSeleccion();
  Modelos.RestablecerPose();
  MostrarRecuperarInicio = false;
  Autoguardado.LimpiarRespaldo();
  EntradaDuracion.value = String(Animacion.Duracion);
  Bus.Emitir('proyecto:cargado', {});
  Contexto.NotificarEstado('Proyecto nuevo listo.', 'info');
};

document.getElementById('BotonGuardarProyecto')!.onclick = () => {
  const Fondo = Escena.Escena.background as { getHexString?: () => string } | null;
  const Datos: DatosProyecto = {
    Version: 2,
    Duracion: Animacion.Duracion,
    Pistas: Animacion.Pistas,
    ColorFondo: Fondo?.getHexString ? `#${Fondo.getHexString()}` : '#1b1e26',
    DesplazamientoAudio: Audio.Desplazamiento,
    VolumenAudio: Audio.Volumen,
    NombreAudio: Audio.Buffer ? Audio.NombreArchivo : null,
    BloomActivo: Escena.BloomActivo,
    BloomFuerza: Escena.BloomFuerza,
    TipoParticulas: Efectos.Tipo,
    CantidadParticulas: Efectos.Cantidad
  };
  DescargarTexto(JSON.stringify(Datos, null, 2), 'Proyecto.animvrm.json');
  Contexto.NotificarEstado('Proyecto guardado. El modelo y audio se recargan aparte.', 'exito');
};

async function AbrirProyecto(Archivo: File): Promise<void> {
  const Datos = JSON.parse(await LeerArchivoTexto(Archivo)) as DatosProyecto;
  if (!Array.isArray(Datos.Pistas)) throw new Error('Archivo de proyecto no válido.');
  Animacion.Pistas = Datos.Pistas;
  Animacion.Duracion = Datos.Duracion ?? 10;
  Animacion.TiempoActual = 0;
  EntradaDuracion.value = String(Animacion.Duracion);
  if (Datos.ColorFondo) Escena.EstablecerFondoColor(Datos.ColorFondo);
  Audio.Desplazamiento = Datos.DesplazamientoAudio ?? 0;
  Audio.EstablecerVolumen(Datos.VolumenAudio ?? 0.9);
  Escena.EstablecerBloom(Datos.BloomActivo ?? false, Datos.BloomFuerza ?? 0.55);
  if (Datos.TipoParticulas && Datos.TipoParticulas !== 'Ninguno') {
    Efectos.EstablecerParticulas(Datos.TipoParticulas as TipoParticulas, Datos.CantidadParticulas);
  }
  Historial.Limpiar();
  Estado.LimpiarSeleccion();
  Animacion.NotificarCambioPistas('proyecto-abierto');
  Animacion.EvaluarEn(0);
  Bus.Emitir('proyecto:cargado', {});
  Contexto.NotificarEstado(
    `Proyecto cargado (${Datos.Pistas.length} pistas).` +
    (Datos.NombreAudio ? ` Recarga el audio "${Datos.NombreAudio}".` : ''),
    'exito'
  );
}

document.getElementById('BotonAbrirProyecto')!.onclick = async () => {
  const Archivo = await SeleccionarArchivo('.json');
  if (!Archivo) return;
  try {
    await AbrirProyecto(Archivo);
  } catch (E) {
    Contexto.NotificarEstado(`Error al abrir: ${(E as Error).message}`, 'error');
  }
};

// ----------------------------------------------------------------------------
// Arrastrar y soltar archivos sobre el visor o el timeline
// ----------------------------------------------------------------------------

const ContenedorVisor = document.getElementById('ContenedorVisor')!;
const ZonaSoltar = document.getElementById('ZonaSoltar')!;

ContenedorVisor.addEventListener('dragover', (E) => {
  E.preventDefault();
  ZonaSoltar.classList.remove('Oculto');
});
ContenedorVisor.addEventListener('dragleave', () => ZonaSoltar.classList.add('Oculto'));

async function SubirArchivoLocal(Archivo: File, Categoria: string): Promise<void> {
  const formData = new FormData();
  formData.append('file', Archivo);
  formData.append('category', Categoria);
  try {
    const Res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (Res.ok) Panel.RefrescarBibliotecaLocal();
  } catch {}
}

Linea.AlSoltarArchivo = (Archivo, Tiempo) => {
  Animacion.EstablecerTiempo(Estado.AjustarTiempoConIman(Tiempo), 'usuario');
  if (Importador.EsFormatoSoportado(Archivo)) {
    void ModalImp.AbrirConArchivo(Archivo);
  } else {
    Contexto.NotificarEstado('Arrastra archivos .vrma, .bvh, .glb/.gltf o .json al timeline.', 'aviso');
  }
};

ContenedorVisor.addEventListener('drop', async (E) => {
  E.preventDefault();
  ZonaSoltar.classList.add('Oculto');
  const Archivo = E.dataTransfer?.files?.[0];
  if (!Archivo) return;
  const Nombre = Archivo.name.toLowerCase();
  try {
    if (Nombre.endsWith('.vrm')) {
      Escena.ControlTransformacion.detach();
      await Modelos.CargarVrm(Archivo);
      Panel.RefrescarDinamico();
      Bus.Emitir('modelo:cargado', { nombre: Archivo.name });
      void SubirArchivoLocal(Archivo, 'models');
      Contexto.NotificarEstado(`Modelo cargado y guardado: ${Archivo.name}`, 'exito');
    } else if (Nombre.endsWith('.vrma') || Nombre.endsWith('.bvh')) {
      if (Nombre.endsWith('.vrma')) void SubirArchivoLocal(Archivo, 'animations');
      void ModalImp.AbrirConArchivo(Archivo);
    } else if (Nombre.endsWith('.glb') || Nombre.endsWith('.gltf')) {
      Escena.EstablecerModeloFondo(await Modelos.CargarModeloFondo(Archivo));
      Contexto.NotificarEstado(`Modelo de fondo cargado: ${Archivo.name}`, 'exito');
    } else if (Nombre.endsWith('.json')) {
      const Texto = await LeerArchivoTexto(Archivo);
      const Datos = JSON.parse(Texto);
      if (Datos.ColorFondo !== undefined || Nombre.includes('.animvrm.')) {
        await AbrirProyecto(Archivo);
      } else if (Array.isArray(Datos.Pistas)) {
        void SubirArchivoLocal(Archivo, 'poses');
        void ModalImp.AbrirConArchivo(Archivo);
      } else {
        throw new Error('JSON no reconocido como proyecto ni animación.');
      }
    } else if (/\.(mp3|wav|ogg|m4a|flac)$/.test(Nombre)) {
      await Audio.Cargar(Archivo);
      Bus.Emitir('audio:cambiado', {});
      Contexto.NotificarEstado(`Audio cargado: ${Archivo.name}`, 'exito');
    } else if (/\.(png|jpg|jpeg|webp)$/.test(Nombre)) {
      Escena.EstablecerFondoImagen(URL.createObjectURL(Archivo));
      Contexto.NotificarEstado('Imagen de fondo aplicada.', 'exito');
    } else if (/\.(mp4|webm|mov|mkv)$/.test(Nombre)) {
      Contexto.NotificarEstado('Para analizar un video con IA, ve a la pestaña «Captura» → «Cargar Video…».', 'info');
    } else {
      Contexto.NotificarEstado('Tipo de archivo no reconocido.', 'aviso');
    }
  } catch (ErrorCarga) {
    Contexto.NotificarEstado(`Error: ${(ErrorCarga as Error).message}`, 'error');
  }
});

// ----------------------------------------------------------------------------
// Atajos de teclado del estudio
// ----------------------------------------------------------------------------

function EsCampoEscrituraActivo(Objetivo: EventTarget | null): boolean {
  if (!(Objetivo instanceof HTMLElement)) return false;
  if (Objetivo.isContentEditable) return true;
  if (Objetivo instanceof HTMLTextAreaElement || Objetivo instanceof HTMLSelectElement) return true;
  if (Objetivo instanceof HTMLInputElement) {
    return (
      Objetivo.type !== 'range' &&
      Objetivo.type !== 'checkbox' &&
      Objetivo.type !== 'radio' &&
      Objetivo.type !== 'color' &&
      Objetivo.type !== 'button'
    );
  }
  return false;
}

window.addEventListener('keydown', (E) => {
  if (document.querySelector('dialog[open]')) return;
  const Objetivo = E.target as HTMLElement | null;
  if (EsCampoEscrituraActivo(Objetivo)) return;

  const Ctrl = E.ctrlKey || E.metaKey;
  const Tecla = E.key.toLowerCase();

  if (Ctrl && Tecla === 's') {
    E.preventDefault();
    document.getElementById('BotonGuardarProyecto')!.click();
  } else if (Ctrl && Tecla === 'o') {
    E.preventDefault();
    document.getElementById('BotonAbrirProyecto')!.click();
  } else if ((E.key === '?' || (Tecla === '/' && E.shiftKey)) && !Ctrl) {
    E.preventDefault();
    ModalGuiaAtajos.Abrir();
  } else if (Ctrl && Tecla === 'z' && !E.shiftKey) {
    E.preventDefault();
    Historial.Deshacer();
    Panel.SincronizarDeslizadoresHueso();
  } else if ((Ctrl && Tecla === 'y') || (Ctrl && E.shiftKey && Tecla === 'z')) {
    E.preventDefault();
    Historial.Rehacer();
    Panel.SincronizarDeslizadoresHueso();
  } else if (Ctrl && Tecla === 'c') {
    E.preventDefault();
    Linea.CopiarSeleccion();
  } else if (Ctrl && Tecla === 'v') {
    E.preventDefault();
    Linea.PegarEnCabezal();
  } else if (Ctrl && Tecla === 'd') {
    E.preventDefault();
    Linea.DuplicarSeleccionAlCabezal();
  } else if (Ctrl && Tecla === 'a') {
    E.preventDefault();
    Linea.SeleccionarTodas();
  } else if (E.code === 'Space') {
    if (Objetivo instanceof HTMLButtonElement) return;
    E.preventDefault();
    AlternarReproduccion();
  } else if (E.key === 'Delete' || E.key === 'Backspace') {
    Linea.EliminarSeleccion();
  } else if (Tecla === 'k' && E.shiftKey) {
    if (!Modelos.Vrm || !Estado.HuesoSeleccionado) return;
    const Val = Animacion.ObtenerValorActualObjetivo('HuesoRotacion', Estado.HuesoSeleccionado);
    if (Val) {
      const Cmd = new ComandoGuardarClave(
        Animacion, 'HuesoRotacion', Estado.HuesoSeleccionado, 'Manual',
        Animacion.TiempoActual, Val, Estado.InterpolacionPorDefecto
      );
      Historial.Ejecutar(Cmd);
      Contexto.NotificarEstado(`Clave guardada para ${Estado.HuesoSeleccionado}.`, 'exito', true);
    }
  } else if (Tecla === 'k' && !Ctrl) {
    EjecutarPoseCompleta();
  } else if (E.key === 'Home') {
    Animacion.EstablecerTiempo(0, 'usuario');
    Animacion.EvaluarEn(0);
  } else if (E.key === 'End') {
    Animacion.EstablecerTiempo(Animacion.Duracion, 'usuario');
    Animacion.EvaluarEn(Animacion.Duracion);
  } else if (E.key === 'ArrowLeft' || E.key === 'ArrowRight') {
    if (Objetivo instanceof HTMLInputElement && Objetivo.type === 'range') return;
    const Paso = E.shiftKey ? 1 : 1 / 30;
    Animacion.EstablecerTiempo(Animacion.TiempoActual + (E.key === 'ArrowRight' ? Paso : -Paso), 'usuario');
    Animacion.EvaluarEn(Animacion.TiempoActual);
    Panel.SincronizarDeslizadoresHueso();
  } else if (E.key === '[' || E.key === ',') {
    IrAClave('anterior');
  } else if (E.key === ']' || E.key === '.') {
    IrAClave('siguiente');
  } else if (Tecla === 'f' && !Ctrl) {
    Linea.AjustarVista();
  } else if (Tecla === 'q') {
    Escena.ControlTransformacion.detach();
    SincronizarBotonesGizmo();
  } else if (Tecla === 'w') {
    Escena.ControlTransformacion.setMode('translate');
    SincronizarBotonesGizmo();
  } else if (Tecla === 'e') {
    Escena.ControlTransformacion.setMode('rotate');
    SincronizarBotonesGizmo();
  } else if (Tecla === 'r') {
    Escena.ControlTransformacion.setSpace(Escena.ControlTransformacion.space === 'local' ? 'world' : 'local');
    SincronizarBotonesGizmo();
  } else if (!Ctrl && !E.altKey && !E.shiftKey && Tecla === '1') {
    Escena.EnfocarVistaPreajuste('frontal');
  } else if (!Ctrl && !E.altKey && !E.shiftKey && Tecla === '2') {
    Escena.EnfocarVistaPreajuste('tresCuartos');
  } else if (!Ctrl && !E.altKey && !E.shiftKey && Tecla === '3') {
    Escena.EnfocarVistaPreajuste('perfil');
  } else if (!Ctrl && !E.altKey && !E.shiftKey && Tecla === '4') {
    Escena.EnfocarVistaPreajuste('rostro');
  }
});

// ----------------------------------------------------------------------------
// Bucle principal: optimizado para no redibujar el timeline si está en reposo
// ----------------------------------------------------------------------------

let RelojAnterior = performance.now();
let Cuadros = 0;
let AcumuladoFps = 0;

function Bucle(Ahora: number): void {
  requestAnimationFrame(Bucle);
  const Delta = Math.min(0.1, (Ahora - RelojAnterior) / 1000);
  RelojAnterior = Ahora;

  if (Animacion.Reproduciendo) {
    const TiempoPrevio = Animacion.TiempoActual;
    Animacion.Avanzar(Delta, Estado.VelocidadReproduccion, Estado.RangoBucle);
    if (Animacion.EnBucle && Animacion.TiempoActual < TiempoPrevio) {
      Audio.ReproducirDesde(Animacion.TiempoActual);
    }
    Animacion.EvaluarEn(Animacion.TiempoActual);
    ActualizarIndicadoresTiempo();
    Linea.SolicitarDibujo();
  }

  Efectos.Actualizar(Delta);
  Modelos.Actualizar(Delta);
  Escena.Renderizar();

  Cuadros++;
  AcumuladoFps += Delta;
  if (AcumuladoFps >= 0.5) {
    IndicadorFps.textContent = `${Math.round(Cuadros / AcumuladoFps)} FPS`;
    Cuadros = 0;
    AcumuladoFps = 0;
  }
}

void Notificaciones;
ActualizarIndicadoresTiempo();
SincronizarBotonesGizmo();
Linea.SolicitarDibujo();
requestAnimationFrame(Bucle);
Contexto.NotificarEstado('Listo. Carga un modelo .vrm para empezar o usa "Cargar ejemplo".', 'info');

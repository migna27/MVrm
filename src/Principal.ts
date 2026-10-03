// ============================================================================
// Principal.ts — Punto de entrada del Animador VRM
// Crea los gestores, conecta la interfaz, arrastrar/soltar de archivos,
// atajos de teclado y el bucle principal de render en tiempo real.
// ============================================================================

import './Interfaz/Estilos.css';
import { GestorEscena } from './Nucleo/GestorEscena';
import { GestorModelos } from './Nucleo/GestorModelos';
import { GestorAnimacion } from './Nucleo/GestorAnimacion';
import { GestorAudio } from './Nucleo/GestorAudio';
import { GestorEfectos } from './Nucleo/GestorEfectos';
import { GestorTracking } from './Nucleo/GestorTracking';
import { GestorExportacion } from './Nucleo/GestorExportacion';
import { ContextoAplicacion } from './Contexto';
import { DatosProyecto } from './Tipos';
import { TipoParticulas } from './Nucleo/GestorEfectos';
import { LineaTiempo } from './Interfaz/LineaTiempo';
import { PanelLateral } from './Interfaz/PanelLateral';
import { ModalExportacion } from './Interfaz/ModalExportacion';
import {
  FormatearTiempo, SeleccionarArchivo, LeerArchivoTexto,
  DescargarTexto, Limitar
} from './Utilidades';

// ----------------------------------------------------------------------------
// Construcción del contexto de la aplicación
// ----------------------------------------------------------------------------

const Escena = new GestorEscena();
Escena.Inicializar(document.getElementById('Visor3D')!);

const Modelos = new GestorModelos(Escena.Escena);
const Animacion = new GestorAnimacion(Modelos);
const Audio = new GestorAudio();
const Efectos = new GestorEfectos(Escena.Escena);
const Tracking = new GestorTracking();
import { GestorVMC } from './Nucleo/GestorVMC';

// ...
const Exportador = new GestorExportacion();

const IndicadorEstado = document.getElementById('IndicadorEstado')!;
const IndicadorFps = document.getElementById('IndicadorFps')!;
const IndicadorTiempo = document.getElementById('IndicadorTiempo')!;

const Contexto: any = { // Temporalmente any para inyectar VMC y sortear tipos cíclicos si los hay
  Escena, Modelos, Animacion, Audio, Efectos, Tracking, Exportador,
  VMC: null,
  NotificarEstado: (M: string) => { IndicadorEstado.textContent = M; },
  RefrescarLineaTiempo: () => Linea.Dibujar(),
  RefrescarPanel: () => Panel.RefrescarDinamico()
};

Contexto.VMC = new GestorVMC(Contexto);

const Panel = new PanelLateral(
  document.getElementById('PanelIzquierdo')!,
  document.getElementById('PanelDerecho')!,
  Contexto
);
const Linea = new LineaTiempo(document.getElementById('LienzoLineaTiempo') as HTMLCanvasElement, Contexto);
const Modal = new ModalExportacion(Contexto);

Animacion.AlCambiarPistas = () => Linea.Dibujar();

// ----------------------------------------------------------------------------
// Transporte y controles de la línea de tiempo
// ----------------------------------------------------------------------------

const BotonReproducir = document.getElementById('BotonReproducir') as HTMLButtonElement;
const CasillaBucle = document.getElementById('CasillaBucle') as HTMLInputElement;
const EntradaDuracion = document.getElementById('EntradaDuracion') as HTMLInputElement;
const DeslizadorZoom = document.getElementById('DeslizadorZoom') as HTMLInputElement;

function AlternarReproduccion(): void {
  if (Animacion.Reproduciendo) {
    Animacion.Pausar();
    Audio.Detener();
  } else {
    Animacion.Reproducir();
    Audio.ReproducirDesde(Animacion.TiempoActual);
  }
  BotonReproducir.textContent = Animacion.Reproduciendo ? '⏸' : '▶';
}

document.getElementById('BotonReproducir')!.onclick = AlternarReproduccion;

document.getElementById('BotonInicio')!.onclick = () => {
  Animacion.EstablecerTiempo(0);
  if (Animacion.Reproduciendo) Audio.ReproducirDesde(0);
  Animacion.EvaluarEn(0);
};

document.getElementById('BotonDetener')!.onclick = () => {
  Animacion.Detener();
  Audio.Detener();
  BotonReproducir.textContent = '▶';
  Animacion.EvaluarEn(0);
};

CasillaBucle.onchange = () => { Animacion.EnBucle = CasillaBucle.checked; };

EntradaDuracion.onchange = () => {
  Animacion.Duracion = Limitar(parseFloat(EntradaDuracion.value) || 10, 1, 600);
  EntradaDuracion.value = String(Animacion.Duracion);
  Linea.Dibujar();
};

DeslizadorZoom.oninput = () => {
  Linea.PxPorSegundo = parseFloat(DeslizadorZoom.value);
  Linea.Dibujar();
};

document.getElementById('BotonInsertarPose')!.onclick = () => {
  if (!Modelos.Vrm) { Contexto.NotificarEstado('Carga primero un modelo VRM.'); return; }
  Animacion.InsertarPoseCompleta(Animacion.TiempoActual);
  Contexto.NotificarEstado(`Pose completa insertada en ${FormatearTiempo(Animacion.TiempoActual)}.`);
};

document.getElementById('BotonEliminarClave')!.onclick = () => Linea.EliminarSeleccion();

// Calidad de la previa en tiempo real (optimización de recursos)
(document.getElementById('SelectorCalidadPrevia') as HTMLSelectElement).onchange = (E) => {
  Escena.EstablecerEscalaPrevia(parseFloat((E.target as HTMLSelectElement).value));
};

// ----------------------------------------------------------------------------
// Interacción 3D: Selección y rotación de huesos en el visor
// ----------------------------------------------------------------------------

import * as THREE from 'three';

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
    const HuesoColisionado = Intersecciones[0].object;
    const NombreHueso = HuesoColisionado.userData.boneName;
    const NodoHueso = Modelos.ObtenerNodoHueso(NombreHueso);
    if (NodoHueso) {
      Escena.ControlTransformacion.attach(NodoHueso);
      Panel.SeleccionarHueso(NombreHueso);
    }
  } else if (!Escena.ControlTransformacion.dragging) {
    // Escena.ControlTransformacion.detach(); // Opcional: Deseleccionar al hacer clic en el vacío
  }
});

Escena.ControlTransformacion.addEventListener('change', () => {
  if (Escena.ControlTransformacion.object) {
    Panel.SincronizarDeslizadoresHueso();
  }
});

// ----------------------------------------------------------------------------
// Proyecto: nuevo, abrir y guardar
// ----------------------------------------------------------------------------

document.getElementById('BotonNuevoProyecto')!.onclick = () => {
  if (!confirm('¿Crear un proyecto nuevo? Se perderán las pistas no guardadas.')) return;
  Animacion.Limpiar();
  Audio.Quitar();
  Modelos.RestablecerPose();
  Contexto.NotificarEstado('Proyecto nuevo creado.');
  Linea.Dibujar();
};

document.getElementById('BotonGuardarProyecto')!.onclick = () => {
  const Fondo = Escena.Escena.background as { getHexString?: () => string } | null;
  const Datos: DatosProyecto = {
    Version: 1,
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
  Contexto.NotificarEstado('Proyecto guardado. El audio y el modelo se recargan aparte.');
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
  Animacion.AlCambiarPistas();
  Contexto.NotificarEstado(
    `Proyecto cargado (${Datos.Pistas.length} pistas).` +
    (Datos.NombreAudio ? ` Vuelve a cargar el audio «${Datos.NombreAudio}».` : '')
  );
}

document.getElementById('BotonAbrirProyecto')!.onclick = async () => {
  const Archivo = await SeleccionarArchivo('.json');
  if (!Archivo) return;
  try {
    await AbrirProyecto(Archivo);
  } catch (E) {
    Contexto.NotificarEstado(`Error al abrir: ${(E as Error).message}`);
  }
};

// ----------------------------------------------------------------------------
// Arrastrar y soltar archivos sobre el visor
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
  try { await fetch('/api/upload', { method: 'POST', body: formData }); } catch(e) {}
}

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
      SubirArchivoLocal(Archivo, 'models');
      Contexto.NotificarEstado(`Modelo cargado y guardado en biblioteca local: ${Archivo.name}`);
    } else if (Nombre.endsWith('.vrma')) {
      const Clip = await Modelos.CargarAnimacionVrma(Archivo);
      Animacion.AgregarPistas(Animacion.HornearClip(Clip, 24, 'Importado'));
      SubirArchivoLocal(Archivo, 'animations');
      Contexto.NotificarEstado('Animación importada y guardada en biblioteca.');
    } else if (Nombre.endsWith('.glb') || Nombre.endsWith('.gltf')) {
      Escena.EstablecerModeloFondo(await Modelos.CargarModeloFondo(Archivo));
      Contexto.NotificarEstado(`Modelo de fondo cargado: ${Archivo.name}`);
    } else if (Nombre.endsWith('.json')) {
      if (Nombre.includes('pose') || Nombre.includes('anim')) {
        SubirArchivoLocal(Archivo, 'poses'); // Asumimos que si es soltado, se guarda como pose
      }
      await AbrirProyecto(Archivo);
    } else if (/\.(mp3|wav|ogg|m4a|flac)$/.test(Nombre)) {
      await Audio.Cargar(Archivo);
      Panel.RefrescarDinamico();
      Contexto.NotificarEstado(`Audio cargado: ${Archivo.name}`);
    } else if (/\.(png|jpg|jpeg|webp)$/.test(Nombre)) {
      Escena.EstablecerFondoImagen(URL.createObjectURL(Archivo));
      Contexto.NotificarEstado('Imagen de fondo aplicada.');
    } else if (/\.(mp4|webm|mov|mkv)$/.test(Nombre)) {
      Contexto.NotificarEstado('Para usar un video, ve a «Seguimiento por video» → «Cargar video…».');
    } else {
      Contexto.NotificarEstado('Tipo de archivo no reconocido.');
    }
  } catch (ErrorCarga) {
    Contexto.NotificarEstado(`Error: ${(ErrorCarga as Error).message}`);
  }
});

// ----------------------------------------------------------------------------
// Atajos de teclado
// ----------------------------------------------------------------------------

window.addEventListener('keydown', (E) => {
  const Objetivo = E.target as HTMLElement;
  if (Objetivo.tagName === 'INPUT' || Objetivo.tagName === 'SELECT' || Objetivo.tagName === 'TEXTAREA') return;
  if (E.code === 'Space') {
    E.preventDefault();
    AlternarReproduccion();
  } else if (E.key === 'Delete' || E.key === 'Backspace') {
    Linea.EliminarSeleccion();
  } else if (E.key === 'Home') {
    Animacion.EstablecerTiempo(0);
    Animacion.EvaluarEn(0);
  } else if (E.key === 'End') {
    Animacion.EstablecerTiempo(Animacion.Duracion);
    Animacion.EvaluarEn(Animacion.Duracion);
  } else if (E.key === 'ArrowLeft' || E.key === 'ArrowRight') {
    const Paso = E.shiftKey ? 1 : 1 / 30;
    Animacion.EstablecerTiempo(Animacion.TiempoActual + (E.key === 'ArrowRight' ? Paso : -Paso));
    Animacion.EvaluarEn(Animacion.TiempoActual);
  } else if (E.key.toLowerCase() === 'q') {
    Escena.ControlTransformacion.detach();
  } else if (E.key.toLowerCase() === 'w') {
    Escena.ControlTransformacion.setMode('translate');
  } else if (E.key.toLowerCase() === 'e') {
    Escena.ControlTransformacion.setMode('rotate');
  } else if (E.key.toLowerCase() === 'r') {
    Escena.ControlTransformacion.setSpace(Escena.ControlTransformacion.space === 'local' ? 'world' : 'local');
    Contexto.NotificarEstado(`Espacio de transformación: ${Escena.ControlTransformacion.space}`);
  }
});

// ----------------------------------------------------------------------------
// Bucle principal: previa en tiempo real con recursos optimizados
// ----------------------------------------------------------------------------

let RelojAnterior = performance.now();
let Cuadros = 0;
let AcumuladoFps = 0;

function Bucle(Ahora: number): void {
  requestAnimationFrame(Bucle);
  const Delta = Math.min(0.1, (Ahora - RelojAnterior) / 1000);
  RelojAnterior = Ahora;

  // Avance de la animación y sincronización del audio en los bucles
  if (Animacion.Reproduciendo) {
    const TiempoPrevio = Animacion.TiempoActual;
    Animacion.Avanzar(Delta);
    if (Animacion.EnBucle && Animacion.TiempoActual < TiempoPrevio) {
      Audio.ReproducirDesde(Animacion.TiempoActual);
    }
    Animacion.EvaluarEn(Animacion.TiempoActual);
  }

  Efectos.Actualizar(Delta);
  Modelos.Actualizar(Delta);
  Escena.Renderizar();

  // Indicadores del transporte
  IndicadorTiempo.textContent = `${FormatearTiempo(Animacion.TiempoActual)} / ${FormatearTiempo(Animacion.Duracion)}`;
  Linea.Dibujar();

  // Contador de FPS de la previa
  Cuadros++;
  AcumuladoFps += Delta;
  if (AcumuladoFps >= 0.5) {
    IndicadorFps.textContent = `${Math.round(Cuadros / AcumuladoFps)} FPS`;
    Cuadros = 0;
    AcumuladoFps = 0;
  }
}

requestAnimationFrame(Bucle);
Contexto.NotificarEstado('Listo. Carga un modelo .vrm para empezar (o usa «Ejemplo»).');

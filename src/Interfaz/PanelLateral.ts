// ============================================================================
// PanelLateral.ts — Paneles de control de la aplicación
// Construye las secciones: modelo, expresiones, biblioteca de animaciones,
// seguimiento por video, escena/fondo, efectos, audio y exportación.
// ============================================================================

import * as THREE from 'three';
import { ContextoAplicacion } from '../Contexto';
import { CATALOGO_PREAJUSTES } from '../Nucleo/Preajustes';
import { NOMBRES_HUESOS_LEGIBLES } from '../Nucleo/GestorModelos';
import { TipoParticulas } from '../Nucleo/GestorEfectos';
import { RESOLUCIONES_EXPORTACION, OpcionesSeguimiento, OpcionesExportacion } from '../Tipos';
import { SeleccionarArchivo, AGrados, ARadianes, LeerArchivoTexto, DescargarTexto } from '../Utilidades';

export class PanelLateral {
  // Controles dinámicos que se actualizan al cargar un modelo
  private SelectorHuesos!: HTMLSelectElement;
  private DeslizadoresHueso: HTMLInputElement[] = [];
  private SalidasHueso: HTMLOutputElement[] = [];
  private ContenedorExpresiones!: HTMLElement;
  private EtiquetaModelo!: HTMLElement;
  private EtiquetaVideo!: HTMLElement;
  private EtiquetaAudio!: HTMLElement;
  private BarraSeguimiento!: HTMLElement;
  private TextoSeguimiento!: HTMLElement;
  private BarraExportacion!: HTMLElement;
  private TextoExportacion!: HTMLElement;
  private ArchivoVideo: File | null = null;

  constructor(private RaizIzq: HTMLElement, private RaizDer: HTMLElement, private Contexto: ContextoAplicacion) {
    this.Construir();
  }

  // --------------------------------------------------------------------------
  // Auxiliares de construcción de interfaz
  // --------------------------------------------------------------------------

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
    B.textContent = Etiqueta;
    if (Clase) B.className = Clase;
    B.onclick = AlClick;
    return B;
  }

  private Deslizador(
    Padre: HTMLElement, Etiqueta: string, Min: number, Max: number, Paso: number, Valor: number,
    AlCambiar: (V: number) => void, Formato: (V: number) => string = (V) => V.toFixed(2)
  ): { Entrada: HTMLInputElement; Salida: HTMLOutputElement } {
    const Grupo = document.createElement('div');
    Grupo.className = 'GrupoDeslizador';
    const L = document.createElement('label');
    L.textContent = Etiqueta;
    const Entrada = document.createElement('input');
    Entrada.type = 'range';
    Entrada.min = String(Min); Entrada.max = String(Max);
    Entrada.step = String(Paso); Entrada.value = String(Valor);
    const Salida = document.createElement('output');
    Salida.textContent = Formato(Valor);
    Entrada.oninput = () => {
      const V = parseFloat(Entrada.value);
      Salida.textContent = Formato(V);
      AlCambiar(V);
    };
    Grupo.append(L, Entrada, Salida);
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

  private CrearBarraProgreso(Padre: HTMLElement): { Barra: HTMLElement; Texto: HTMLElement } {
    const Externa = document.createElement('div');
    Externa.className = 'BarraProgreso';
    const Interna = document.createElement('div');
    Externa.appendChild(Interna);
    const Texto = document.createElement('p');
    Texto.className = 'TextoTenue';
    Texto.textContent = '';
    Padre.append(Externa, Texto);
    return { Barra: Interna, Texto };
  }

  // --------------------------------------------------------------------------
  // Construcción de todas las secciones
  // --------------------------------------------------------------------------

  private Construir(): void {
    // Panel Derecho (Inspector / Propiedades)
    this.ConstruirSeccionModelo();
    this.ConstruirSeccionExpresiones();
    this.ConstruirSeccionExportacion();

    // Panel Izquierdo (Media / Assets / Efectos)
    this.ConstruirSeccionBiblioteca();
    this.ConstruirSeccionEscena();
    this.ConstruirSeccionEfectos();
    this.ConstruirSeccionAudio();
    // this.ConstruirSeccionSeguimiento(); // Deshabilitado temporalmente por petición del usuario
  }

  // -------- Modelo VRM (Etapa 1) --------
  private ConstruirSeccionModelo(): void {
    const Cuerpo = this.Seccion(this.RaizDer, 'Modelo VRM', true);
    const Ctx = this.Contexto;

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    Fila.append(
      this.Boton('Cargar VRM…', async () => {
        const Archivo = await SeleccionarArchivo('.vrm');
        if (Archivo) await this.CargarModelo(Archivo);
      }, 'BotonPrimario'),
      this.Boton('Ejemplo', async () => {
        Ctx.NotificarEstado('Descargando modelo de ejemplo…');
        try {
          await Ctx.Modelos.CargarVrmDesdeUrl(
            'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/three-vrm-girl.vrm'
          );
          this.TrasCargarModelo();
        } catch (E) { Ctx.NotificarEstado(`Error: ${(E as Error).message}`); }
      })
    );
    Cuerpo.appendChild(Fila);
    this.EtiquetaModelo = this.EtiquetaArchivo(Cuerpo);

    const Fila2 = document.createElement('div');
    Fila2.className = 'FilaControles';
    Fila2.append(
      this.Boton('Pose de reposo', () => { Ctx.Modelos.RestablecerPose(); }),
      this.Boton('Guardar como reposo', () => {
        Ctx.Modelos.GuardarPoseReposo();
        Ctx.NotificarEstado('Pose actual guardada como reposo.');
      })
    );
    Cuerpo.appendChild(Fila2);
    this.Casilla(Cuerpo, 'Mostrar esqueleto', false, (V) => Ctx.Modelos.AlternarAyudante(V));

    // Selector de hueso y deslizadores de rotación
    this.SelectorHuesos = document.createElement('select');
    this.SelectorHuesos.onchange = () => this.SincronizarDeslizadoresHueso();
    Cuerpo.appendChild(this.SelectorHuesos);

    for (let Eje = 0; Eje < 3; Eje++) {
      const NombreEje = ['Rotación X', 'Rotación Y', 'Rotación Z'][Eje];
      const { Entrada, Salida } = this.Deslizador(
        Cuerpo, NombreEje, -180, 180, 1, 0,
        (V) => this.AplicarRotacionDesdeDeslizadores(),
        (V) => `${V.toFixed(0)}°`
      );
      this.DeslizadoresHueso.push(Entrada);
      this.SalidasHueso.push(Salida);
    }

    const Fila3 = document.createElement('div');
    Fila3.className = 'FilaControles';
    Fila3.append(
      this.Boton('⬦ Clave de rotación', () => {
        const Nombre = this.SelectorHuesos.value;
        if (!Nombre) return;
        const Euler = Ctx.Modelos.ObtenerRotacionHueso(Nombre);
        const Pista = Ctx.Animacion.ObtenerOCrearPista('HuesoRotacion', Nombre, 'Manual');
        Ctx.Animacion.AgregarClave(Pista, Ctx.Animacion.TiempoActual, [Euler.x, Euler.y, Euler.z]);
      }),
      this.Boton('⬦ Clave de posición (cadera)', () => {
        if (!Ctx.Modelos.Vrm) return;
        const Pos = Ctx.Modelos.ObtenerPosicionHueso('hips');
        const Pista = Ctx.Animacion.ObtenerOCrearPista('HuesoPosicion', 'hips', 'Manual');
        Ctx.Animacion.AgregarClave(Pista, Ctx.Animacion.TiempoActual, [Pos.x, Pos.y, Pos.z]);
      })
    );
    Cuerpo.appendChild(Fila3);
    this.Nota(Cuerpo, 'Consejo: selecciona un hueso, ajústalo con los deslizadores y pulsa «⬦» en el tiempo deseado. Con «Insertar pose» (abajo) se guardan todos los huesos a la vez.');
  }

  private async CargarModelo(Archivo: File): Promise<void> {
    const Ctx = this.Contexto;
    Ctx.NotificarEstado(`Cargando ${Archivo.name}…`);
    try {
      await Ctx.Modelos.CargarVrm(Archivo);
      this.TrasCargarModelo();
    } catch (E) {
      Ctx.NotificarEstado(`Error al cargar: ${(E as Error).message}`);
    }
  }

  private TrasCargarModelo(): void {
    const Ctx = this.Contexto;
    this.EtiquetaModelo.textContent = `Modelo: ${Ctx.Modelos.NombreModelo}`;
    this.ActualizarListaHuesos();
    this.ActualizarExpresiones();
    Ctx.NotificarEstado('Modelo listo. Usa la biblioteca o el seguimiento para animarlo.');
  }

  /** Reconstruye el selector de huesos según el modelo cargado. */
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

  private SincronizarDeslizadoresHueso(): void {
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

  // -------- Expresiones faciales (Etapa 2) --------
  private ConstruirSeccionExpresiones(): void {
    const Cuerpo = this.Seccion(this.RaizDer, 'Expresiones faciales', true);
    this.ContenedorExpresiones = document.createElement('div');
    this.ContenedorExpresiones.style.display = 'flex';
    this.ContenedorExpresiones.style.flexDirection = 'column';
    this.ContenedorExpresiones.style.gap = '8px';
    Cuerpo.appendChild(this.ContenedorExpresiones);

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    Fila.append(
      this.Boton('⬦ Claves de expresión', () => {
        const Ctx = this.Contexto;
        for (const Nombre of Ctx.Modelos.ObtenerExpresiones()) {
          const Peso = Ctx.Modelos.ObtenerValorExpresion(Nombre);
          if (Peso > 0.001) {
            const Pista = Ctx.Animacion.ObtenerOCrearPista('Expresion', Nombre, 'Manual');
            Ctx.Animacion.AgregarClave(Pista, Ctx.Animacion.TiempoActual, [Peso]);
          }
        }
      }),
      this.Boton('Limpiar rostro', () => this.Contexto.Modelos.LimpiarExpresiones())
    );
    Cuerpo.appendChild(Fila);
    this.ActualizarExpresiones();
  }

  /** Reconstruye los deslizadores de expresiones del modelo actual. */
  public ActualizarExpresiones(): void {
    this.ContenedorExpresiones.innerHTML = '';
    const Expresiones = this.Contexto.Modelos.ObtenerExpresiones();
    if (Expresiones.length === 0) {
      this.Nota(this.ContenedorExpresiones, 'Carga un modelo VRM para ver sus expresiones.');
      return;
    }
    for (const Nombre of Expresiones) {
      this.Deslizador(
        this.ContenedorExpresiones, Nombre, 0, 1, 0.01,
        this.Contexto.Modelos.ObtenerValorExpresion(Nombre),
        (V) => this.Contexto.Modelos.EstablecerExpresion(Nombre, V)
      );
    }
  }

  // -------- Biblioteca de animaciones (Etapa 2 y 3) --------
  private ConstruirSeccionBiblioteca(): void {
    const Cuerpo = this.Seccion(this.RaizIzq, 'Biblioteca de animaciones', true);
    const Ctx = this.Contexto;

    const Rejilla = document.createElement('div');
    Rejilla.className = 'RejillaBotones';
    for (const Preajuste of CATALOGO_PREAJUSTES) {
      const B = this.Boton(Preajuste.Nombre, () => {
        if (!Ctx.Modelos.Vrm) { Ctx.NotificarEstado('Carga primero un modelo VRM.'); return; }
        const Pistas = Preajuste.Generar(Ctx.Animacion.TiempoActual);
        Ctx.Animacion.AgregarPistas(Pistas);
        const Fin = Ctx.Animacion.TiempoActual + Preajuste.Duracion;
        if (Fin > Ctx.Animacion.Duracion) Ctx.Animacion.Duracion = Math.ceil(Fin);
        Ctx.NotificarEstado(`Preajuste «${Preajuste.Nombre}» agregado en ${Ctx.Animacion.TiempoActual.toFixed(2)} s.`);
      });
      B.title = Preajuste.Descripcion;
      Rejilla.appendChild(B);
    }
    Cuerpo.appendChild(Rejilla);

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    Fila.append(
      this.Boton('Importar animación…', async () => {
        const Archivo = await SeleccionarArchivo('.vrma,.json');
        if (!Archivo) return;
        try {
          if (Archivo.name.toLowerCase().endsWith('.vrma')) {
            Ctx.NotificarEstado('Horneando animación VRMA a claves editables…');
            const Clip = await Ctx.Modelos.CargarAnimacionVrma(Archivo);
            Ctx.Animacion.AgregarPistas(Ctx.Animacion.HornearClip(Clip, 24, 'Importado'));
            Ctx.NotificarEstado('Animación VRMA importada como claves editables.');
          } else {
            const Datos = JSON.parse(await LeerArchivoTexto(Archivo));
            if (Array.isArray(Datos.Pistas)) {
              Ctx.Animacion.AgregarPistas(Datos.Pistas);
              Ctx.NotificarEstado('Animación JSON importada.');
            } else {
              throw new Error('Formato JSON no reconocido.');
            }
          }
        } catch (E) { Ctx.NotificarEstado(`Error al importar: ${(E as Error).message}`); }
      }),
      this.Boton('Exportar animación', () => {
        DescargarTexto(Ctx.Animacion.ExportarJSON(), 'AnimacionVRM.json');
      })
    );
    Cuerpo.appendChild(Fila);
    this.Nota(Cuerpo, 'Los preajustes y las animaciones importadas (.vrma / .json) se insertan desde la posición del cabezal y quedan como claves editables.');
  }

  // -------- Seguimiento por video (Etapa 3) --------
  private ConstruirSeccionSeguimiento(): void {
    const Cuerpo = this.Seccion(this.RaizIzq, 'Seguimiento por video');
    const Ctx = this.Contexto;

    Cuerpo.appendChild(this.Boton('Cargar video…', async () => {
      const Archivo = await SeleccionarArchivo('video/*');
      if (Archivo) {
        this.ArchivoVideo = Archivo;
        this.EtiquetaVideo.textContent = `Video: ${Archivo.name}`;
      }
    }));
    this.EtiquetaVideo = this.EtiquetaArchivo(Cuerpo);

    const CasillaCuerpo = this.Casilla(Cuerpo, 'Rastrear cuerpo', true, () => {});
    const CasillaRostro = this.Casilla(Cuerpo, 'Rastrear rostro (expresiones + cabeza)', true, () => {});
    const CasillaEspejo = this.Casilla(Cuerpo, 'Espejo (como cámara frontal)', false, () => {});

    const FilaFps = document.createElement('div');
    FilaFps.className = 'FilaControles';
    const EtiquetaFps = document.createElement('label');
    EtiquetaFps.className = 'EtiquetaCompacta';
    const SelectorFps = document.createElement('select');
    for (const F of [10, 15, 24, 30]) {
      const O = document.createElement('option');
      O.value = String(F); O.textContent = `${F} fps`;
      if (F === 15) O.selected = true;
      SelectorFps.appendChild(O);
    }
    EtiquetaFps.append(document.createTextNode('Muestreo '), SelectorFps);
    FilaFps.appendChild(EtiquetaFps);
    Cuerpo.appendChild(FilaFps);

    const { Entrada: DeslizadorSuavizado } = this.Deslizador(Cuerpo, 'Suavizado', 0, 0.9, 0.05, 0.35, () => {});

    const BotonProcesar = this.Boton('▶ Procesar video', async () => {
      if (!this.ArchivoVideo) { Ctx.NotificarEstado('Carga primero un video.'); return; }
      if (!Ctx.Modelos.Vrm) { Ctx.NotificarEstado('Carga primero un modelo VRM.'); return; }
      const Opciones: OpcionesSeguimiento = {
        Cuerpo: CasillaCuerpo.checked,
        Rostro: CasillaRostro.checked,
        Espejo: CasillaEspejo.checked,
        FpsMuestreo: parseInt(SelectorFps.value, 10),
        Suavizado: parseFloat(DeslizadorSuavizado.value)
      };
      if (!Opciones.Cuerpo && !Opciones.Rostro) {
        Ctx.NotificarEstado('Activa al menos una opción de seguimiento.');
        return;
      }
      BotonProcesar.disabled = true;
      try {
        const Pistas = await Ctx.Tracking.ProcesarVideo(
          this.ArchivoVideo, Opciones, Ctx.Modelos,
          (Fraccion, Mensaje) => {
            this.BarraSeguimiento.style.width = `${Math.round(Fraccion * 100)}%`;
            this.TextoSeguimiento.textContent = Mensaje;
          }
        );
        // Reemplazar pistas de seguimiento anteriores del mismo tipo
        if (Opciones.Cuerpo) Ctx.Animacion.EliminarPistasPorGrupo('SeguimientoCuerpo');
        if (Opciones.Rostro) Ctx.Animacion.EliminarPistasPorGrupo('SeguimientoRostro');
        Ctx.Animacion.AgregarPistas(Pistas);
        const UltimoTiempo = Math.max(0, ...Pistas.flatMap((P) => P.Claves.map((C) => C.Tiempo)));
        if (UltimoTiempo > Ctx.Animacion.Duracion) Ctx.Animacion.Duracion = Math.ceil(UltimoTiempo);
        Ctx.NotificarEstado(`Seguimiento listo: ${Pistas.length} pistas editables generadas.`);
        this.TextoSeguimiento.textContent = `Generadas ${Pistas.length} pistas editables.`;
        this.BarraSeguimiento.style.width = '100%';
      } catch (E) {
        Ctx.NotificarEstado(`Error de seguimiento: ${(E as Error).message}`);
        this.TextoSeguimiento.textContent = 'Error durante el seguimiento.';
      } finally {
        BotonProcesar.disabled = false;
      }
    }, 'BotonPrimario');
    Cuerpo.appendChild(BotonProcesar);

    const { Barra, Texto } = this.CrearBarraProgreso(Cuerpo);
    this.BarraSeguimiento = Barra;
    this.TextoSeguimiento = Texto;
    this.Nota(Cuerpo, 'Requiere conexión la primera vez (descarga los modelos de MediaPipe). El resultado siempre queda como claves editables: selecciona y arrastra los rombos en la línea de tiempo.');
  }

  // -------- Escena y fondo (Etapa 4) --------
  private ConstruirSeccionEscena(): void {
    const Cuerpo = this.Seccion(this.RaizIzq, 'Escena y fondo');
    const Ctx = this.Contexto;

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    const EntradaColor = document.createElement('input');
    EntradaColor.type = 'color';
    EntradaColor.value = '#1b1e26';
    EntradaColor.oninput = () => Ctx.Escena.EstablecerFondoColor(EntradaColor.value);
    Fila.appendChild(EntradaColor);
    Fila.append(
      this.Boton('Imagen de fondo…', async () => {
        const Archivo = await SeleccionarArchivo('image/*');
        if (Archivo) Ctx.Escena.EstablecerFondoImagen(URL.createObjectURL(Archivo));
      }),
      this.Boton('Modelo 3D de fondo…', async () => {
        const Archivo = await SeleccionarArchivo('.glb,.gltf,.vrm');
        if (!Archivo) return;
        try {
          const Objeto = await Ctx.Modelos.CargarModeloFondo(Archivo);
          Ctx.Escena.EstablecerModeloFondo(Objeto);
          Ctx.NotificarEstado(`Fondo 3D cargado: ${Archivo.name}`);
        } catch (E) { Ctx.NotificarEstado(`Error: ${(E as Error).message}`); }
      }),
      this.Boton('Quitar modelo fondo', () => Ctx.Escena.QuitarModeloFondo())
    );
    Cuerpo.appendChild(Fila);

    this.Deslizador(Cuerpo, 'Luz principal', 0, 4, 0.05, 2.2, (V) => Ctx.Escena.EstablecerIntensidadLuz(V));
    this.Casilla(Cuerpo, 'Mostrar rejilla de piso', true, (V) => Ctx.Escena.AlternarRejilla(V));
  }

  // -------- Efectos (Etapa 4) --------
  private ConstruirSeccionEfectos(): void {
    const Cuerpo = this.Seccion(this.RaizIzq, 'Efectos');
    const Ctx = this.Contexto;

    const CasillaBloom = this.Casilla(Cuerpo, 'Brillo (bloom)', false, (V) => Ctx.Escena.EstablecerBloom(V));
    this.Deslizador(Cuerpo, 'Intensidad brillo', 0, 2, 0.05, 0.55, (V) => Ctx.Escena.EstablecerBloom(CasillaBloom.checked, V));

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    const Etiqueta = document.createElement('label');
    Etiqueta.className = 'EtiquetaCompacta';
    const Selector = document.createElement('select');
    for (const Tipo of ['Ninguno', 'Nieve', 'Lluvia', 'Petalos', 'Chispas']) {
      const O = document.createElement('option');
      O.value = Tipo; O.textContent = Tipo;
      Selector.appendChild(O);
    }
    Selector.onchange = () => Ctx.Efectos.EstablecerParticulas(Selector.value as TipoParticulas);
    Etiqueta.append(document.createTextNode('Partículas '), Selector);
    Fila.appendChild(Etiqueta);
    Cuerpo.appendChild(Fila);

    this.Deslizador(Cuerpo, 'Cantidad partículas', 50, 1000, 10, 300, (V) => {
      if (Ctx.Efectos.Tipo !== 'Ninguno') Ctx.Efectos.EstablecerParticulas(Ctx.Efectos.Tipo, V);
    }, (V) => String(Math.round(V)));
  }

  // -------- Audio (Etapa 4) --------
  private ConstruirSeccionAudio(): void {
    const Cuerpo = this.Seccion(this.RaizIzq, 'Audio');
    const Ctx = this.Contexto;

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';
    Fila.append(
      this.Boton('Cargar audio…', async () => {
        const Archivo = await SeleccionarArchivo('audio/*');
        if (!Archivo) return;
        try {
          await Ctx.Audio.Cargar(Archivo);
          this.EtiquetaAudio.textContent = `Audio: ${Archivo.name} (${Ctx.Audio.ObtenerDuracion().toFixed(1)} s)`;
          Ctx.RefrescarLineaTiempo();
          Ctx.NotificarEstado('Audio cargado y sincronizado con la línea de tiempo.');
        } catch (E) { Ctx.NotificarEstado(`Error de audio: ${(E as Error).message}`); }
      }),
      this.Boton('Quitar', () => {
        Ctx.Audio.Quitar();
        this.EtiquetaAudio.textContent = 'Ningún archivo cargado';
        Ctx.RefrescarLineaTiempo();
      })
    );
    Cuerpo.appendChild(Fila);
    this.EtiquetaAudio = this.EtiquetaArchivo(Cuerpo);

    this.Deslizador(Cuerpo, 'Volumen', 0, 1, 0.01, 0.9, (V) => Ctx.Audio.EstablecerVolumen(V));

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
      Ctx.RefrescarLineaTiempo();
    };
    Etiqueta.append(document.createTextNode('Desplazamiento (s) '), EntradaDesplazamiento);
    Fila2.appendChild(Etiqueta);
    Cuerpo.appendChild(Fila2);
    this.Nota(Cuerpo, 'Valores positivos retrasan el audio; negativos lo adelantan.');
  }

  // -------- Exportación (Etapa 5) --------
  private ConstruirSeccionExportacion(): void {
    const Cuerpo = this.Seccion(this.RaizDer, 'Exportar video', true);
    const Ctx = this.Contexto;

    const Fila = document.createElement('div');
    Fila.className = 'FilaControles';

    const EtiquetaRes = document.createElement('label');
    EtiquetaRes.className = 'EtiquetaCompacta';
    const SelectorRes = document.createElement('select');
    RESOLUCIONES_EXPORTACION.forEach((R, I) => {
      const O = document.createElement('option');
      O.value = String(I);
      O.textContent = `${R.Etiqueta} (${R.Ancho}×${R.Alto})`;
      if (I === 1) O.selected = true;
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

    const CasillaAudio = this.Casilla(Fila, 'Incluir audio', true, () => {});
    Fila.prepend(EtiquetaRes, EtiquetaFps, EtiquetaFormato);
    Cuerpo.appendChild(Fila);

    const BotonExportar = this.Boton('⬇ Exportar video', async () => {
      if (!Ctx.Modelos.Vrm) { Ctx.NotificarEstado('Carga primero un modelo VRM.'); return; }
      const Res = RESOLUCIONES_EXPORTACION[parseInt(SelectorRes.value, 10)];
      const Opciones: OpcionesExportacion = {
        Ancho: Res.Ancho, Alto: Res.Alto,
        Fps: parseInt(SelectorFps.value, 10),
        Formato: SelectorFormato.value as 'mp4' | 'webm',
        IncluirAudio: CasillaAudio.checked
      };
      BotonExportar.disabled = true;
      BotonCancelar.disabled = false;
      try {
        await Ctx.Exportador.Exportar(Opciones, Ctx, (Fraccion, Mensaje) => {
          this.BarraExportacion.style.width = `${Math.round(Fraccion * 100)}%`;
          this.TextoExportacion.textContent = Mensaje;
        });
        Ctx.NotificarEstado('Video exportado correctamente.');
      } catch (E) {
        Ctx.NotificarEstado((E as Error).message);
        this.TextoExportacion.textContent = (E as Error).message;
      } finally {
        BotonExportar.disabled = false;
        BotonCancelar.disabled = true;
      }
    }, 'BotonPrimario');

    const BotonCancelar = this.Boton('Cancelar', () => Ctx.Exportador.CancelarExportacion(), 'BotonPeligro');
    BotonCancelar.disabled = true;

    const Fila2 = document.createElement('div');
    Fila2.className = 'FilaControles';
    Fila2.append(BotonExportar, BotonCancelar);
    Cuerpo.appendChild(Fila2);

    const { Barra, Texto } = this.CrearBarraProgreso(Cuerpo);
    this.BarraExportacion = Barra;
    this.TextoExportacion = Texto;
    this.Nota(Cuerpo, 'La exportación MP4 renderiza cuadro a cuadro con paso fijo: la calidad final no depende del rendimiento de la previa. 4K puede tardar varios minutos.');
  }

  /** Refresca las partes dinámicas tras cargar proyecto o modelo. */
  public RefrescarDinamico(): void {
    this.ActualizarListaHuesos();
    this.ActualizarExpresiones();
    const Audio = this.Contexto.Audio;
    this.EtiquetaAudio.textContent = Audio.Buffer ? `Audio: ${Audio.NombreArchivo}` : 'Ningún archivo cargado';
    this.EtiquetaModelo.textContent = this.Contexto.Modelos.Vrm
      ? `Modelo: ${this.Contexto.Modelos.NombreModelo}`
      : 'Ningún archivo cargado';
  }
}

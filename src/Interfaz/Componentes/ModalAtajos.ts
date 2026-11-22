// ============================================================================
// ModalAtajos.ts — Diálogo modal accesible con guía rápida de atajos
// Usa <dialog closedby="any"> con tablas semánticas y teclas <kbd>.
// ============================================================================

import { CrearIcono } from './Iconos';
import { ConfigurarLightDismissFallback } from './UtilidadesDialogo';

interface GrupoAtajos {
  Titulo: string;
  Filas: Array<[string, string]>;
}

const GRUPOS_ATAJOS: GrupoAtajos[] = [
  {
    Titulo: 'Reproducción y Línea de Tiempo',
    Filas: [
      ['Espacio', 'Reproducir o pausar animación'],
      ['← / →', 'Avanzar o retroceder 1 cuadro (1/30 s)'],
      ['Shift + ← / →', 'Saltar ±1 segundo'],
      ['Inicio / Fin', 'Ir al principio o al final'],
      ['[ / ,  y  ] / .', 'Saltar a clave anterior o siguiente'],
      ['F', 'Encuadrar toda la animación en el timeline']
    ]
  },
  {
    Titulo: 'Fotogramas Clave y Edición',
    Filas: [
      ['K', 'Insertar o sobrescribir pose completa'],
      ['Shift + K', 'Guardar clave solo para el hueso activo'],
      ['Ctrl+C / Ctrl+V', 'Copiar y pegar claves en el cabezal'],
      ['Ctrl+D', 'Duplicar selección al cabezal'],
      ['Ctrl+A', 'Seleccionar todas las claves visibles'],
      ['Supr / Retroceso', 'Eliminar las claves seleccionadas'],
      ['Alt + Arrastrar', 'Duplicar claves arrastrando en el timeline']
    ]
  },
  {
    Titulo: 'Visor 3D y Cámaras',
    Filas: [
      ['Q / W / E', 'Selección / Mover / Rotar hueso'],
      ['R', 'Alternar espacio Local / Mundo'],
      ['1 / 2 / 3 / 4', 'Cámaras: Frontal / 3/4 / Perfil / Rostro'],
      ['Arrastre en visor', 'Orbitar (izq), desplazar (der), zoom (rueda)']
    ]
  },
  {
    Titulo: 'Proyecto e Historial',
    Filas: [
      ['Ctrl+Z / Ctrl+Y', 'Deshacer o rehacer acción'],
      ['Ctrl+S / Ctrl+O', 'Guardar o abrir archivo de proyecto'],
      ['?', 'Abrir esta guía de atajos']
    ]
  }
];

export class ModalAtajos {
  private readonly Dialogo: HTMLDialogElement;

  constructor() {
    this.Dialogo = document.createElement('dialog');
    this.Dialogo.id = 'ModalAtajos';
    this.Dialogo.className = 'DialogoEstudio ModalAtajosDialogo';
    this.Dialogo.setAttribute('closedby', 'any');
    this.Dialogo.setAttribute('aria-labelledby', 'TituloModalAtajos');

    const Cabecera = document.createElement('div');
    Cabecera.className = 'CabeceraDialogo';

    const Titulo = document.createElement('h2');
    Titulo.id = 'TituloModalAtajos';
    Titulo.textContent = 'Atajos de teclado y flujo rápido';

    const BtnCerrar = document.createElement('button');
    BtnCerrar.type = 'button';
    BtnCerrar.className = 'BotonCerrar';
    BtnCerrar.setAttribute('aria-label', 'Cerrar guía de atajos');
    BtnCerrar.autofocus = true;
    BtnCerrar.appendChild(CrearIcono('close'));
    BtnCerrar.onclick = () => this.Dialogo.close('');

    Cabecera.append(Titulo, BtnCerrar);

    const Cuerpo = document.createElement('div');
    Cuerpo.className = 'CuerpoDialogo';

    const Rejilla = document.createElement('div');
    Rejilla.className = 'RejillaAtajos';

    for (const Grupo of GRUPOS_ATAJOS) {
      const Tabla = document.createElement('table');
      Tabla.className = 'TablaAtajos';

      const Caption = document.createElement('caption');
      Caption.textContent = Grupo.Titulo;

      const Thead = document.createElement('thead');
      const FilaHead = document.createElement('tr');
      const ThTecla = document.createElement('th');
      ThTecla.scope = 'col';
      ThTecla.textContent = 'Atajo';
      const ThAccion = document.createElement('th');
      ThAccion.scope = 'col';
      ThAccion.textContent = 'Acción';
      FilaHead.append(ThTecla, ThAccion);
      Thead.appendChild(FilaHead);

      const Tbody = document.createElement('tbody');
      for (const [Teclas, Desc] of Grupo.Filas) {
        const Fila = document.createElement('tr');
        const TdK = document.createElement('td');
        const Kbd = document.createElement('kbd');
        Kbd.textContent = Teclas;
        TdK.appendChild(Kbd);
        const TdD = document.createElement('td');
        TdD.textContent = Desc;
        Fila.append(TdK, TdD);
        Tbody.appendChild(Fila);
      }

      Tabla.append(Caption, Thead, Tbody);
      Rejilla.appendChild(Tabla);
    }

    Cuerpo.appendChild(Rejilla);

    const Pie = document.createElement('form');
    Pie.method = 'dialog';
    Pie.className = 'PieDialogo';
    const BtnOk = document.createElement('button');
    BtnOk.type = 'submit';
    BtnOk.className = 'BotonPrimario';
    BtnOk.value = 'ok';
    BtnOk.textContent = 'Entendido';
    Pie.appendChild(BtnOk);

    this.Dialogo.append(Cabecera, Cuerpo, Pie);
    document.body.appendChild(this.Dialogo);

    ConfigurarLightDismissFallback(this.Dialogo);
    this.Dialogo.addEventListener('close', () => {
      this.Dialogo.returnValue = '';
    });
  }

  public Abrir(): void {
    if (!this.Dialogo.open) this.Dialogo.showModal();
  }
}

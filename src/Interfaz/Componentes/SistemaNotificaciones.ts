// ============================================================================
// SistemaNotificaciones.ts — Patrón Observer para barra de estado, región
// viva accesible y notificaciones flotantes (toasts) con botón Deshacer.
// ============================================================================

import { BusEventos, TipoNotificacion } from '../../Arquitectura/BusEventos';
import { HistorialComandos } from '../../Arquitectura/HistorialComandos';

export class SistemaNotificaciones {
  private Pila: HTMLElement | null;
  private Indicador: HTMLElement | null;
  private RegionViva: HTMLElement | null;
  private TemporizadorAnuncio: number | null = null;
  private Desuscribir: () => void;

  constructor(
    Bus: BusEventos,
    private readonly Historial: HistorialComandos
  ) {
    this.Pila = document.getElementById('PilaNotificaciones');
    this.Indicador = document.getElementById('IndicadorEstado');
    this.RegionViva = document.getElementById('RegionAnuncios');

    this.Desuscribir = Bus.Suscribir('estado:notificar', (Datos) => {
      this.Mostrar(Datos.mensaje, Datos.tipo ?? 'info', Boolean(Datos.permitirDeshacer));
    });
  }

  public Destruir(): void {
    this.Desuscribir();
  }

  private ActualizarReferenciasDom(): void {
    if (!this.Pila) this.Pila = document.getElementById('PilaNotificaciones');
    if (!this.Indicador) this.Indicador = document.getElementById('IndicadorEstado');
    if (!this.RegionViva) this.RegionViva = document.getElementById('RegionAnuncios');
  }

  public Mostrar(Mensaje: string, Tipo: TipoNotificacion = 'info', PermitirDeshacer = false): void {
    this.ActualizarReferenciasDom();

    if (this.Indicador) {
      this.Indicador.textContent = Mensaje;
    }

    // Evitar anuncios en región viva si hay un diálogo modal abierto (el DOM fuera del modal está inerte)
    if (this.RegionViva && !document.querySelector('dialog[open]')) {
      if (this.TemporizadorAnuncio !== null) window.clearTimeout(this.TemporizadorAnuncio);
      this.TemporizadorAnuncio = window.setTimeout(() => {
        if (this.RegionViva) this.RegionViva.textContent = Mensaje;
      }, 120);
    }

    if (!this.Pila) return;
    while (this.Pila.children.length >= 3) {
      this.Pila.firstElementChild?.remove();
    }

    const Toast = document.createElement('div');
    Toast.className = `ToastNotificacion Toast-${Tipo}`;

    const Texto = document.createElement('span');
    Texto.className = 'ToastTexto';
    Texto.textContent = Mensaje;
    Toast.appendChild(Texto);

    if (PermitirDeshacer && this.Historial.PuedeDeshacer()) {
      const BtnDeshacer = document.createElement('button');
      BtnDeshacer.type = 'button';
      BtnDeshacer.className = 'ToastAccion';
      BtnDeshacer.textContent = 'Deshacer';
      BtnDeshacer.onclick = () => {
        this.Historial.Deshacer();
        Toast.remove();
      };
      Toast.appendChild(BtnDeshacer);
    }

    this.Pila.appendChild(Toast);

    const Duracion = Tipo === 'error' ? 5000 : 3400;
    window.setTimeout(() => {
      Toast.classList.add('Saliendo');
      window.setTimeout(() => Toast.remove(), 220);
    }, Duracion);
  }
}

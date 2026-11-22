// ============================================================================
// UtilidadesDialogo.ts — Diálogos modales nativos con <dialog> y fallbacks
// Sigue las prácticas modernas: showModal(), closedby="any", autofocus seguro,
// limpieza de returnValue y fallback pointerdown/pointerup fuera del rectángulo.
// ============================================================================

import { GenerarId } from '../../Utilidades';

/**
 * Instala el cierre al hacer clic fuera en navegadores sin soporte nativo de `closedby="any"`.
 * Comprueba coordenadas en pointerdown y pointerup para evitar cierres por arrastres de texto.
 */
export function ConfigurarLightDismissFallback(Dialogo: HTMLDialogElement): void {
  if ('closedBy' in HTMLDialogElement.prototype) return;

  const FueraDeLimite = (E: PointerEvent): boolean => {
    const R = Dialogo.getBoundingClientRect();
    return E.clientX < R.left || E.clientX > R.right || E.clientY < R.top || E.clientY > R.bottom;
  };

  let PresionadoFuera = false;
  Dialogo.addEventListener('pointerdown', (E) => {
    PresionadoFuera = Dialogo.getAttribute('closedby') === 'any' && FueraDeLimite(E);
  });
  Dialogo.addEventListener('pointerup', (E) => {
    if (PresionadoFuera && Dialogo.getAttribute('closedby') === 'any' && FueraDeLimite(E)) {
      Dialogo.close('');
    }
    PresionadoFuera = false;
  });
}

export interface OpcionesConfirmacion {
  Titulo: string;
  Mensaje: string;
  TextoConfirmar?: string;
  TextoCancelar?: string;
  Peligroso?: boolean;
}

/**
 * Abre un diálogo modal accesible de confirmación en reemplazo de window.confirm().
 */
export function ConfirmarAccion(Opciones: OpcionesConfirmacion): Promise<boolean> {
  return new Promise((Resolver) => {
    const TituloId = `dlg-confirm-title-${GenerarId()}`;
    const Dialogo = document.createElement('dialog');
    Dialogo.className = 'DialogoEstudio DialogoCompacto';
    Dialogo.setAttribute('closedby', 'any');
    Dialogo.setAttribute('aria-labelledby', TituloId);

    const Cabecera = document.createElement('div');
    Cabecera.className = 'CabeceraDialogo';
    const H2 = document.createElement('h2');
    H2.id = TituloId;
    H2.textContent = Opciones.Titulo;
    Cabecera.appendChild(H2);

    const Cuerpo = document.createElement('div');
    Cuerpo.className = 'CuerpoDialogo';
    const Parrafo = document.createElement('p');
    Parrafo.className = 'TextoDialogo';
    Parrafo.textContent = Opciones.Mensaje;
    Cuerpo.appendChild(Parrafo);

    const Formulario = document.createElement('form');
    Formulario.method = 'dialog';
    Formulario.className = 'PieDialogo';

    const BtnCancelar = document.createElement('button');
    BtnCancelar.type = 'submit';
    BtnCancelar.value = 'cancel';
    BtnCancelar.textContent = Opciones.TextoCancelar ?? 'Cancelar';
    BtnCancelar.autofocus = true;

    const BtnConfirmar = document.createElement('button');
    BtnConfirmar.type = 'submit';
    BtnConfirmar.value = 'confirm';
    BtnConfirmar.textContent = Opciones.TextoConfirmar ?? 'Confirmar';
    BtnConfirmar.className = Opciones.Peligroso ? 'BotonPeligro' : 'BotonPrimario';

    Formulario.append(BtnCancelar, BtnConfirmar);
    Dialogo.append(Cabecera, Cuerpo, Formulario);
    document.body.appendChild(Dialogo);

    ConfigurarLightDismissFallback(Dialogo);

    Dialogo.addEventListener('close', () => {
      const Confirmado = Dialogo.returnValue === 'confirm';
      Dialogo.returnValue = '';
      Dialogo.remove();
      Resolver(Confirmado);
    }, { once: true });

    Dialogo.showModal();
  });
}

export interface OpcionesNumeroDialogo {
  Titulo: string;
  Etiqueta: string;
  ValorInicial: number;
  Paso?: number;
  Min?: number;
  Max?: number;
  Unidad?: string;
}

/**
 * Abre un diálogo modal nativo para solicitar un valor numérico (p. ej. desplazamiento temporal).
 */
export function SolicitarNumeroDialogo(Opciones: OpcionesNumeroDialogo): Promise<number | null> {
  return new Promise((Resolver) => {
    const TituloId = `dlg-num-title-${GenerarId()}`;
    const InputId = `dlg-num-input-${GenerarId()}`;

    const Dialogo = document.createElement('dialog');
    Dialogo.className = 'DialogoEstudio DialogoCompacto';
    Dialogo.setAttribute('closedby', 'any');
    Dialogo.setAttribute('aria-labelledby', TituloId);

    const Cabecera = document.createElement('div');
    Cabecera.className = 'CabeceraDialogo';
    const H2 = document.createElement('h2');
    H2.id = TituloId;
    H2.textContent = Opciones.Titulo;
    Cabecera.appendChild(H2);

    const Formulario = document.createElement('form');
    Formulario.method = 'dialog';

    const Cuerpo = document.createElement('div');
    Cuerpo.className = 'CuerpoDialogo';

    const Fila = document.createElement('div');
    Fila.className = 'CampoDialogo';
    const Label = document.createElement('label');
    Label.htmlFor = InputId;
    Label.textContent = Opciones.Etiqueta + (Opciones.Unidad ? ` (${Opciones.Unidad})` : '');

    const Entrada = document.createElement('input');
    Entrada.id = InputId;
    Entrada.type = 'number';
    Entrada.value = String(Opciones.ValorInicial);
    Entrada.step = String(Opciones.Paso ?? 0.1);
    if (Opciones.Min !== undefined) Entrada.min = String(Opciones.Min);
    if (Opciones.Max !== undefined) Entrada.max = String(Opciones.Max);
    Entrada.autofocus = true;

    Fila.append(Label, Entrada);
    Cuerpo.appendChild(Fila);

    const Pie = document.createElement('div');
    Pie.className = 'PieDialogo';

    const BtnCancelar = document.createElement('button');
    BtnCancelar.type = 'submit';
    BtnCancelar.value = 'cancel';
    BtnCancelar.textContent = 'Cancelar';

    const BtnAceptar = document.createElement('button');
    BtnAceptar.type = 'submit';
    BtnAceptar.value = 'confirm';
    BtnAceptar.textContent = 'Aplicar';
    BtnAceptar.className = 'BotonPrimario';

    Pie.append(BtnCancelar, BtnAceptar);
    Formulario.append(Cuerpo, Pie);
    Dialogo.append(Cabecera, Formulario);
    document.body.appendChild(Dialogo);

    ConfigurarLightDismissFallback(Dialogo);

    Dialogo.addEventListener('close', () => {
      const Aceptado = Dialogo.returnValue === 'confirm';
      const Num = parseFloat(Entrada.value);
      Dialogo.returnValue = '';
      Dialogo.remove();
      Resolver(Aceptado && Number.isFinite(Num) ? Num : null);
    }, { once: true });

    Dialogo.showModal();
    Entrada.select();
  });
}

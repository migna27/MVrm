// ============================================================================
// MenuContextual.ts — Menú contextual accesible con Popover API, focusgroup
// y Anchor Positioning con fallbacks progresivos para navegación por teclado.
// ============================================================================

export type ElementoMenuContextual =
  | { Tipo: 'separador' }
  | {
      Tipo: 'accion';
      Etiqueta: string;
      Atajo?: string;
      Peligroso?: boolean;
      Deshabilitado?: boolean;
      Marcado?: boolean;
      AlActivar: () => void;
    };

/**
 * Renderiza un menú popup en la capa superior usando `popover="auto"`, un ancla
 * virtual posicionada en el puntero y `focusgroup="menu nomemory"` con fallback.
 */
export class MenuContextual {
  private Ancla: HTMLElement;
  private Popover: HTMLElement;
  private ContenedorMenu: HTMLElement;
  private FocoPrevio: HTMLElement | null = null;
  private SoportaFocusGroup: boolean;
  private SoportaAnchorPositioning: boolean;

  constructor() {
    this.SoportaFocusGroup = 'focusGroup' in HTMLElement.prototype;
    this.SoportaAnchorPositioning =
      typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('position-area', 'block-end');

    this.Ancla = document.createElement('span');
    this.Ancla.id = 'AnclaMenuContextual';
    this.Ancla.className = 'AnclaMenuContextual';
    this.Ancla.setAttribute('aria-hidden', 'true');

    this.Popover = document.createElement('div');
    this.Popover.id = 'MenuContextualTimeline';
    this.Popover.className = 'MenuPopover';
    this.Popover.setAttribute('popover', 'auto');

    this.ContenedorMenu = document.createElement('div');
    this.ContenedorMenu.setAttribute('focusgroup', 'menu nomemory');
    this.ContenedorMenu.setAttribute('aria-label', 'Acciones contextuales');
    if (!this.SoportaFocusGroup) {
      this.ContenedorMenu.setAttribute('role', 'menu');
    }

    this.Popover.appendChild(this.ContenedorMenu);
    // Ancla colocada inmediatamente antes del popover en el DOM
    document.body.append(this.Ancla, this.Popover);

    this.VincularEventos();
  }

  private VincularEventos(): void {
    this.Popover.addEventListener('toggle', (E: any) => {
      if (E.newState === 'open') {
        if (!this.SoportaAnchorPositioning) {
          this.PosicionarManualmente();
        }
      } else {
        if (this.FocoPrevio && document.contains(this.FocoPrevio)) {
          this.FocoPrevio.focus({ preventScroll: true });
        }
        this.FocoPrevio = null;
      }
    });

    if (!this.SoportaFocusGroup) {
      this.ContenedorMenu.addEventListener('keydown', (E) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(E.key)) return;
        if (E.key === 'Tab') {
          this.Cerrar();
          return;
        }
        const Botones = [...this.ContenedorMenu.querySelectorAll('button')]
          .filter((B) => B.getAttribute('aria-disabled') !== 'true');
        if (Botones.length === 0) return;

        const Actual = Botones.indexOf(document.activeElement as HTMLButtonElement);
        let Siguiente = 0;
        if (E.key === 'Home') Siguiente = 0;
        else if (E.key === 'End') Siguiente = Botones.length - 1;
        else if (Actual < 0) Siguiente = E.key === 'ArrowUp' ? Botones.length - 1 : 0;
        else Siguiente = (Actual + (E.key === 'ArrowUp' ? -1 : 1) + Botones.length) % Botones.length;

        E.preventDefault();
        E.stopPropagation();
        Botones[Siguiente].focus({ preventScroll: true });
      });
    }
  }

  public Abrir(X: number, Y: number, Elementos: ElementoMenuContextual[], EnfocarPrimerItem = false): void {
    if (Elementos.length === 0) return;
    this.FocoPrevio = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    this.Ancla.style.left = `${X}px`;
    this.Ancla.style.top = `${Y}px`;

    this.ContenedorMenu.innerHTML = '';
    for (const Item of Elementos) {
      if (Item.Tipo === 'separador') {
        this.ContenedorMenu.appendChild(document.createElement('hr'));
        continue;
      }

      const Btn = document.createElement('button');
      Btn.type = 'button';
      if (Item.Peligroso) Btn.classList.add('Peligroso');

      if (Item.Marcado !== undefined) {
        Btn.setAttribute('role', 'menuitemcheckbox');
        Btn.setAttribute('aria-checked', String(Item.Marcado));
      } else if (!this.SoportaFocusGroup) {
        Btn.setAttribute('role', 'menuitem');
      }

      if (Item.Deshabilitado) {
        Btn.setAttribute('aria-disabled', 'true');
      }

      const Texto = document.createElement('span');
      Texto.textContent = Item.Etiqueta;
      Btn.appendChild(Texto);

      if (Item.Atajo) {
        const Hint = document.createElement('span');
        Hint.className = 'hint';
        Hint.setAttribute('aria-hidden', 'true');
        Hint.textContent = Item.Atajo;
        Btn.appendChild(Hint);
      }

      Btn.addEventListener('pointermove', () => {
        if (Btn.getAttribute('aria-disabled') !== 'true') {
          (Btn as any).focus({ focusVisible: false });
        }
      });

      Btn.onclick = () => {
        if (Btn.getAttribute('aria-disabled') === 'true') return;
        this.Cerrar();
        Item.AlActivar();
      };

      this.ContenedorMenu.appendChild(Btn);
    }

    try {
      (this.Popover as any).showPopover({ source: this.Ancla });
    } catch {
      this.Popover.showPopover();
      this.PosicionarManualmente();
    }

    if (EnfocarPrimerItem) {
      const Primero = this.ContenedorMenu.querySelector('button:not([aria-disabled="true"])') as HTMLElement | null;
      Primero?.focus({ preventScroll: true });
    }
  }

  public Cerrar(): void {
    try {
      if (this.Popover.matches(':popover-open')) {
        this.Popover.hidePopover();
      }
    } catch {
      this.Popover.classList.remove(':popover-open');
    }
  }

  private PosicionarManualmente(): void {
    const AnclaRect = this.Ancla.getBoundingClientRect();
    const MenuRect = this.Popover.getBoundingClientRect();
    const Left = Math.max(8, Math.min(AnclaRect.left, window.innerWidth - MenuRect.width - 8));
    const Top = Math.max(8, Math.min(AnclaRect.top, window.innerHeight - MenuRect.height - 8));
    this.Popover.style.left = `${Left}px`;
    this.Popover.style.top = `${Top}px`;
  }
}

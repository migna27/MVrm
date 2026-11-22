// ============================================================================
// Iconos.ts — Biblioteca de iconos SVG accesibles y ligeros para el estudio
// Usa currentColor y aria-hidden="true" para integrarse con botones de barra.
// ============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONOS_PATHS = {
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  skipStart: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
  prevKey: '<polyline points="15 18 9 12 15 6"/><path d="M5 5v14"/>',
  nextKey: '<polyline points="9 18 15 12 9 6"/><path d="M19 5v14"/>',
  loop: '<polyline points="17 2 21 6 17 10"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><polyline points="7 22 3 18 7 14"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  range: '<path d="M5 5h3v14H5"/><path d="M19 5h-3v14h3"/><line x1="8" y1="12" x2="16" y2="12"/>',
  key: '<polygon points="12 3 21 12 12 21 3 12 12 3"/>',
  keyFill: '<polygon points="12 3 21 12 12 21 3 12 12 3" fill="currentColor"/>',
  record: '<circle cx="12" cy="12" r="6" fill="currentColor"/><circle cx="12" cy="12" r="9"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<polyline points="15 14 20 9 15 4"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  paste: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/><line x1="14" y1="11" x2="14" y2="17"/><line x1="11" y1="14" x2="17" y2="14"/>',
  magnet: '<path d="M6 15V6a6 6 0 0 1 12 0v9"/><line x1="6" y1="15" x2="10" y2="15"/><line x1="14" y1="15" x2="18" y2="15"/><path d="M10 15V6a2 2 0 0 1 4 0v9"/>',
  import: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  mirror: '<line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="2 2"/><polygon points="3 7 9 12 3 17 3 7"/><polygon points="21 7 15 12 21 17 21 7"/>',
  move: '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>',
  skeleton: '<circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="14"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="12" y1="14" x2="8" y2="20"/><line x1="12" y1="14" x2="16" y2="20"/>',
  reset: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  unmute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  fit: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  simplify: '<path d="M3 17c3-8 6-8 9 0s6 8 9 0"/><circle cx="3" cy="17" r="1.5" fill="currentColor"/><circle cx="21" cy="17" r="1.5" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  curveSuave: '<path d="M4 18C10 18 14 6 20 6"/>',
  curveLineal: '<line x1="4" y1="18" x2="20" y2="6"/>',
  curveEntrada: '<path d="M4 18C14 18 18 12 20 6"/>',
  curveSalida: '<path d="M4 18C6 12 10 6 20 6"/>',
  curveEscalon: '<polyline points="4 18 13 18 13 6 20 6"/>'
} as const;

export type NombreIcono = keyof typeof ICONOS_PATHS;

/** Crea un elemento SVG decorativo consistente con el tema actual. */
export function CrearIcono(Nombre: NombreIcono, Clase = 'IconoSvg'): SVGSVGElement {
  const Svg = document.createElementNS(SVG_NS, 'svg');
  Svg.setAttribute('viewBox', '0 0 24 24');
  Svg.setAttribute('fill', 'none');
  Svg.setAttribute('stroke', 'currentColor');
  Svg.setAttribute('stroke-width', '1.9');
  Svg.setAttribute('stroke-linecap', 'round');
  Svg.setAttribute('stroke-linejoin', 'round');
  Svg.setAttribute('aria-hidden', 'true');
  Svg.setAttribute('class', Clase);
  Svg.innerHTML = ICONOS_PATHS[Nombre];
  return Svg;
}

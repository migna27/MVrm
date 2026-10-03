// ============================================================================
// Utilidades.ts — Funciones auxiliares de uso general
// ============================================================================

/** Genera un identificador único corto para claves y pistas. */
export function GenerarId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Limita un valor entre un mínimo y un máximo. */
export function Limitar(Valor: number, Minimo: number, Maximo: number): number {
  return Math.min(Maximo, Math.max(Minimo, Valor));
}

/** Interpolación suave (smoothstep) para transiciones agradables. */
export function InterpolacionSuave(T: number): number {
  const V = Limitar(T, 0, 1);
  return V * V * (3 - 2 * V);
}

/** Formatea segundos como mm:ss.cc para el transporte y la regla. */
export function FormatearTiempo(Segundos: number): string {
  const S = Math.max(0, Segundos);
  const Minutos = Math.floor(S / 60);
  const Segs = Math.floor(S % 60);
  const Centesimas = Math.floor((S % 1) * 100);
  const Relleno = (N: number) => N.toString().padStart(2, '0');
  return `${Relleno(Minutos)}:${Relleno(Segs)}.${Relleno(Centesimas)}`;
}

/** Descarga un Blob como archivo en el equipo del usuario. */
export function DescargarBlob(Contenido: Blob, NombreArchivo: string): void {
  const Url = URL.createObjectURL(Contenido);
  const Enlace = document.createElement('a');
  Enlace.href = Url;
  Enlace.download = NombreArchivo;
  Enlace.click();
  setTimeout(() => URL.revokeObjectURL(Url), 4000);
}

/** Descarga una cadena de texto como archivo. */
export function DescargarTexto(Texto: string, NombreArchivo: string): void {
  DescargarBlob(new Blob([Texto], { type: 'application/json' }), NombreArchivo);
}

/** Abre un selector de archivo y devuelve el archivo elegido (o null). */
export function SeleccionarArchivo(Aceptar: string): Promise<File | null> {
  return new Promise((Resolver) => {
    const Entrada = document.createElement('input');
    Entrada.type = 'file';
    Entrada.accept = Aceptar;
    Entrada.onchange = () => Resolver(Entrada.files && Entrada.files[0] ? Entrada.files[0] : null);
    // Si el usuario cancela, el foco vuelve a la ventana sin cambios
    window.addEventListener('focus', () => setTimeout(() => Resolver(null), 400), { once: true });
    Entrada.click();
  });
}

/** Lee un archivo como texto plano. */
export function LeerArchivoTexto(Archivo: File): Promise<string> {
  return new Promise((Resolver, Rechazar) => {
    const Lector = new FileReader();
    Lector.onload = () => Resolver(String(Lector.result));
    Lector.onerror = () => Rechazar(new Error('No se pudo leer el archivo'));
    Lector.readAsText(Archivo);
  });
}

/** Convierte radianes a grados para mostrar en la interfaz. */
export function AGrados(Radianes: number): number {
  return Radianes * 180 / Math.PI;
}

/** Convierte grados a radianes para aplicar a los huesos. */
export function ARadianes(Grados: number): number {
  return Grados * Math.PI / 180;
}

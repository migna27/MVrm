// ============================================================================
// GestorEfectos.ts — Etapa 4: Efectos ambientales de partículas
// Sistemas de partículas ligeros (nieve, lluvia, pétalos y chispas) que se
// actualizan por cuadro con bajo costo para mantener la previa fluida.
// ============================================================================

import * as THREE from 'three';

export type TipoParticulas = 'Ninguno' | 'Nieve' | 'Lluvia' | 'Petalos' | 'Chispas' | 'Burbujas' | 'Magia';

interface ConfiguracionParticulas {
  Color: number;
  Tamano: number;
  VelocidadY: [number, number]; // Rango de velocidad vertical
  Vaiven: number;               // Amplitud del vaivén horizontal
}

const CONFIGURACIONES: Record<Exclude<TipoParticulas, 'Ninguno'>, ConfiguracionParticulas> = {
  Nieve:   { Color: 0xffffff, Tamano: 0.10, VelocidadY: [-0.9, -0.4], Vaiven: 0.35 },
  Lluvia:  { Color: 0x9fc3ff, Tamano: 0.05, VelocidadY: [-14, -10],   Vaiven: 0.0 },
  Petalos: { Color: 0xffb7d5, Tamano: 0.12, VelocidadY: [-0.8, -0.5], Vaiven: 0.55 },
  Chispas: { Color: 0xffd977, Tamano: 0.08, VelocidadY: [0.6, 1.6],   Vaiven: 0.25 },
  Burbujas:{ Color: 0xccffff, Tamano: 0.18, VelocidadY: [0.3, 0.8],   Vaiven: 0.15 },
  Magia:   { Color: 0xd88cff, Tamano: 0.06, VelocidadY: [-0.1, 0.3],  Vaiven: 0.60 }
};

// Volumen donde viven las partículas (se reciclan al salir)
const CAJA = { X: 14, Y: 9, Z: 14 };

export class GestorEfectos {
  public Tipo: TipoParticulas = 'Ninguno';
  public Cantidad = 300;

  private Puntos: THREE.Points | null = null;
  private Velocidades: Float32Array | null = null;
  private Fases: Float32Array | null = null;
  private TiempoAcumulado = 0;

  constructor(private Escena: THREE.Scene) {}

  /** Crea o reemplaza el sistema de partículas activo. */
  public EstablecerParticulas(Tipo: TipoParticulas, Cantidad?: number): void {
    this.QuitarParticulas();
    this.Tipo = Tipo;
    if (Cantidad !== undefined) this.Cantidad = Cantidad;
    if (Tipo === 'Ninguno') return;

    const Config = CONFIGURACIONES[Tipo];
    const N = this.Cantidad;

    const Posiciones = new Float32Array(N * 3);
    this.Velocidades = new Float32Array(N * 3);
    this.Fases = new Float32Array(N);

    for (let I = 0; I < N; I++) {
      Posiciones[I * 3] = (Math.random() - 0.5) * CAJA.X;
      Posiciones[I * 3 + 1] = Math.random() * CAJA.Y;
      Posiciones[I * 3 + 2] = (Math.random() - 0.5) * CAJA.Z;
      this.Velocidades[I * 3] = (Math.random() - 0.5) * Config.Vaiven;
      this.Velocidades[I * 3 + 1] = Config.VelocidadY[0] + Math.random() * (Config.VelocidadY[1] - Config.VelocidadY[0]);
      this.Velocidades[I * 3 + 2] = (Math.random() - 0.5) * Config.Vaiven;
      this.Fases[I] = Math.random() * Math.PI * 2;
    }

    const Geometria = new THREE.BufferGeometry();
    Geometria.setAttribute('position', new THREE.BufferAttribute(Posiciones, 3));

    const Material = new THREE.PointsMaterial({
      color: Config.Color,
      size: Config.Tamano,
      map: this.CrearTexturaSuave(),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true
    });

    this.Puntos = new THREE.Points(Geometria, Material);
    this.Puntos.frustumCulled = false;
    this.Escena.add(this.Puntos);
  }

  /** Elimina las partículas de la escena. */
  public QuitarParticulas(): void {
    if (this.Puntos) {
      this.Escena.remove(this.Puntos);
      this.Puntos.geometry.dispose();
      (this.Puntos.material as THREE.Material).dispose();
      this.Puntos = null;
    }
    this.Velocidades = null;
    this.Fases = null;
  }

  /** Avanza la simulación de partículas un paso de tiempo. */
  public Actualizar(Delta: number): void {
    if (!this.Puntos || !this.Velocidades || !this.Fases) return;
    this.TiempoAcumulado += Delta;

    const Atributo = this.Puntos.geometry.getAttribute('position') as THREE.BufferAttribute;
    const Posiciones = Atributo.array as Float32Array;
    const N = Posiciones.length / 3;

    for (let I = 0; I < N; I++) {
      const Vaiven = Math.sin(this.TiempoAcumulado * 1.6 + this.Fases[I]) * 0.3;
      Posiciones[I * 3] += (this.Velocidades[I * 3] + Vaiven * Math.abs(this.Velocidades[I * 3])) * Delta;
      Posiciones[I * 3 + 1] += this.Velocidades[I * 3 + 1] * Delta;
      Posiciones[I * 3 + 2] += this.Velocidades[I * 3 + 2] * Delta;

      // Reciclar partículas que salen del volumen
      if (Posiciones[I * 3 + 1] < 0) Posiciones[I * 3 + 1] = CAJA.Y;
      if (Posiciones[I * 3 + 1] > CAJA.Y) Posiciones[I * 3 + 1] = 0;
      if (Posiciones[I * 3] > CAJA.X / 2) Posiciones[I * 3] = -CAJA.X / 2;
      if (Posiciones[I * 3] < -CAJA.X / 2) Posiciones[I * 3] = CAJA.X / 2;
    }
    Atributo.needsUpdate = true;
  }

  /** Textura radial suave generada en lienzo para partículas redondas. */
  private CrearTexturaSuave(): THREE.Texture {
    const Lienzo = document.createElement('canvas');
    Lienzo.width = Lienzo.height = 64;
    const Contexto = Lienzo.getContext('2d')!;
    const Gradiente = Contexto.createRadialGradient(32, 32, 0, 32, 32, 32);
    Gradiente.addColorStop(0, 'rgba(255,255,255,1)');
    Gradiente.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    Gradiente.addColorStop(1, 'rgba(255,255,255,0)');
    Contexto.fillStyle = Gradiente;
    Contexto.fillRect(0, 0, 64, 64);
    const Textura = new THREE.CanvasTexture(Lienzo);
    Textura.colorSpace = THREE.SRGBColorSpace;
    return Textura;
  }
}

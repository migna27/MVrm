// ============================================================================
// GestorModelos.ts — Etapa 1 y 4: Carga de modelos VRM, pose y expresiones
// Administra el modelo principal, su pose de reposo, los huesos humanoides,
// las expresiones faciales y los modelos de fondo (GLB/GLTF/VRM).
// ============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMAnimation, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

/** Lista de huesos humanoides VRM que se exponen para animar. */
export const NOMBRES_HUESOS = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'
] as const;

/** Nombres legibles en español para la interfaz. */
export const NOMBRES_HUESOS_LEGIBLES: Record<string, string> = {
  hips: 'Cadera', spine: 'Columna', chest: 'Pecho', upperChest: 'Pecho superior',
  neck: 'Cuello', head: 'Cabeza',
  leftShoulder: 'Hombro izq.', leftUpperArm: 'Brazo izq.', leftLowerArm: 'Antebrazo izq.', leftHand: 'Mano izq.',
  rightShoulder: 'Hombro der.', rightUpperArm: 'Brazo der.', rightLowerArm: 'Antebrazo der.', rightHand: 'Mano der.',
  leftUpperLeg: 'Muslo izq.', leftLowerLeg: 'Espinilla izq.', leftFoot: 'Pie izq.', leftToes: 'Dedos pie izq.',
  rightUpperLeg: 'Muslo der.', rightLowerLeg: 'Espinilla der.', rightFoot: 'Pie der.', rightToes: 'Dedos pie der.'
};

/** Datos capturados de la pose de reposo de un hueso. */
export interface DatosReposoHueso {
  Rotacion: THREE.Quaternion;
  Posicion: THREE.Vector3;
}

export class GestorModelos {
  public Vrm: VRM | null = null;
  public NombreModelo = '';
  public PoseReposo = new Map<string, DatosReposoHueso>();
  private Ayudante: THREE.SkeletonHelper | null = null;

  public Colliders: THREE.Mesh[] = [];

  constructor(private Escena: THREE.Scene) {}

  /** Carga un modelo VRM desde un archivo local y lo deja en pose de reposo. */
  public async CargarVrm(Archivo: File): Promise<void> {
    const Bufer = await Archivo.arrayBuffer();
    const Cargador = new GLTFLoader();
    Cargador.register((Analizador) => new VRMLoaderPlugin(Analizador));
    const Gltf = await Cargador.parseAsync(Bufer, '');
    const Vrm = Gltf.userData.vrm as VRM;
    if (!Vrm) throw new Error('El archivo no contiene un modelo VRM válido.');

    this.DescartarVrm();

    // Optimización: combinar mallas y quitar vértices innecesarios
    VRMUtils.removeUnnecessaryVertices(Gltf.scene);
    VRMUtils.combineSkeletons(Gltf.scene);
    VRMUtils.combineMorphs(Vrm);

    Gltf.scene.traverse((Nodo) => {
      Nodo.frustumCulled = false; // Evita parpadeos al animar fuera de cuadro
      const Malla = Nodo as THREE.Mesh;
      if (Malla.isMesh) Malla.castShadow = true;
    });

    this.Vrm = Vrm;
    this.NombreModelo = Archivo.name;
    this.Escena.add(Vrm.scene);
    this.GuardarPoseReposo();
    this.ActualizarColliders();
  }

  private ActualizarColliders(): void {
    // Eliminar colliders anteriores
    this.Colliders.forEach(C => C.parent?.remove(C));
    this.Colliders = [];

    if (!this.Vrm) return;

    // Crear geometría genérica para los colliders (esfera pequeña)
    // El material es invisible (opacity 0) pero sigue siendo clickeable por el raycaster
    const Geometria = new THREE.SphereGeometry(0.08, 8, 8);
    const Material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false });

    for (const Nombre of this.ObtenerHuesosDisponibles()) {
      const Nodo = this.ObtenerNodoHueso(Nombre);
      if (Nodo) {
        const Collider = new THREE.Mesh(Geometria, Material);
        Collider.name = `Collider_${Nombre}`;
        Collider.userData = { isBoneCollider: true, boneName: Nombre };
        Nodo.add(Collider);
        this.Colliders.push(Collider);
      }
    }
  }

  /** Carga un modelo VRM desde una URL (modelo de ejemplo). */
  public async CargarVrmDesdeUrl(Url: string): Promise<void> {
    const Respuesta = await fetch(Url);
    if (!Respuesta.ok) throw new Error('No se pudo descargar el modelo de ejemplo.');
    const Datos = await Respuesta.blob();
    const Archivo = new File([Datos], 'ModeloEjemplo.vrm');
    await this.CargarVrm(Archivo);
  }

  /** Carga una animación VRMA y devuelve el clip listo para hornear a claves. */
  public async CargarAnimacionVrma(Archivo: File): Promise<THREE.AnimationClip> {
    if (!this.Vrm) throw new Error('Carga primero un modelo VRM.');
    const Bufer = await Archivo.arrayBuffer();
    const Cargador = new GLTFLoader();
    Cargador.register((Analizador) => new VRMAnimationLoaderPlugin(Analizador));
    const Gltf = await Cargador.parseAsync(Bufer, '');
    const Animaciones = Gltf.userData.vrmAnimations as VRMAnimation[];
    if (!Animaciones || Animaciones.length === 0) {
      throw new Error('El archivo .vrma no contiene animaciones.');
    }
    return createVRMAnimationClip(Animaciones[0], this.Vrm);
  }

  /** Carga un modelo GLB/GLTF/VRM para usarlo como fondo o utilería. */
  public async CargarModeloFondo(Archivo: File): Promise<THREE.Object3D> {
    const Bufer = await Archivo.arrayBuffer();
    const Cargador = new GLTFLoader();
    Cargador.register((Analizador) => new VRMLoaderPlugin(Analizador));
    const Gltf = await Cargador.parseAsync(Bufer, '');
    // Los VRM de fondo se agregan como objeto estático (sin sistema de animación)
    return Gltf.scene;
  }

  /** Elimina el modelo VRM actual de la escena. */
  public DescartarVrm(): void {
    if (this.Vrm) {
      this.Escena.remove(this.Vrm.scene);
      VRMUtils.deepDispose(this.Vrm.scene);
      this.Vrm = null;
    }
    this.QuitarAyudante();
    this.PoseReposo.clear();
    this.Colliders.forEach(C => C.parent?.remove(C));
    this.Colliders = [];
  }

  /** Captura la pose actual como pose de reposo de referencia. */
  public GuardarPoseReposo(): void {
    this.PoseReposo.clear();
    if (!this.Vrm) return;
    for (const Nombre of NOMBRES_HUESOS) {
      const Nodo = this.ObtenerNodoHueso(Nombre);
      if (Nodo) {
        this.PoseReposo.set(Nombre, {
          Rotacion: Nodo.quaternion.clone(),
          Posicion: Nodo.position.clone()
        });
      }
    }
  }

  /** Restaura todos los huesos a la pose de reposo capturada. */
  public RestablecerPose(): void {
    for (const [Nombre, Datos] of this.PoseReposo) {
      const Nodo = this.ObtenerNodoHueso(Nombre);
      if (Nodo) {
        Nodo.quaternion.copy(Datos.Rotacion);
        Nodo.position.copy(Datos.Posicion);
      }
    }
  }

  /** Devuelve el nodo 3D de un hueso humanoide (normalizado o crudo). */
  public ObtenerNodoHueso(Nombre: string): THREE.Object3D | null {
    if (!this.Vrm) return null;
    const Humanoide = this.Vrm.humanoid as any;
    const Nodo = Humanoide.getNormalizedBoneNode?.(Nombre) ?? Humanoide.getRawBoneNode?.(Nombre);
    return Nodo ?? null;
  }

  /** Lista los nombres de huesos humanoides disponibles en el modelo. */
  public ObtenerHuesosDisponibles(): string[] {
    return NOMBRES_HUESOS.filter((N) => this.ObtenerNodoHueso(N) !== null);
  }

  /** Aplica una rotación (Euler XYZ en radianes) a un hueso. */
  public EstablecerRotacionHueso(Nombre: string, Euler: THREE.Euler): void {
    const Nodo = this.ObtenerNodoHueso(Nombre);
    if (Nodo) Nodo.quaternion.setFromEuler(Euler);
  }

  /** Lee la rotación actual de un hueso como Euler XYZ. */
  public ObtenerRotacionHueso(Nombre: string): THREE.Euler {
    const Nodo = this.ObtenerNodoHueso(Nombre);
    return Nodo ? new THREE.Euler().setFromQuaternion(Nodo.quaternion, 'XYZ') : new THREE.Euler();
  }

  /** Aplica una posición local a un hueso (pensado para la cadera). */
  public EstablecerPosicionHueso(Nombre: string, Posicion: THREE.Vector3): void {
    const Nodo = this.ObtenerNodoHueso(Nombre);
    if (Nodo) Nodo.position.copy(Posicion);
  }

  /** Lee la posición local actual de un hueso. */
  public ObtenerPosicionHueso(Nombre: string): THREE.Vector3 {
    const Nodo = this.ObtenerNodoHueso(Nombre);
    return Nodo ? Nodo.position.clone() : new THREE.Vector3();
  }

  /** Lista las expresiones faciales disponibles en el modelo. */
  public ObtenerExpresiones(): string[] {
    if (!this.Vrm?.expressionManager) return [];
    return this.Vrm.expressionManager.expressions.map((E: any) => E.expressionName as string);
  }

  /** Fija el peso (0..1) de una expresión facial. */
  public EstablecerExpresion(Nombre: string, Peso: number): void {
    const Gestor = this.Vrm?.expressionManager;
    if (Gestor && Gestor.getExpression(Nombre)) Gestor.setValue(Nombre, Peso);
  }

  /** Lee el peso actual de una expresión facial. */
  public ObtenerValorExpresion(Nombre: string): number {
    const Gestor = this.Vrm?.expressionManager;
    if (!Gestor || !Gestor.getExpression(Nombre)) return 0;
    return Gestor.getValue(Nombre) ?? 0;
  }

  /** Pone todas las expresiones en cero. */
  public LimpiarExpresiones(): void {
    for (const Nombre of this.ObtenerExpresiones()) this.EstablecerExpresion(Nombre, 0);
  }

  /** Muestra u oculta el esqueleto auxiliar para posar el modelo. */
  public AlternarAyudante(Visible: boolean): void {
    if (!this.Vrm) return;
    if (Visible && !this.Ayudante) {
      this.Ayudante = new THREE.SkeletonHelper(this.Vrm.scene);
      this.Escena.add(this.Ayudante);
    } else if (!Visible) {
      this.QuitarAyudante();
    }
  }

  private QuitarAyudante(): void {
    if (this.Ayudante) {
      this.Escena.remove(this.Ayudante);
      this.Ayudante = null;
    }
  }

  /** Actualización por cuadro: física de huesos elásticos y expresiones. */
  public Actualizar(Delta: number): void {
    this.Vrm?.update(Delta);
  }
}

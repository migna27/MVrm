// ============================================================================
// GestorModelos.ts — Etapa 1 y 4: Carga Multi-VRM, pose, huesos y expresiones
// Administra múltiples modelos VRM simultáneos en escena, su personaje activo,
// su pose de reposo, huesos principales/dedos/ojos y expresiones faciales.
// ============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, VRMAnimation, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { GenerarId } from '../Utilidades';

/** Lista de huesos humanoides VRM principales que se exponen en el inspector. */
export const NOMBRES_HUESOS = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'
] as const;

export const NOMBRES_HUESOS_OJOS = ['leftEye', 'rightEye'] as const;

export const NOMBRES_HUESOS_DEDOS = [
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
] as const;

/** Todos los huesos humanoides (principales + ojos + dedos) soportados por VMD/VRMA. */
export const NOMBRES_HUESOS_EXTENDIDOS = [
  ...NOMBRES_HUESOS,
  ...NOMBRES_HUESOS_OJOS,
  ...NOMBRES_HUESOS_DEDOS
] as const;

/** Nombres legibles en español para la interfaz. */
export const NOMBRES_HUESOS_LEGIBLES: Record<string, string> = {
  hips: 'Cadera', spine: 'Columna', chest: 'Pecho', upperChest: 'Pecho superior',
  neck: 'Cuello', head: 'Cabeza', leftEye: 'Ojo izq.', rightEye: 'Ojo der.',
  leftShoulder: 'Hombro izq.', leftUpperArm: 'Brazo izq.', leftLowerArm: 'Antebrazo izq.', leftHand: 'Mano izq.',
  rightShoulder: 'Hombro der.', rightUpperArm: 'Brazo der.', rightLowerArm: 'Antebrazo der.', rightHand: 'Mano der.',
  leftUpperLeg: 'Muslo izq.', leftLowerLeg: 'Espinilla izq.', leftFoot: 'Pie izq.', leftToes: 'Dedos pie izq.',
  rightUpperLeg: 'Muslo der.', rightLowerLeg: 'Espinilla der.', rightFoot: 'Pie der.', rightToes: 'Dedos pie der.',
  leftThumbMetacarpal: 'Pulgar izq. 1', leftThumbProximal: 'Pulgar izq. 2', leftThumbDistal: 'Pulgar izq. 3',
  leftIndexProximal: 'Índice izq. 1', leftIndexIntermediate: 'Índice izq. 2', leftIndexDistal: 'Índice izq. 3',
  leftMiddleProximal: 'Medio izq. 1', leftMiddleIntermediate: 'Medio izq. 2', leftMiddleDistal: 'Medio izq. 3',
  leftRingProximal: 'Anular izq. 1', leftRingIntermediate: 'Anular izq. 2', leftRingDistal: 'Anular izq. 3',
  leftLittleProximal: 'Meñique izq. 1', leftLittleIntermediate: 'Meñique izq. 2', leftLittleDistal: 'Meñique izq. 3',
  rightThumbMetacarpal: 'Pulgar der. 1', rightThumbProximal: 'Pulgar der. 2', rightThumbDistal: 'Pulgar der. 3',
  rightIndexProximal: 'Índice der. 1', rightIndexIntermediate: 'Índice der. 2', rightIndexDistal: 'Índice der. 3',
  rightMiddleProximal: 'Medio der. 1', rightMiddleIntermediate: 'Medio der. 2', rightMiddleDistal: 'Medio der. 3',
  rightRingProximal: 'Anular der. 1', rightRingIntermediate: 'Anular der. 2', rightRingDistal: 'Anular der. 3',
  rightLittleProximal: 'Meñique der. 1', rightLittleIntermediate: 'Meñique der. 2', rightLittleDistal: 'Meñique der. 3'
};

/** Datos capturados de la pose de reposo de un hueso. */
export interface DatosReposoHueso {
  Rotacion: THREE.Quaternion;
  Posicion: THREE.Vector3;
}

/** Representación individual de cada personaje VRM en la escena. */
export interface PersonajeVrm {
  Id: string;
  Nombre: string;
  Vrm: VRM;
  PoseReposo: Map<string, DatosReposoHueso>;
  Colliders: THREE.Mesh[];
  Ayudante: THREE.SkeletonHelper | null;
}

/** Equivalencias bidireccionales entre nombres de expresiones VRM 0.x / VSeeFace / VRM 1.0. */
const ALIAS_EXPRESIONES_VRM: Record<string, string[]> = {
  a: ['aa'],
  aa: ['a'],
  i: ['ih'],
  ih: ['i'],
  u: ['ou'],
  ou: ['u'],
  e: ['ee'],
  ee: ['e'],
  o: ['oh'],
  oh: ['o'],
  blink: ['blink'],
  blink_l: ['blinkleft'],
  blinkleft: ['blink_l'],
  blink_r: ['blinkright'],
  blinkright: ['blink_r'],
  joy: ['happy'],
  happy: ['joy'],
  sorrow: ['sad'],
  sad: ['sorrow'],
  fun: ['relaxed'],
  relaxed: ['fun'],
  angry: ['angry'],
  surprised: ['surprised'],
  neutral: ['neutral']
};

export class GestorModelos {
  public Personajes: PersonajeVrm[] = [];
  public PersonajeActivoId: string | null = null;
  private IdsEliminados = new Set<string>();

  private ColliderGeo: THREE.BufferGeometry | null = null;
  private ColliderMat: THREE.Material | null = null;

  constructor(private Escena: THREE.Scene) {}

  /** Personaje actualmente seleccionado (o el primero disponible). */
  public ObtenerPersonaje(PersonajeId?: string | null): PersonajeVrm | null {
    if (this.Personajes.length === 0) return null;
    if (PersonajeId) {
      if (this.IdsEliminados.has(PersonajeId)) return null;
      const Exacto = this.Personajes.find((P) => P.Id === PersonajeId);
      if (Exacto) return Exacto;
    }
    if (this.PersonajeActivoId) {
      const Activo = this.Personajes.find((P) => P.Id === this.PersonajeActivoId);
      if (Activo) return Activo;
    }
    return this.Personajes[0];
  }

  /** Compatibilidad directa: VRM del personaje activo. */
  public get Vrm(): VRM | null {
    return this.ObtenerPersonaje()?.Vrm ?? null;
  }

  /** Compatibilidad directa: nombre del personaje activo. */
  public get NombreModelo(): string {
    return this.ObtenerPersonaje()?.Nombre ?? '';
  }

  /** Compatibilidad directa: mapa de reposo del personaje activo. */
  public get PoseReposo(): Map<string, DatosReposoHueso> {
    return this.ObtenerPersonaje()?.PoseReposo ?? new Map<string, DatosReposoHueso>();
  }

  /** Devuelve todos los colliders clicables de todos los personajes cargados. */
  public get Colliders(): THREE.Mesh[] {
    if (this.Personajes.length === 1) return this.Personajes[0].Colliders;
    const Todos: THREE.Mesh[] = [];
    for (const P of this.Personajes) Todos.push(...P.Colliders);
    return Todos;
  }

  /** Selecciona el personaje activo por Id. */
  public SeleccionarPersonaje(Id: string): boolean {
    const Existe = this.Personajes.find((P) => P.Id === Id);
    if (!Existe) return false;
    this.PersonajeActivoId = Existe.Id;
    return true;
  }

  /** Carga un modelo VRM; por defecto reemplaza el personaje activo o añade si AgregarComoNuevo=true. */
  public async CargarVrm(
    Archivo: File,
    Opciones?: { AgregarComoNuevo?: boolean }
  ): Promise<PersonajeVrm> {
    const Bufer = await Archivo.arrayBuffer();
    const Cargador = new GLTFLoader();
    Cargador.register((Analizador) => new VRMLoaderPlugin(Analizador));
    const Gltf = await Cargador.parseAsync(Bufer, '');
    const Vrm = Gltf.userData.vrm as VRM;
    if (!Vrm) throw new Error('El archivo no contiene un modelo VRM válido.');

    VRMUtils.removeUnnecessaryVertices(Gltf.scene);
    VRMUtils.combineSkeletons(Gltf.scene);
    VRMUtils.combineMorphs(Vrm);

    Gltf.scene.traverse((Nodo) => {
      Nodo.frustumCulled = false;
      const Malla = Nodo as THREE.Mesh;
      if (Malla.isMesh) Malla.castShadow = true;
    });

    const AgregarNuevo = Boolean(Opciones?.AgregarComoNuevo) || this.Personajes.length === 0;
    let PosicionPrevia: THREE.Vector3 | null = null;
    let RotacionYPrevia = 0;

    if (!AgregarNuevo) {
      const Activo = this.ObtenerPersonaje();
      if (Activo) {
        PosicionPrevia = Activo.Vrm.scene.position.clone();
        RotacionYPrevia = Activo.Vrm.scene.rotation.y;
        this.RemoverInstanciaPersonaje(Activo);
      }
    }

    const Nuevo: PersonajeVrm = {
      Id: GenerarId(),
      Nombre: Archivo.name,
      Vrm,
      PoseReposo: new Map<string, DatosReposoHueso>(),
      Colliders: [],
      Ayudante: null
    };

    if (PosicionPrevia) {
      Vrm.scene.position.copy(PosicionPrevia);
      Vrm.scene.rotation.y = RotacionYPrevia;
    } else if (this.Personajes.length > 0) {
      // Separar automáticamente nuevos personajes sin superponerse en el origen
      const Indice = this.Personajes.length;
      const Paso = Math.ceil(Indice / 2) * 1.25;
      const Signo = Indice % 2 === 1 ? 1 : -1;
      Vrm.scene.position.set(Paso * Signo, 0, 0);
    }

    this.Personajes.push(Nuevo);
    this.PersonajeActivoId = Nuevo.Id;
    this.Escena.add(Vrm.scene);
    this.GuardarPoseReposo(Nuevo.Id);
    this.ActualizarCollidersPersonaje(Nuevo);
    return Nuevo;
  }

  private EnsureColliderAssets(): void {
    if (!this.ColliderGeo) {
      this.ColliderGeo = new THREE.SphereGeometry(0.08, 8, 8);
    }
    if (!this.ColliderMat) {
      this.ColliderMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false });
    }
  }

  private LimpiarCollidersPersonaje(P: PersonajeVrm): void {
    P.Colliders.forEach((C) => C.parent?.remove(C));
    P.Colliders = [];
  }

  private LimpiarRecursosColliderGlobalesSiVacio(): void {
    if (this.Personajes.length === 0) {
      this.ColliderGeo?.dispose();
      this.ColliderMat?.dispose();
      this.ColliderGeo = null;
      this.ColliderMat = null;
    }
  }

  private ActualizarCollidersPersonaje(P: PersonajeVrm): void {
    this.LimpiarCollidersPersonaje(P);
    this.EnsureColliderAssets();

    for (const Nombre of this.ObtenerHuesosDisponibles(P.Id)) {
      const Nodo = this.ObtenerNodoHueso(Nombre, P.Id);
      if (Nodo) {
        const Collider = new THREE.Mesh(this.ColliderGeo!, this.ColliderMat!);
        Collider.name = `Collider_${P.Id}_${Nombre}`;
        Collider.userData = { isBoneCollider: true, boneName: Nombre, characterId: P.Id };
        Nodo.add(Collider);
        P.Colliders.push(Collider);
      }
    }
  }

  /** Carga un modelo VRM desde una URL (modelo de ejemplo). */
  public async CargarVrmDesdeUrl(Url: string, AgregarComoNuevo = false): Promise<PersonajeVrm> {
    const Respuesta = await fetch(Url);
    if (!Respuesta.ok) throw new Error('No se pudo descargar el modelo de ejemplo.');
    const Datos = await Respuesta.blob();
    const Sufijo = AgregarComoNuevo && this.Personajes.length > 0 ? `_${this.Personajes.length + 1}` : '';
    const Archivo = new File([Datos], `ModeloEjemplo${Sufijo}.vrm`);
    return this.CargarVrm(Archivo, { AgregarComoNuevo });
  }

  /** Carga una animación VRMA para el personaje indicado (o activo) y devuelve su clip. */
  public async CargarAnimacionVrma(Archivo: File, PersonajeId?: string | null): Promise<THREE.AnimationClip> {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P) throw new Error('Carga primero un modelo VRM.');
    const Bufer = await Archivo.arrayBuffer();
    const Cargador = new GLTFLoader();
    Cargador.register((Analizador) => new VRMAnimationLoaderPlugin(Analizador));
    const Gltf = await Cargador.parseAsync(Bufer, '');
    const Animaciones = Gltf.userData.vrmAnimations as VRMAnimation[];
    if (!Animaciones || Animaciones.length === 0) {
      throw new Error('El archivo .vrma no contiene animaciones.');
    }
    return createVRMAnimationClip(Animaciones[0], P.Vrm);
  }

  /** Carga un modelo GLB/GLTF/VRM para usarlo como fondo o prop. */
  public async CargarModeloFondo(Archivo: File): Promise<THREE.Object3D> {
    const Bufer = await Archivo.arrayBuffer();
    const Cargador = new GLTFLoader();
    Cargador.register((Analizador) => new VRMLoaderPlugin(Analizador));
    const Gltf = await Cargador.parseAsync(Bufer, '');
    return Gltf.scene;
  }

  private RemoverInstanciaPersonaje(P: PersonajeVrm): void {
    this.LimpiarCollidersPersonaje(P);
    this.QuitarAyudantePersonaje(P);
    this.Escena.remove(P.Vrm.scene);
    VRMUtils.deepDispose(P.Vrm.scene);
    P.PoseReposo.clear();
    this.Personajes = this.Personajes.filter((Item) => Item.Id !== P.Id);
    if (this.PersonajeActivoId === P.Id) {
      this.PersonajeActivoId = this.Personajes[0]?.Id ?? null;
    }
    this.LimpiarRecursosColliderGlobalesSiVacio();
  }

  /** Elimina un personaje concreto del reparto multi-VRM. */
  public EliminarPersonaje(Id: string): void {
    const P = this.Personajes.find((Item) => Item.Id === Id);
    if (P) {
      this.IdsEliminados.add(P.Id);
      this.RemoverInstanciaPersonaje(P);
    }
  }

  /** Elimina todos los modelos VRM de la escena. */
  public DescartarVrm(): void {
    for (const P of [...this.Personajes]) {
      this.RemoverInstanciaPersonaje(P);
    }
    this.Personajes = [];
    this.PersonajeActivoId = null;
    this.LimpiarRecursosColliderGlobalesSiVacio();
  }

  /** Captura la pose actual como pose de reposo de referencia. */
  public GuardarPoseReposo(PersonajeId?: string | null): void {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P) return;
    P.PoseReposo.clear();
    for (const Nombre of NOMBRES_HUESOS_EXTENDIDOS) {
      const Nodo = this.ObtenerNodoHueso(Nombre, P.Id);
      if (Nodo) {
        P.PoseReposo.set(Nombre, {
          Rotacion: Nodo.quaternion.clone(),
          Posicion: Nodo.position.clone()
        });
      }
    }
  }

  /** Restaura todos los huesos de un personaje (o de todos) a su pose de reposo. */
  public RestablecerPose(PersonajeId?: string | null): void {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P) return;
    for (const [Nombre, Datos] of P.PoseReposo) {
      const Nodo = this.ObtenerNodoHueso(Nombre, P.Id);
      if (Nodo) {
        Nodo.quaternion.copy(Datos.Rotacion);
        Nodo.position.copy(Datos.Posicion);
      }
    }
  }

  /** Devuelve el nodo 3D de un hueso humanoide del personaje indicado. */
  public ObtenerNodoHueso(Nombre: string, PersonajeId?: string | null): THREE.Object3D | null {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P) return null;
    const Humanoide = P.Vrm.humanoid as any;
    const Nodo = Humanoide.getNormalizedBoneNode?.(Nombre) ?? Humanoide.getRawBoneNode?.(Nombre);
    return Nodo ?? null;
  }

  /** Calcula la posición mundial actual de un hueso (para Auto-Focus, Follow y Focos Look-At). */
  public ObtenerPosicionMundoHueso(
    Nombre: string,
    PersonajeId?: string | null,
    Destino?: THREE.Vector3
  ): THREE.Vector3 | null {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P) return null;
    const Nodo = this.ObtenerNodoHueso(Nombre, P.Id) ?? P.Vrm.scene;
    P.Vrm.scene.updateMatrixWorld(true);
    const Out = Destino ?? new THREE.Vector3();
    return Nodo.getWorldPosition(Out);
  }

  /** Lista los nombres de huesos principales disponibles en el modelo (para UI). */
  public ObtenerHuesosDisponibles(PersonajeId?: string | null): string[] {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P) return [];
    return NOMBRES_HUESOS.filter((N) => this.ObtenerNodoHueso(N, P.Id) !== null);
  }

  /** Lista todos los huesos disponibles incluyendo ojos y dedos (para VMD/VRMA/Pose). */
  public ObtenerTodosHuesosDisponibles(PersonajeId?: string | null): string[] {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P) return [];
    return NOMBRES_HUESOS_EXTENDIDOS.filter((N) => this.ObtenerNodoHueso(N, P.Id) !== null);
  }

  /** Aplica una rotación (Euler XYZ en radianes) a un hueso. */
  public EstablecerRotacionHueso(Nombre: string, Euler: THREE.Euler, PersonajeId?: string | null): void {
    const Nodo = this.ObtenerNodoHueso(Nombre, PersonajeId);
    if (Nodo) Nodo.quaternion.setFromEuler(Euler);
  }

  /** Lee la rotación actual de un hueso como Euler XYZ. */
  public ObtenerRotacionHueso(Nombre: string, PersonajeId?: string | null): THREE.Euler {
    const Nodo = this.ObtenerNodoHueso(Nombre, PersonajeId);
    return Nodo ? new THREE.Euler().setFromQuaternion(Nodo.quaternion, 'XYZ') : new THREE.Euler();
  }

  /** Aplica una posición local a un hueso (absoluta). */
  public EstablecerPosicionHueso(Nombre: string, Posicion: THREE.Vector3, PersonajeId?: string | null): void {
    const Nodo = this.ObtenerNodoHueso(Nombre, PersonajeId);
    if (Nodo) Nodo.position.copy(Posicion);
  }

  /** Lee la posición local absoluta de un hueso. */
  public ObtenerPosicionHueso(Nombre: string, PersonajeId?: string | null): THREE.Vector3 {
    const Nodo = this.ObtenerNodoHueso(Nombre, PersonajeId);
    return Nodo ? Nodo.position.clone() : new THREE.Vector3();
  }

  /** Lista las expresiones faciales disponibles en el modelo. */
  public ObtenerExpresiones(PersonajeId?: string | null): string[] {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P?.Vrm.expressionManager) return [];
    return P.Vrm.expressionManager.expressions.map((E: any) => E.expressionName as string);
  }

  /** Resuelve nombres VRM 0.x / VSeeFace / VRM 1.0 al nombre real del modelo. */
  public ResolverNombreExpresion(Nombre: string, PersonajeId?: string | null): string | null {
    const P = this.ObtenerPersonaje(PersonajeId);
    const Gestor = P?.Vrm.expressionManager;
    if (!P || !Gestor) return null;
    if (Gestor.getExpression(Nombre)) return Nombre;

    const Disponibles = this.ObtenerExpresiones(P.Id);
    const Minuscula = Nombre.toLowerCase();
    const Directa = Disponibles.find((E) => E.toLowerCase() === Minuscula);
    if (Directa) return Directa;

    const Candidatos = ALIAS_EXPRESIONES_VRM[Minuscula] ?? [];
    for (const Alias of Candidatos) {
      const Coincidencia = Disponibles.find((E) => E.toLowerCase() === Alias);
      if (Coincidencia) return Coincidencia;
    }
    return null;
  }

  /** Fija el peso (0..1) de una expresión facial. */
  public EstablecerExpresion(Nombre: string, Peso: number, PersonajeId?: string | null): void {
    const P = this.ObtenerPersonaje(PersonajeId);
    const Gestor = P?.Vrm.expressionManager;
    if (!P || !Gestor) return;
    const Resuelto = this.ResolverNombreExpresion(Nombre, P.Id);
    if (Resuelto) Gestor.setValue(Resuelto, Peso);
  }

  /** Lee el peso actual de una expresión facial. */
  public ObtenerValorExpresion(Nombre: string, PersonajeId?: string | null): number {
    const P = this.ObtenerPersonaje(PersonajeId);
    const Gestor = P?.Vrm.expressionManager;
    if (!P || !Gestor) return 0;
    const Resuelto = this.ResolverNombreExpresion(Nombre, P.Id);
    if (!Resuelto) return 0;
    return Gestor.getValue(Resuelto) ?? 0;
  }

  /** Pone todas las expresiones en cero. */
  public LimpiarExpresiones(PersonajeId?: string | null): void {
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P) return;
    for (const Nombre of this.ObtenerExpresiones(P.Id)) {
      this.EstablecerExpresion(Nombre, 0, P.Id);
    }
  }

  /** Muestra u oculta el esqueleto auxiliar del personaje activo (o de todos si false). */
  public AlternarAyudante(Visible: boolean, PersonajeId?: string | null): void {
    if (!Visible) {
      for (const P of this.Personajes) this.QuitarAyudantePersonaje(P);
      return;
    }
    const P = this.ObtenerPersonaje(PersonajeId);
    if (!P || P.Ayudante) return;
    P.Ayudante = new THREE.SkeletonHelper(P.Vrm.scene);
    this.Escena.add(P.Ayudante);
  }

  private QuitarAyudantePersonaje(P: PersonajeVrm): void {
    if (P.Ayudante) {
      P.Ayudante.dispose();
      this.Escena.remove(P.Ayudante);
      P.Ayudante = null;
    }
  }

  /** Actualización por cuadro para todos los modelos VRM cargados (física y expresiones). */
  public Actualizar(Delta: number): void {
    for (const P of this.Personajes) {
      P.Vrm.update(Delta);
    }
  }
}

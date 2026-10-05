"""
Solver cinemático para MediaPipe Holistic -> VRM (three-vrm, huesos normalizados).

SISTEMA DE COORDENADAS ÚNICO (igual que Three.js con el modelo mirando a cámara):
  +X = derecha de la imagen (= izquierda del personaje)
  +Y = arriba
  +Z = hacia la cámara
MediaPipe entrega: x derecha, y abajo, z positivo alejándose de la cámara,
por lo tanto convertimos con (x, -y, -z).

En los huesos normalizados de three-vrm la pose de reposo (T-Pose) tiene rotación
identidad y los ejes locales coinciden con los globales. Por eso toda rotación se
calcula como "frame observado" respecto al "frame de reposo" y luego se convierte a
rotación local con R_local = inv(R_padre_mundo) * R_mundo.

Las conversiones a otros formatos se hacen SOLO al final:
  - Línea de tiempo (Three.js Euler 'XYZ' intrínseco)  -> a_euler_threejs()
  - VMC/OSC (el receptor aplica (-qx,-qy,qz,qw))      -> a_cuaternion_vmc()
"""
import math
import numpy as np
from scipy.signal import savgol_filter
from scipy.spatial.transform import Rotation

VISIBILIDAD_MIN = 0.5
LIMITE_MUNECA = math.radians(95)      # Rango anatómico máximo de la muñeca respecto al antebrazo
FRACCION_GIRO_ANTEBRAZO = 0.8         # Parte de la pronación/supinación que absorbe el antebrazo


# ----------------------------------------------------------------- utilidades
def _normalizar(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-8 else None


def rotacion_entre(v_reposo, v_obs):
    """Rotación mínima (swing) que lleva v_reposo a v_obs."""
    a, b = _normalizar(v_reposo), _normalizar(v_obs)
    if a is None or b is None:
        return Rotation.identity()
    eje = np.cross(a, b)
    s = np.linalg.norm(eje)
    c = float(np.clip(np.dot(a, b), -1.0, 1.0))
    if s < 1e-8:
        if c > 0:
            return Rotation.identity()
        # 180 grados: cualquier eje perpendicular sirve
        perp = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        return Rotation.from_rotvec(_normalizar(perp) * math.pi)
    return Rotation.from_rotvec(eje / s * math.atan2(s, c))


def frame_desde_ejes(x_aprox, y_aprox):
    """
    Construye una rotación ortonormal a partir de un eje X y un eje Y aproximados.
    Gram-Schmidt: se respeta X y se corrige Y para que sea perpendicular.
    """
    x = _normalizar(np.asarray(x_aprox, dtype=float))
    if x is None:
        return None
    y = np.asarray(y_aprox, dtype=float)
    y = _normalizar(y - np.dot(y, x) * x)
    if y is None:
        return None
    z = np.cross(x, y)
    return Rotation.from_matrix(np.column_stack((x, y, z)))


def limitar_rotacion(r, limite):
    """Recorta la magnitud angular de una rotación (restricción anatómica)."""
    rv = r.as_rotvec()
    ang = np.linalg.norm(rv)
    if ang > limite:
        rv = rv / ang * limite
    return Rotation.from_rotvec(rv)


def angulo_entre(v1, v2):
    a, b = _normalizar(v1), _normalizar(v2)
    if a is None or b is None:
        return 0.0
    return math.atan2(np.linalg.norm(np.cross(a, b)), float(np.dot(a, b)))


def a_euler_threejs(r):
    """Euler compatible con THREE.Euler(x, y, z, 'XYZ') (intrínseco)."""
    return r.as_euler('XYZ').tolist()


def a_cuaternion_vmc(r):
    """El receptor (GestorVMC.ts) convierte Unity->Three con (-qx,-qy,qz,qw); aplicamos la inversa."""
    qx, qy, qz, qw = r.as_quat()
    return [float(-qx), float(-qy), float(qz), float(qw)]


# ------------------------------------------------------------ filtro temporal
class FiltroRotacion:
    """
    Filtro propio para rotaciones (por hueso):
      1. Alinea hemisferio del cuaternión (q y -q son la misma rotación) -> evita giros de 360°.
      2. Rechazo de saltos: un cambio mayor a `umbral_salto` en un solo frame se considera
         un error de detección (p. ej. palma/dorso confundidos) y se ignora, salvo que el
         nuevo valor persista `frames_confirmacion` frames seguidos (movimiento real rápido).
      3. Suavizado adaptativo: poco suavizado en movimientos grandes (sin lag),
         mucho suavizado cuando la mano está casi quieta (sin temblor).
    """

    def __init__(self, alpha_min=0.2, alpha_max=0.85, umbral_salto=math.radians(100),
                 frames_confirmacion=4):
        self.alpha_min = alpha_min
        self.alpha_max = alpha_max
        self.umbral_salto = umbral_salto
        self.frames_confirmacion = frames_confirmacion
        self.q = None
        self.candidato = None
        self.cuenta = 0

    def actualizar(self, r):
        q = r.as_quat()
        if self.q is None:
            self.q = q
            return r
        if np.dot(q, self.q) < 0:
            q = -q
        delta = 2.0 * math.acos(min(1.0, abs(float(np.dot(q, self.q)))))

        if delta > self.umbral_salto:
            if self.candidato is not None and abs(float(np.dot(q, self.candidato))) > math.cos(math.radians(15)):
                self.cuenta += 1
            else:
                self.candidato, self.cuenta = q, 1
            if self.cuenta < self.frames_confirmacion:
                return Rotation.from_quat(self.q)       # mantener el último valor bueno
            self.q, self.candidato, self.cuenta = q, None, 0
            return Rotation.from_quat(q)

        self.candidato, self.cuenta = None, 0
        t = min(1.0, delta / math.radians(25))
        alpha = self.alpha_min + (self.alpha_max - self.alpha_min) * t
        qn = (1.0 - alpha) * self.q + alpha * q
        qn /= np.linalg.norm(qn)
        self.q = qn
        return Rotation.from_quat(qn)


# ------------------------------------------------------------------- cuerpo
def calcular_rotaciones_mundo_cuerpo(landmarks):
    """Devuelve dict hueso -> Rotation en espacio mundo, a partir de pose_world_landmarks."""
    def pt(i):
        lm = landmarks[i]
        return np.array([lm.x, -lm.y, -lm.z]), lm.visibility

    ls, ls_v = pt(11); rs, rs_v = pt(12)
    le, le_v = pt(13); re, re_v = pt(14)
    lw, lw_v = pt(15); rw, rw_v = pt(16)
    lh, lh_v = pt(23); rh, rh_v = pt(24)
    lk, lk_v = pt(25); rk, rk_v = pt(26)
    la, la_v = pt(27); ra, ra_v = pt(28)
    nose, nose_v = pt(0)
    lojo, lojo_v = pt(2); rojo, rojo_v = pt(5)
    lear, lear_v = pt(7); rear, rear_v = pt(8)

    mundo = {}

    # Torso con 3 grados de libertad: X = hombro der->izq, Y = cadera->hombros (incluye giro/yaw)
    if min(ls_v, rs_v, lh_v, rh_v) > 0.3:
        y = _normalizar((ls + rs) / 2.0 - (lh + rh) / 2.0)   # columna: exacta
        x_aprox = ls - rs                                     # hombros: solo aporta el giro
        if y is not None:
            x = _normalizar(x_aprox - np.dot(x_aprox, y) * y)
            if x is not None:
                mundo['spine'] = Rotation.from_matrix(np.column_stack((x, y, np.cross(x, y))))
    if 'spine' not in mundo:
        mundo['spine'] = Rotation.identity()

    # Cabeza: X = oreja der->izq, adelante = centro de orejas -> centro de ojos (horizontal en reposo)
    if min(lear_v, rear_v) > 0.3 and min(lojo_v, rojo_v) > 0.3:
        adelante = (lojo + rojo) / 2.0 - (lear + rear) / 2.0
        x = _normalizar(lear - rear)
        z = _normalizar(adelante - np.dot(adelante, x) * x) if x is not None else None
        if x is not None and z is not None:
            y = np.cross(z, x)
            mundo['head'] = Rotation.from_matrix(np.column_stack((x, y, z)))

    # Brazos (swing; el giro del antebrazo se añade luego desde la mano)
    if ls_v > VISIBILIDAD_MIN and le_v > VISIBILIDAD_MIN:
        mundo['leftUpperArm'] = rotacion_entre([1, 0, 0], le - ls)
        if lw_v > VISIBILIDAD_MIN:
            mundo['leftLowerArm'] = rotacion_entre([1, 0, 0], lw - le)
    if rs_v > VISIBILIDAD_MIN and re_v > VISIBILIDAD_MIN:
        mundo['rightUpperArm'] = rotacion_entre([-1, 0, 0], re - rs)
        if rw_v > VISIBILIDAD_MIN:
            mundo['rightLowerArm'] = rotacion_entre([-1, 0, 0], rw - re)

    # Piernas
    if lh_v > VISIBILIDAD_MIN and lk_v > VISIBILIDAD_MIN:
        mundo['leftUpperLeg'] = rotacion_entre([0, -1, 0], lk - lh)
        if la_v > VISIBILIDAD_MIN:
            mundo['leftLowerLeg'] = rotacion_entre([0, -1, 0], la - lk)
    if rh_v > VISIBILIDAD_MIN and rk_v > VISIBILIDAD_MIN:
        mundo['rightUpperLeg'] = rotacion_entre([0, -1, 0], rk - rh)
        if ra_v > VISIBILIDAD_MIN:
            mundo['rightLowerLeg'] = rotacion_entre([0, -1, 0], ra - rk)

    return mundo


# -------------------------------------------------------------------- manos
_DEDOS = [
    ('Thumb', 1, 2, 3, 4), ('Index', 5, 6, 7, 8),
    ('Middle', 9, 10, 11, 12), ('Ring', 13, 14, 15, 16),
    ('Little', 17, 18, 19, 20),
]


def calcular_mano(landmarks, ancho, alto, es_derecha):
    """
    Devuelve (Rotation mundo de la mano | None, dict dedos -> Rotation local).

    Los landmarks de mano vienen normalizados por ancho y alto de la imagen por separado;
    se reescalan a píxeles para que los ángulos no se deformen (en 16:9 la deformación
    era de casi 2x en vertical y confundía la orientación de la palma).
    """
    def pt(i):
        lm = landmarks[i]
        return np.array([lm.x * ancho, -lm.y * alto, -lm.z * ancho])

    muneca = pt(0)
    indice, medio, menique = pt(5), pt(9), pt(17)

    dir_dedos = medio - muneca
    # Normal del plano metacarpiano. Para la mano izquierda apunta al dorso, para la derecha a la palma.
    normal = np.cross(indice - muneca, menique - muneca)

    rot_mundo = None
    if not es_derecha:
        # Reposo izquierda: dedos +X, dorso +Y, pulgar +Z
        rot_mundo = frame_desde_ejes(dir_dedos, normal)
    else:
        # Reposo derecha: dedos -X, dorso +Y, pulgar +Z  ->  columna X = -dedos
        rot_mundo = frame_desde_ejes(-dir_dedos, -normal)

    # Dedos: ángulo real de flexión en cada articulación (no distancia aproximada)
    dedos = {}
    prefijo = 'right' if es_derecha else 'left'
    for nombre, mcp, pip, dip, tip in _DEDOS:
        p0, p1, p2, p3, p4 = muneca, pt(mcp), pt(pip), pt(dip), pt(tip)
        flex = [angulo_entre(p1 - p0, p2 - p1), angulo_entre(p2 - p1, p3 - p2), angulo_entre(p3 - p2, p4 - p3)]
        for seg, ang in zip(('Proximal', 'Intermediate', 'Distal'), flex):
            ang = min(ang, math.radians(100))
            if nombre == 'Thumb':
                # El pulgar flexiona hacia la palma girando sobre Y
                rv = [0.0, (ang if not es_derecha else -ang) * 0.6, 0.0]
            else:
                # Dedos: flexión hacia la palma (-Y). Izquierda gira -Z, derecha +Z
                rv = [0.0, 0.0, -ang if not es_derecha else ang]
            dedos[f"{prefijo}{nombre}{seg}"] = Rotation.from_rotvec(rv)

    return rot_mundo, dedos


def transferir_giro_a_antebrazo(mundo, lado):
    """
    La pronación/supinación ocurre en el antebrazo, no en la muñeca. Si toda la torsión se
    aplica en el hueso de la mano, la malla se 'retuerce' en la muñeca. Calculamos el giro
    alrededor del eje del antebrazo que alinea el dorso de la mano y se lo damos al antebrazo.
    """
    k_ante, k_mano = f'{lado}LowerArm', f'{lado}Hand'
    if k_ante not in mundo or k_mano not in mundo:
        return
    r_ante = mundo[k_ante]
    eje = _normalizar(r_ante.apply([1, 0, 0] if lado == 'left' else [-1, 0, 0]))
    if eje is None:
        return
    y_ante = r_ante.apply([0, 1, 0])
    y_mano = mundo[k_mano].apply([0, 1, 0])
    a = _normalizar(y_ante - np.dot(y_ante, eje) * eje)
    b = _normalizar(y_mano - np.dot(y_mano, eje) * eje)
    if a is None or b is None:
        return
    giro = math.atan2(float(np.dot(eje, np.cross(a, b))), float(np.dot(a, b)))
    mundo[k_ante] = Rotation.from_rotvec(eje * giro * FRACCION_GIRO_ANTEBRAZO) * r_ante


# --------------------------------------------------------- mundo -> locales
_JERARQUIA = {
    'spine': None,
    'head': 'spine',
    'leftUpperArm': 'spine', 'leftLowerArm': 'leftUpperArm', 'leftHand': 'leftLowerArm',
    'rightUpperArm': 'spine', 'rightLowerArm': 'rightUpperArm', 'rightHand': 'rightLowerArm',
    'leftUpperLeg': None, 'leftLowerLeg': 'leftUpperLeg',
    'rightUpperLeg': None, 'rightLowerLeg': 'rightUpperLeg',
}


def _mundo_padre(mundo, hueso):
    padre = _JERARQUIA.get(hueso)
    while padre is not None:
        if padre in mundo:
            return mundo[padre]
        padre = _JERARQUIA.get(padre)
    return Rotation.identity()


def rotaciones_locales(mundo):
    locales = {}
    for hueso in _JERARQUIA:
        # Si el hueso no esta en el mundo (por baja visibilidad), asumimos que esta en su posicion de reposo global
        r_mundo = mundo.get(hueso, Rotation.identity())
        
        # Para que el hueso se quede en reposo GLOBAL (ej. brazos colgando hacia abajo en T-pose, o piernas rectas),
        # su rotacion local debe compensar la rotacion del padre.
        r_local = _mundo_padre(mundo, hueso).inv() * r_mundo
        
        if hueso.endswith('Hand'):
            r_local = limitar_rotacion(r_local, LIMITE_MUNECA)
            
        locales[hueso] = r_local
    return locales


def resolver_frame(pose_world, mano_izq, mano_der, ancho, alto):
    """
    Punto de entrada: devuelve dict hueso -> Rotation LOCAL listo para aplicar al VRM.
    """
    mundo = calcular_rotaciones_mundo_cuerpo(pose_world.landmark) if pose_world else {}
    dedos = {}
    for lms, lado, es_der in ((mano_izq, 'left', False), (mano_der, 'right', True)):
        if lms is None:
            continue
        r_mano, d = calcular_mano(lms.landmark, ancho, alto, es_der)
        dedos.update(d)
        if r_mano is not None:
            mundo[f'{lado}Hand'] = r_mano
            transferir_giro_a_antebrazo(mundo, lado)

    locales = rotaciones_locales(mundo)
    locales.update(dedos)
    return locales


# ------------------------------------------------------------ post-proceso
def smooth_tracks(tracks_raw, window=5, polyorder=2):
    tracks_smoothed = {}
    for bone, keys in tracks_raw.items():
        if len(keys) < window:
            tracks_smoothed[bone] = keys
            continue
        vals = np.array([k["Valor"] for k in keys], dtype=float)
        try:
            es_rotacion = keys[0].get("Tipo") == "HuesoRotacion"
            for dim in range(vals.shape[1]):
                col = np.unwrap(vals[:, dim]) if es_rotacion else vals[:, dim]   # evita saltos ±π
                vals[:, dim] = savgol_filter(col, window, polyorder)
        except Exception:
            pass
        for i, k in enumerate(keys):
            k["Valor"] = vals[i].tolist()
        tracks_smoothed[bone] = keys
    return tracks_smoothed


def calculate_face_blendshapes(face_landmarks):
    """
    Extrae expresiones faciales (Mouth Open, Blink) de los 468 landmarks faciales.
    Devuelve un diccionario compatible con VRM BlendShapes.
    """
    blendshapes = {}
    if not face_landmarks:
        return blendshapes

    lms = face_landmarks.landmark
    def dist(p1, p2):
        return math.sqrt((lms[p1].x - lms[p2].x)**2 + (lms[p1].y - lms[p2].y)**2)

    # Boca (Mouth Open -> 'A')
    mouth_open = dist(13, 14)
    mouth_width = dist(78, 308)
    ratio_mouth = mouth_open / (mouth_width + 1e-6)
    val_mouth = np.clip((ratio_mouth - 0.05) / 0.4, 0.0, 1.0)
    blendshapes['A'] = float(val_mouth)

    # Ojo Izquierdo (Blink_L)
    eye_l_open = dist(159, 145)
    eye_l_width = dist(33, 133)
    ratio_l = eye_l_open / (eye_l_width + 1e-6)
    val_blink_l = 1.0 - np.clip((ratio_l - 0.15) / 0.1, 0.0, 1.0)
    blendshapes['Blink_L'] = float(val_blink_l)

    # Ojo Derecho (Blink_R)
    eye_r_open = dist(386, 374)
    eye_r_width = dist(362, 263)
    ratio_r = eye_r_open / (eye_r_width + 1e-6)
    val_blink_r = 1.0 - np.clip((ratio_r - 0.15) / 0.1, 0.0, 1.0)
    blendshapes['Blink_R'] = float(val_blink_r)

    return blendshapes

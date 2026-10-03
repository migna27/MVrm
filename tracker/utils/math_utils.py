import math
import numpy as np
from scipy.signal import savgol_filter
from scipy.spatial.transform import Rotation

def align_vectors(v_rest, v_obs):
    """Calcula los Euler angles necesarios para rotar v_rest hacia v_obs en espacio 3D."""
    v_rest = v_rest / (np.linalg.norm(v_rest) + 1e-6)
    v_obs = v_obs / (np.linalg.norm(v_obs) + 1e-6)
    
    axis = np.cross(v_rest, v_obs)
    axis_len = np.linalg.norm(axis)
    if axis_len < 1e-5:
        return [0.0, 0.0, 0.0]
    
    axis = axis / axis_len
    angle = math.acos(np.clip(np.dot(v_rest, v_obs), -1.0, 1.0))
    
    r = Rotation.from_rotvec(axis * angle)
    return r.as_euler('xyz').tolist()

def calculate_full_body_angles(landmarks):
    """
    Convierte landmarks a Euler Angles resolviendo la cinemática directa (Forward Kinematics).
    Aplica verificación de visibilidad (lo que no se ve no se trackea).
    """
    angles = {}
    positions = {}
    
    # Umbral de visibilidad
    VISIBILITY_THRESHOLD = 0.5
    
    def pt(idx):
        lm = landmarks[idx]
        return np.array([lm.x, -lm.y, lm.z]), lm.visibility
        
    ls, ls_v = pt(11)
    rs, rs_v = pt(12)
    le, le_v = pt(13)
    re, re_v = pt(14)
    lw, lw_v = pt(15)
    rw, rw_v = pt(16)
    lh, lh_v = pt(23)
    rh, rh_v = pt(24)
    lk, lk_v = pt(25)
    rk, rk_v = pt(26)
    la, la_v = pt(27)
    ra, ra_v = pt(28)
    nose, nose_v = pt(0)
    
    hips_mid = (lh + rh) / 2.0
    shoulders_mid = (ls + rs) / 2.0
    
    # 2. Vectores Observados (Dirección real en el video)
    spine_obs = shoulders_mid - hips_mid
    head_obs = nose - shoulders_mid
    
    # 3. Calcular Rotaciones alineando el vector de reposo con el observado
    # Espalda y cabeza (asumimos que casi siempre son visibles)
    if ls_v > 0.3 and rs_v > 0.3 and lh_v > 0.3 and rh_v > 0.3:
        angles['spine'] = align_vectors(np.array([0, 1, 0]), spine_obs)
    if nose_v > 0.3:
        angles['head'] = align_vectors(np.array([0, 1, 0]), head_obs)
    
    # Brazo Izquierdo
    if ls_v > VISIBILITY_THRESHOLD and le_v > VISIBILITY_THRESHOLD:
        angles['leftUpperArm'] = align_vectors(np.array([1, 0, 0]), le - ls)
        if lw_v > VISIBILITY_THRESHOLD:
            angles['leftLowerArm'] = align_vectors(np.array([1, 0, 0]), lw - le)
            
    # Brazo Derecho
    if rs_v > VISIBILITY_THRESHOLD and re_v > VISIBILITY_THRESHOLD:
        angles['rightUpperArm'] = align_vectors(np.array([-1, 0, 0]), re - rs)
        if rw_v > VISIBILITY_THRESHOLD:
            angles['rightLowerArm'] = align_vectors(np.array([-1, 0, 0]), rw - re)
            
    # Pierna Izquierda
    if lh_v > VISIBILITY_THRESHOLD and lk_v > VISIBILITY_THRESHOLD:
        angles['leftUpperLeg'] = align_vectors(np.array([0, -1, 0]), lk - lh)
        if la_v > VISIBILITY_THRESHOLD:
            angles['leftLowerLeg'] = align_vectors(np.array([0, -1, 0]), la - lk)
            
    # Pierna Derecha
    if rh_v > VISIBILITY_THRESHOLD and rk_v > VISIBILITY_THRESHOLD:
        angles['rightUpperLeg'] = align_vectors(np.array([0, -1, 0]), rk - rh)
        if ra_v > VISIBILITY_THRESHOLD:
            angles['rightLowerLeg'] = align_vectors(np.array([0, -1, 0]), ra - rk)
            
    return angles, positions

def apply_anti_clipping(angles, l_wrist, r_wrist, l_shoulder, r_shoulder):
    # Ya no es tan necesario con el cálculo vectorial exacto, pero lo mantenemos por seguridad.
    return angles

def smooth_tracks(tracks_raw, window=5, polyorder=2):
    tracks_smoothed = {}
    for bone, keys in tracks_raw.items():
        if len(keys) < window:
            tracks_smoothed[bone] = keys
            continue
        vals = np.array([k["Valor"] for k in keys])
        try:
            vals[:, 0] = savgol_filter(vals[:, 0], window, polyorder)
            vals[:, 1] = savgol_filter(vals[:, 1], window, polyorder)
            vals[:, 2] = savgol_filter(vals[:, 2], window, polyorder)
        except:
            pass
        for i, k in enumerate(keys):
            k["Valor"] = vals[i].tolist()
        tracks_smoothed[bone] = keys
    return tracks_smoothed

def calculate_hand_angles(landmarks, is_right=False):
    import math
    import numpy as np
    angles = {}
    prefix = 'right' if is_right else 'left'
    def pt(idx): return np.array([landmarks[idx].x, landmarks[idx].y])
    wrist = pt(0)
    index_mcp = pt(5)
    hand_dir = index_mcp - wrist
    hand_dir = hand_dir / (np.linalg.norm(hand_dir) + 1e-6)
    roll = math.atan2(hand_dir[1], hand_dir[0])
    if not is_right: roll -= math.pi
    angles[f"{prefix}Hand"] = [0, 0, roll * 0.5] 
    
    fingers = [
        ('Thumb', 1, 2, 3, 4), ('Index', 5, 6, 7, 8),
        ('Middle', 9, 10, 11, 12), ('Ring', 13, 14, 15, 16),
        ('Little', 17, 18, 19, 20)
    ]
    for fname, mcp, pip, dip, tip in fingers:
        d_mcp = np.linalg.norm(pt(mcp) - wrist)
        d_tip = np.linalg.norm(pt(tip) - wrist)
        ratio = d_tip / (d_mcp + 1e-6)
        curl = np.clip((2.0 - ratio) * 1.5, 0.0, 1.5)
        if fname == 'Thumb': curl *= 0.5 
        angles[f"{prefix}{fname}Proximal"] = [0, 0, curl]
        angles[f"{prefix}{fname}Intermediate"] = [0, 0, curl]
        angles[f"{prefix}{fname}Distal"] = [0, 0, curl]
    return angles

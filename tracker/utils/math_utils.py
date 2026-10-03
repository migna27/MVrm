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

def calculate_full_body_angles(landmarks_dict):
    """
    Convierte landmarks a Euler Angles resolviendo la cinemática directa (Forward Kinematics).
    Se mapea el espacio de MediaPipe a un espacio compatible con Unity/VRM (Y-Up, X-Right).
    """
    angles = {}
    positions = {}
    
    # MP coords: X=Right, Y=Down, Z=Away from camera
    # Unity coords: X=Right, Y=Up, Z=Forward
    def to_unity(pt):
        # Invertimos Y para que Arriba sea +Y. 
        # Invertimos Z para profundidad (depende de cómo queramos que reaccione VMC, usualmente -Z o +Z, probaremos +Z).
        return np.array([pt[0], -pt[1], pt[2]])
        
    ls = to_unity(landmarks_dict['ls'])
    rs = to_unity(landmarks_dict['rs'])
    le = to_unity(landmarks_dict['le'])
    re = to_unity(landmarks_dict['re'])
    lw = to_unity(landmarks_dict['lw'])
    rw = to_unity(landmarks_dict['rw'])
    lh = to_unity(landmarks_dict['lh'])
    rh = to_unity(landmarks_dict['rh'])
    lk = to_unity(landmarks_dict['lk'])
    rk = to_unity(landmarks_dict['rk'])
    la = to_unity(landmarks_dict['la'])
    ra = to_unity(landmarks_dict['ra'])
    nose = to_unity(landmarks_dict['nose'])
    
    hips_mid = (lh + rh) / 2.0
    shoulders_mid = (ls + rs) / 2.0
    
    # 2. Vectores Observados (Dirección real en el video)
    spine_obs = shoulders_mid - hips_mid
    head_obs = nose - shoulders_mid
    
    l_arm_obs = le - ls
    l_forearm_obs = lw - le
    r_arm_obs = re - rs
    r_forearm_obs = rw - re
    
    l_leg_obs = lk - lh
    l_calf_obs = la - lk
    r_leg_obs = rk - rh
    r_calf_obs = ra - rk
    
    # 3. Calcular Rotaciones alineando el vector de reposo (T-Pose) con el observado
    # En VRM (Unity): Cabeza/Espalda apuntan en +Y, Piernas en -Y, Brazo Izq en +X, Brazo Der en -X
    angles['spine'] = align_vectors(np.array([0, 1, 0]), spine_obs)
    angles['head'] = align_vectors(np.array([0, 1, 0]), head_obs)
    
    angles['leftUpperArm'] = align_vectors(np.array([1, 0, 0]), l_arm_obs)
    angles['leftLowerArm'] = align_vectors(np.array([1, 0, 0]), l_forearm_obs)
    
    angles['rightUpperArm'] = align_vectors(np.array([-1, 0, 0]), r_arm_obs)
    angles['rightLowerArm'] = align_vectors(np.array([-1, 0, 0]), r_forearm_obs)
    
    angles['leftUpperLeg'] = align_vectors(np.array([0, -1, 0]), l_leg_obs)
    angles['leftLowerLeg'] = align_vectors(np.array([0, -1, 0]), l_calf_obs)
    
    angles['rightUpperLeg'] = align_vectors(np.array([0, -1, 0]), r_leg_obs)
    angles['rightLowerLeg'] = align_vectors(np.array([0, -1, 0]), r_calf_obs)
    
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

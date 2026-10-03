import math
import numpy as np
from scipy.signal import savgol_filter

def calculate_full_body_angles(landmarks_dict):
    """
    Convierte un diccionario de landmarks 3D a Euler Angles (VRM) y la posición de la cadera.
    landmarks_dict contiene: 'ls', 'rs', 'le', 're', 'lw', 'rw', 'lh', 'rh', 'lk', 'rk', 'la', 'ra', 'nose'
    """
    angles = {}
    positions = {}
    
    ls, rs = landmarks_dict['ls'], landmarks_dict['rs']
    le, re = landmarks_dict['le'], landmarks_dict['re']
    lh, rh = landmarks_dict['lh'], landmarks_dict['rh'] # caderas
    lk, rk = landmarks_dict['lk'], landmarks_dict['rk'] # rodillas
    la, ra = landmarks_dict['la'], landmarks_dict['ra'] # tobillos
    nose = landmarks_dict['nose']

    def get_dir(p1, p2):
        vec = p2 - p1
        n = np.linalg.norm(vec)
        return (vec / n) if n > 0 else np.zeros(3)

    # POSICIÓN DE CADERA (Root)
    hips_mid = (lh + rh) / 2.0
    # MediaPipe normaliza de extraña manera. Invertimos Y para que cuadre con Three.js
    positions['hips'] = [-hips_mid[0], -hips_mid[1], -hips_mid[2]]

    # COLUMNA (Spine)
    shoulders_mid = (ls + rs) / 2.0
    spine_dir = get_dir(hips_mid, shoulders_mid)
    # Pitch hacia adelante/atras, Roll a los lados
    spine_pitch = math.asin(np.clip(spine_dir[2], -1.0, 1.0))
    spine_roll = math.atan2(spine_dir[0], spine_dir[1])
    angles['spine'] = [-spine_pitch, 0, spine_roll]

    # CABEZA (Head)
    head_dir = get_dir(shoulders_mid, nose)
    head_pitch = math.asin(np.clip(head_dir[2], -1.0, 1.0))
    head_yaw = math.atan2(head_dir[0], -head_dir[1])
    angles['head'] = [-head_pitch, head_yaw, 0]

    # BRAZOS
    l_arm_dir = get_dir(ls, le)
    if np.any(l_arm_dir):
        angles['leftUpperArm'] = [0, math.atan2(-l_arm_dir[2], l_arm_dir[0]), math.asin(np.clip(l_arm_dir[1], -1.0, 1.0))]

    r_arm_dir = get_dir(rs, re)
    if np.any(r_arm_dir):
        angles['rightUpperArm'] = [0, math.atan2(-r_arm_dir[2], -r_arm_dir[0]), math.asin(np.clip(r_arm_dir[1], -1.0, 1.0))]

    l_forearm_dir = get_dir(le, landmarks_dict['lw'])
    if np.any(l_forearm_dir):
        angles['leftLowerArm'] = [0, 0, math.asin(np.clip(l_forearm_dir[1], -1.0, 1.0))]

    r_forearm_dir = get_dir(re, landmarks_dict['rw'])
    if np.any(r_forearm_dir):
        angles['rightLowerArm'] = [0, 0, math.asin(np.clip(r_forearm_dir[1], -1.0, 1.0))]

    # PIERNAS
    l_leg_dir = get_dir(lh, lk)
    if np.any(l_leg_dir):
        # Mapeo simple: rotar en X (flexión) y Z (abducción)
        pitch = math.asin(np.clip(l_leg_dir[2], -1.0, 1.0))
        angles['leftUpperLeg'] = [pitch, 0, 0]

    r_leg_dir = get_dir(rh, rk)
    if np.any(r_leg_dir):
        pitch = math.asin(np.clip(r_leg_dir[2], -1.0, 1.0))
        angles['rightUpperLeg'] = [pitch, 0, 0]

    l_calf_dir = get_dir(lk, la)
    if np.any(l_calf_dir):
        pitch = math.asin(np.clip(l_calf_dir[2], -1.0, 1.0))
        angles['leftLowerLeg'] = [pitch, 0, 0]

    r_calf_dir = get_dir(rk, ra)
    if np.any(r_calf_dir):
        pitch = math.asin(np.clip(r_calf_dir[2], -1.0, 1.0))
        angles['rightLowerLeg'] = [pitch, 0, 0]

    return angles, positions

def apply_anti_clipping(angles, l_wrist, r_wrist, l_shoulder, r_shoulder):
    body_radius = 0.15 
    if 'leftUpperArm' in angles and abs(l_wrist[0]) < body_radius and l_wrist[1] > l_shoulder[1]:
        penetration = body_radius - abs(l_wrist[0])
        angles['leftUpperArm'][2] -= penetration * 2.0 
    if 'rightUpperArm' in angles and abs(r_wrist[0]) < body_radius and r_wrist[1] > r_shoulder[1]:
        penetration = body_radius - abs(r_wrist[0])
        angles['rightUpperArm'][2] += penetration * 2.0
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

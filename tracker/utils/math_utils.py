import math
import numpy as np
from scipy.signal import savgol_filter
from scipy.spatial.transform import Rotation

def align_vectors_matrix(v_rest, v_obs):
    v_rest = v_rest / (np.linalg.norm(v_rest) + 1e-6)
    v_obs = v_obs / (np.linalg.norm(v_obs) + 1e-6)
    
    axis = np.cross(v_rest, v_obs)
    axis_len = np.linalg.norm(axis)
    if axis_len < 1e-5:
        return Rotation.identity()
    
    axis = axis / axis_len
    angle = math.acos(np.clip(np.dot(v_rest, v_obs), -1.0, 1.0))
    return Rotation.from_rotvec(axis * angle)

def calculate_full_body_angles(landmarks):
    angles = {}
    positions = {}
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
    
    world_rotations = {}
    
    # Espalda
    if ls_v > 0.3 and rs_v > 0.3 and lh_v > 0.3 and rh_v > 0.3:
        world_rotations['spine'] = align_vectors_matrix(np.array([0, 1, 0]), shoulders_mid - hips_mid)
    else:
        world_rotations['spine'] = Rotation.identity()
        
    # Cabeza
    lear, lear_v = pt(7)
    rear, rear_v = pt(8)
    if lear_v > 0.3 and rear_v > 0.3 and nose_v > 0.3:
        x_axis = lear - rear 
        x_axis /= (np.linalg.norm(x_axis) + 1e-6)
        head_mid = (lear + rear) / 2.0
        z_axis = head_mid - nose
        z_axis /= (np.linalg.norm(z_axis) + 1e-6)
        y_axis = np.cross(z_axis, x_axis)
        y_axis /= (np.linalg.norm(y_axis) + 1e-6)
        x_axis = np.cross(y_axis, z_axis)
        
        try:
            rot_mat = np.column_stack((x_axis, y_axis, z_axis))
            world_rotations['head'] = Rotation.from_matrix(rot_mat)
        except:
            world_rotations['head'] = world_rotations['spine']
    
    # Brazos
    if ls_v > VISIBILITY_THRESHOLD and le_v > VISIBILITY_THRESHOLD:
        world_rotations['leftUpperArm'] = align_vectors_matrix(np.array([1, 0, 0]), le - ls)
        if lw_v > VISIBILITY_THRESHOLD:
            world_rotations['leftLowerArm'] = align_vectors_matrix(np.array([1, 0, 0]), lw - le)
            
    if rs_v > VISIBILITY_THRESHOLD and re_v > VISIBILITY_THRESHOLD:
        world_rotations['rightUpperArm'] = align_vectors_matrix(np.array([-1, 0, 0]), re - rs)
        if rw_v > VISIBILITY_THRESHOLD:
            world_rotations['rightLowerArm'] = align_vectors_matrix(np.array([-1, 0, 0]), rw - re)
            
    # Piernas
    if lh_v > VISIBILITY_THRESHOLD and lk_v > VISIBILITY_THRESHOLD:
        world_rotations['leftUpperLeg'] = align_vectors_matrix(np.array([0, -1, 0]), lk - lh)
        if la_v > VISIBILITY_THRESHOLD:
            world_rotations['leftLowerLeg'] = align_vectors_matrix(np.array([0, -1, 0]), la - lk)
            
    if rh_v > VISIBILITY_THRESHOLD and rk_v > VISIBILITY_THRESHOLD:
        world_rotations['rightUpperLeg'] = align_vectors_matrix(np.array([0, -1, 0]), rk - rh)
        if ra_v > VISIBILITY_THRESHOLD:
            world_rotations['rightLowerLeg'] = align_vectors_matrix(np.array([0, -1, 0]), ra - rk)
            
    # Convertir World Rotations a Local Rotations
    hierarchy = {
        'head': 'spine',
        'leftUpperArm': 'spine',
        'leftLowerArm': 'leftUpperArm',
        'rightUpperArm': 'spine',
        'rightLowerArm': 'rightUpperArm',
        'leftUpperLeg': None, # Hips is parent, assuming identity for now
        'leftLowerLeg': 'leftUpperLeg',
        'rightUpperLeg': None,
        'rightLowerLeg': 'rightUpperLeg'
    }
    
    angles['spine'] = world_rotations.get('spine', Rotation.identity()).as_euler('xyz').tolist()
    
    for bone, parent in hierarchy.items():
        if bone in world_rotations:
            r_world = world_rotations[bone]
            r_parent_world = world_rotations.get(parent, Rotation.identity()) if parent else Rotation.identity()
            # R_world = R_parent_world * R_local  =>  R_local = R_parent_world^-1 * R_world
            r_local = r_parent_world.inv() * r_world
            angles[bone] = r_local.as_euler('xyz').tolist()
            
    return angles, positions, world_rotations

def apply_anti_clipping(angles, l_wrist, r_wrist, l_shoulder, r_shoulder):
    return angles


def smooth_tracks(tracks_raw, window=5, polyorder=2):
    tracks_smoothed = {}
    for bone, keys in tracks_raw.items():
        if len(keys) < window:
            tracks_smoothed[bone] = keys
            continue
        vals = np.array([k["Valor"] for k in keys])
        try:
            for dim in range(vals.shape[1]):
                vals[:, dim] = savgol_filter(vals[:, dim], window, polyorder)
        except Exception:
            pass
        for i, k in enumerate(keys):
            k["Valor"] = vals[i].tolist()
        tracks_smoothed[bone] = keys
    return tracks_smoothed

def calculate_hand_angles(landmarks, parent_world_rot=None, is_right=False):
    import math
    import numpy as np
    from scipy.spatial.transform import Rotation
    
    angles = {}
    prefix = 'right' if is_right else 'left'
    
    # 3D points: MediaPipe X is right, Y is down.
    # Mapeamos a X=right, Y=up, Z=depth
    def pt(idx): return np.array([landmarks[idx].x, -landmarks[idx].y, landmarks[idx].z])
    
    wrist = pt(0)
    index_mcp = pt(5)
    middle_mcp = pt(9)
    pinky_mcp = pt(17)
    
    x_obs = middle_mcp - wrist
    x_len = np.linalg.norm(x_obs)
    
    if x_len > 1e-5:
        x_obs = x_obs / x_len
        z_obs = index_mcp - pinky_mcp
        z_len = np.linalg.norm(z_obs)
        if z_len > 1e-5:
            z_obs = z_obs / z_len
            y_obs = np.cross(z_obs, x_obs)
            y_obs /= (np.linalg.norm(y_obs) + 1e-6)
            z_obs = np.cross(x_obs, y_obs)
            
            if not is_right:
                R_rest = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]]).T
            else:
                R_rest = np.array([[-1, 0, 0], [0, 1, 0], [0, 0, 1]]).T
                
            R_obs = np.column_stack((x_obs, y_obs, z_obs))
            
            try:
                R_world = R_obs @ np.linalg.inv(R_rest)
                r_world = Rotation.from_matrix(R_world)
                
                # Apply local rotation math
                if parent_world_rot is not None:
                    r_local = parent_world_rot.inv() * r_world
                else:
                    r_local = r_world
                    
                angles[f"{prefix}Hand"] = r_local.as_euler('xyz').tolist()
            except:
                pass

    fingers = [
        ('Thumb', 1, 2, 3, 4), ('Index', 5, 6, 7, 8),
        ('Middle', 9, 10, 11, 12), ('Ring', 13, 14, 15, 16),
        ('Little', 17, 18, 19, 20)
    ]
    for fname, mcp, pip, dip, tip in fingers:
        d_mcp = np.linalg.norm(pt(mcp) - wrist)
        d_tip = np.linalg.norm(pt(tip) - wrist)
        ratio = d_tip / (d_mcp + 1e-6)
        curl = np.clip((2.2 - ratio) * 1.5, 0.0, 1.8)
        if fname == 'Thumb': curl *= 0.5 
        angles[f"{prefix}{fname}Proximal"] = [0, 0, float(curl)]
        angles[f"{prefix}{fname}Intermediate"] = [0, 0, float(curl)]
        angles[f"{prefix}{fname}Distal"] = [0, 0, float(curl)]
        
    return angles

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

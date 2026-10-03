import math
import numpy as np
from scipy.signal import savgol_filter

def calculate_euler_angles_from_landmarks(l_shoulder, r_shoulder, l_elbow, r_elbow, l_wrist, r_wrist):
    """
    Convierte puntos 3D a Euler Angles (VRM T-Pose).
    """
    angles = {}
    
    # --- Brazo Izquierdo (Left Arm) ---
    l_arm_vec = l_elbow - l_shoulder
    l_norm = np.linalg.norm(l_arm_vec)
    if l_norm > 0:
        l_arm_dir = l_arm_vec / l_norm
        pitch_l = math.asin(np.clip(l_arm_dir[1], -1.0, 1.0)) 
        yaw_l = math.atan2(-l_arm_dir[2], l_arm_dir[0])       
        angles['leftUpperArm'] = [0, yaw_l, pitch_l]

    # --- Brazo Derecho (Right Arm) ---
    r_arm_vec = r_elbow - r_shoulder
    r_norm = np.linalg.norm(r_arm_vec)
    if r_norm > 0:
        r_arm_dir = r_arm_vec / r_norm
        pitch_r = math.asin(np.clip(r_arm_dir[1], -1.0, 1.0))
        yaw_r = math.atan2(-r_arm_dir[2], -r_arm_dir[0])
        angles['rightUpperArm'] = [0, yaw_r, pitch_r]

    return angles

def apply_anti_clipping(angles, l_wrist, r_wrist, l_shoulder, r_shoulder):
    """
    Algoritmo Matemático de Evasión de Traspasos (Cápsula-Esfera).
    """
    body_radius = 0.15 
    
    if 'leftUpperArm' in angles and abs(l_wrist[0]) < body_radius and l_wrist[1] > l_shoulder[1]:
        penetration = body_radius - abs(l_wrist[0])
        angles['leftUpperArm'][2] -= penetration * 2.0 
        
    if 'rightUpperArm' in angles and abs(r_wrist[0]) < body_radius and r_wrist[1] > r_shoulder[1]:
        penetration = body_radius - abs(r_wrist[0])
        angles['rightUpperArm'][2] += penetration * 2.0
        
    return angles

def smooth_tracks(tracks, window=7, poly=2):
    """Filtro Savitzky-Golay."""
    for bone, keys in tracks.items():
        if len(keys) < window: continue
        x = [k['Valor'][0] for k in keys]
        y = [k['Valor'][1] for k in keys]
        z = [k['Valor'][2] for k in keys]
        
        x_f = savgol_filter(x, window, poly)
        y_f = savgol_filter(y, window, poly)
        z_f = savgol_filter(z, window, poly)
        
        for i in range(len(keys)):
            keys[i]['Valor'] = [float(x_f[i]), float(y_f[i]), float(z_f[i])]
    return tracks

import cv2
import mediapipe as mp
import numpy as np
import json
import sys
import math
from scipy.signal import savgol_filter
import os

# ==============================================================================
# Motor de Tracking Externo (v a-0.0.2)
# Reemplazo de TDPT usando MediaPipe + Matemáticas de Anti-Colisión en Python
# ==============================================================================

mp_pose = mp.solutions.pose

# Mapeo de MediaPipe a Huesos VRM
def calculate_euler_angles(landmarks):
    """
    Convierte landmarks 3D a rotaciones relativas locales (Euler) para VRM.
    Devuelve un diccionario con los ángulos [x, y, z] para cada hueso clave.
    """
    angles = {}
    
    # Extraer landmarks
    l_shoulder = np.array([landmarks[11].x, landmarks[11].y, landmarks[11].z])
    r_shoulder = np.array([landmarks[12].x, landmarks[12].y, landmarks[12].z])
    l_elbow = np.array([landmarks[13].x, landmarks[13].y, landmarks[13].z])
    r_elbow = np.array([landmarks[14].x, landmarks[14].y, landmarks[14].z])
    l_wrist = np.array([landmarks[15].x, landmarks[15].y, landmarks[15].z])
    r_wrist = np.array([landmarks[16].x, landmarks[16].y, landmarks[16].z])
    
    # Vector del torso (columna)
    torso_up = l_shoulder + r_shoulder
    torso_up = torso_up / np.linalg.norm(torso_up)
    
    # --- Brazo Izquierdo (Left Arm) ---
    l_arm_vec = l_elbow - l_shoulder
    l_arm_dir = l_arm_vec / np.linalg.norm(l_arm_vec)
    # Convertir dirección a Euler (Aproximación simple para T-Pose VRM)
    # En VRM T-Pose, el brazo izquierdo apunta a +X
    pitch_l = math.asin(np.clip(l_arm_dir[1], -1.0, 1.0)) # elevación Y
    yaw_l = math.atan2(-l_arm_dir[2], l_arm_dir[0])       # Z vs X
    angles['leftUpperArm'] = [0, yaw_l, pitch_l]

    # --- Brazo Derecho (Right Arm) ---
    r_arm_vec = r_elbow - r_shoulder
    r_arm_dir = r_arm_vec / np.linalg.norm(r_arm_vec)
    # En VRM T-Pose, el brazo derecho apunta a -X
    pitch_r = math.asin(np.clip(r_arm_dir[1], -1.0, 1.0))
    yaw_r = math.atan2(-r_arm_dir[2], -r_arm_dir[0])
    angles['rightUpperArm'] = [0, yaw_r, pitch_r]

    # TODO: Añadir LowerArm, Piernas, Spine, Cuello (Head)
    
    return angles, l_wrist, r_wrist, l_shoulder, r_shoulder

def apply_anti_clipping(angles, l_wrist, r_wrist, l_shoulder, r_shoulder):
    """
    Algoritmo Matemático de Evasión de Traspasos (Cápsula-Esfera).
    Evita que las manos atraviesen el torso.
    """
    # El torso se asume en X=0. Distancia mínima de seguridad en X.
    body_radius = 0.15 # 15 cm de radio promedio para el torso
    
    # Comprobar mano izquierda
    if abs(l_wrist[0]) < body_radius and l_wrist[1] > l_shoulder[1]:
        # Si la mano se acerca mucho al centro del cuerpo, forzamos el brazo hacia afuera
        penetration = body_radius - abs(l_wrist[0])
        # Repulsión sumando rotación en Z (roll) para separar el brazo
        angles['leftUpperArm'][2] -= penetration * 2.0 
        
    # Comprobar mano derecha
    if abs(r_wrist[0]) < body_radius and r_wrist[1] > r_shoulder[1]:
        penetration = body_radius - abs(r_wrist[0])
        angles['rightUpperArm'][2] += penetration * 2.0
        
    return angles

def smooth_tracks(tracks, window=7, poly=2):
    """Aplica filtro Savitzky-Golay para suavizar temblores naturales del video."""
    for bone, keys in tracks.items():
        if len(keys) < window: continue
        
        # Extraer canales
        x = [k['Valor'][0] for k in keys]
        y = [k['Valor'][1] for k in keys]
        z = [k['Valor'][2] for k in keys]
        
        # Filtrar
        x_f = savgol_filter(x, window, poly)
        y_f = savgol_filter(y, window, poly)
        z_f = savgol_filter(z, window, poly)
        
        for i in range(len(keys)):
            keys[i]['Valor'] = [float(x_f[i]), float(y_f[i]), float(z_f[i])]
            
    return tracks

def main(video_path, output_json, fps_target=24):
    print(f"[INFO] Iniciando motor de Tracking 3D v a-0.0.2")
    print(f"[INFO] Procesando video: {video_path}")
    
    cap = cv2.VideoCapture(video_path)
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if video_fps <= 0: video_fps = 30
    frame_interval = int(video_fps / fps_target)
    if frame_interval < 1: frame_interval = 1
    
    tracks_raw = {'leftUpperArm': [], 'rightUpperArm': []}
    
    with mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5, model_complexity=2) as pose:
        frame_idx = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
            
            if frame_idx % frame_interval == 0:
                time_sec = frame_idx / video_fps
                
                # Convertir color
                image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image.flags.writeable = False
                results = pose.process(image)
                
                if results.pose_world_landmarks:
                    angles, lw, rw, ls, rs = calculate_euler_angles(results.pose_world_landmarks.landmark)
                    angles = apply_anti_clipping(angles, lw, rw, ls, rs)
                    
                    for bone, rot in angles.items():
                        if bone not in tracks_raw: tracks_raw[bone] = []
                        tracks_raw[bone].append({"Id": f"tr_{frame_idx}_{bone}", "Tiempo": time_sec, "Valor": rot})
                        
            frame_idx += 1
            
    cap.release()
    
    print("[INFO] Aplicando filtro de suavizado matemático...")
    tracks_smoothed = smooth_tracks(tracks_raw)
    
    # Formatear a la estructura PistaAnimacion de BIO
    pistas_finales = []
    for bone, keys in tracks_smoothed.items():
        pistas_finales.append({
            "Id": f"pista_python_{bone}",
            "Nombre": f"Tracking Python {bone}",
            "Tipo": "HuesoRotacion",
            "Objetivo": bone,
            "Grupo": "SeguimientoCuerpo",
            "Claves": keys
        })
        
    out_data = {"Duracion": (frame_idx / video_fps), "Pistas": pistas_finales}
    
    with open(output_json, 'w') as f:
        json.dump(out_data, f, indent=2)
        
    print(f"[EXITO] Archivo de tracking guardado en: {output_json}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python motor_tracking.py <video_entrada.mp4> <salida.json>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])

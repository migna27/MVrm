import cv2
import mediapipe as mp
import numpy as np
import time
from utils.math_utils import calculate_euler_angles_from_landmarks, apply_anti_clipping

def run_mediapipe_tracking(video_path, fps_target=24, live=False, osc_client=None):
    mp_pose = mp.solutions.pose
    
    # Si es live, intentamos abrir la camara (0)
    source = int(video_path) if live and video_path.isdigit() else video_path
    if live and not video_path: source = 0
    
    cap = cv2.VideoCapture(source)
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if video_fps <= 0: video_fps = 30
    frame_interval = max(1, int(video_fps / fps_target))
    
    tracks_raw = {}
    frame_idx = 0
    
    with mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5, model_complexity=1 if live else 2) as pose:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
            
            if live or (frame_idx % frame_interval == 0):
                time_sec = frame_idx / video_fps
                
                # Para la camara, hacer efecto espejo
                if live:
                    frame = cv2.flip(frame, 1)
                    
                image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image.flags.writeable = False
                results = pose.process(image)
                
                if results.pose_world_landmarks:
                    lms = results.pose_world_landmarks.landmark
                    ls = np.array([lms[11].x, lms[11].y, lms[11].z])
                    rs = np.array([lms[12].x, lms[12].y, lms[12].z])
                    le = np.array([lms[13].x, lms[13].y, lms[13].z])
                    re = np.array([lms[14].x, lms[14].y, lms[14].z])
                    lw = np.array([lms[15].x, lms[15].y, lms[15].z])
                    rw = np.array([lms[16].x, lms[16].y, lms[16].z])
                    
                    angles = calculate_euler_angles_from_landmarks(ls, rs, le, re, lw, rw)
                    angles = apply_anti_clipping(angles, lw, rw, ls, rs)
                    
                    if live and osc_client:
                        from scipy.spatial.transform import Rotation
                        # Enviar por OSC instantaneamente
                        for bone, rot in angles.items():
                            # Rotación a quaternion
                            r = Rotation.from_euler('xyz', rot)
                            qx, qy, qz, qw = r.as_quat()
                            # Enviar: VMC/Ext/Bone/Pos -> nombre, px, py, pz, qx, qy, qz, qw
                            osc_client.send_message("/VMC/Ext/Bone/Pos", [bone, 0.0, 0.0, 0.0, float(qx), float(qy), float(qz), float(qw)])
                        # Aplicar (Apply)
                        osc_client.send_message("/VMC/Ext/Blend/Apply", [])
                        
                    else:
                        for bone, rot in angles.items():
                            if bone not in tracks_raw: tracks_raw[bone] = []
                            tracks_raw[bone].append({"Id": f"tr_{frame_idx}_{bone}", "Tiempo": time_sec, "Valor": rot})
                            
            frame_idx += 1
            if live:
                # Mantener un ritmo moderado en live si la camara va muy rapido
                time.sleep(0.01)
                
    cap.release()
    return tracks_raw, (frame_idx / video_fps)

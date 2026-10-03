import cv2
import mediapipe as mp
import numpy as np
import time
from utils.math_utils import calculate_euler_angles_from_landmarks, apply_anti_clipping

def run_mediapipe_tracking(video_path, fps_target=24, live=False, osc_client=None):
    mp_holistic = mp.solutions.holistic
    mp_drawing = mp.solutions.drawing_utils
    
    source = int(video_path) if live and video_path.isdigit() else video_path
    if live and not video_path: source = 0
    
    import platform
    if live and isinstance(source, int) and platform.system() == 'Windows':
        cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
    else:
        cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"[ERROR] No se pudo abrir la cámara o video: {source}")
        return {}, 0

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if video_fps <= 0: video_fps = 30
    frame_interval = max(1, int(video_fps / fps_target))
    
    tracks_raw = {}
    frame_idx = 0
    
    print("[INFO] Iniciando captura. Presiona ESC en la ventana de preview para salir.")

    with mp_holistic.Holistic(min_detection_confidence=0.5, min_tracking_confidence=0.5, model_complexity=1 if live else 2) as holistic:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
            
            if live or (frame_idx % frame_interval == 0):
                time_sec = frame_idx / video_fps
                
                if live:
                    frame = cv2.flip(frame, 1)
                    
                image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image.flags.writeable = False
                results = holistic.process(image)
                
                # Para el preview
                image.flags.writeable = True
                image_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
                
                if results.pose_landmarks:
                    mp_drawing.draw_landmarks(image_bgr, results.pose_landmarks, mp_holistic.POSE_CONNECTIONS)
                if results.left_hand_landmarks:
                    mp_drawing.draw_landmarks(image_bgr, results.left_hand_landmarks, mp_holistic.HAND_CONNECTIONS)
                if results.right_hand_landmarks:
                    mp_drawing.draw_landmarks(image_bgr, results.right_hand_landmarks, mp_holistic.HAND_CONNECTIONS)

                angles = {}
                # Postura (Cuerpo)
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
                    
                # Manos
                from utils.math_utils import calculate_hand_angles
                if results.left_hand_landmarks:
                    l_hand_angles = calculate_hand_angles(results.left_hand_landmarks.landmark, is_right=False)
                    angles.update(l_hand_angles)
                if results.right_hand_landmarks:
                    r_hand_angles = calculate_hand_angles(results.right_hand_landmarks.landmark, is_right=True)
                    angles.update(r_hand_angles)
                
                if angles:
                    if live and osc_client:
                        from scipy.spatial.transform import Rotation
                        for bone, rot in angles.items():
                            try:
                                r = Rotation.from_euler('xyz', rot)
                                qx, qy, qz, qw = r.as_quat()
                                osc_client.send_message("/VMC/Ext/Bone/Pos", [bone, 0.0, 0.0, 0.0, float(qx), float(qy), float(qz), float(qw)])
                            except Exception as e:
                                pass
                        osc_client.send_message("/VMC/Ext/Blend/Apply", [])
                        
                    else:
                        for bone, rot in angles.items():
                            if bone not in tracks_raw: tracks_raw[bone] = []
                            tracks_raw[bone].append({"Id": f"tr_{frame_idx}_{bone}", "Tiempo": time_sec, "Valor": rot})
                
                if live:
                    cv2.imshow("Animador VRM - Preview Tracking", image_bgr)
                    if cv2.waitKey(1) & 0xFF == 27: # ESC
                        break
                            
            frame_idx += 1
            if live:
                time.sleep(0.005)
                
    cap.release()
    cv2.destroyAllWindows()
    return tracks_raw, (frame_idx / video_fps)

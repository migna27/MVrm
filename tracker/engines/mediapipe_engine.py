import cv2
import mediapipe as mp
import numpy as np
import time
from utils.math_utils import calculate_full_body_angles, apply_anti_clipping

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
        
    # Forzar la resolución máxima de la webcam para detectar la cara y dedos correctamente
    if live:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        
    if not cap.isOpened():
        print(f"[ERROR] No se pudo abrir la cámara o video: {source}")
        return {}, 0

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if video_fps <= 0: video_fps = 30
    frame_interval = max(1, int(video_fps / fps_target))
    
    tracks_raw = {}
    live_angle_history = {}
    frame_idx = 0
    
    print("[INFO] Iniciando captura. Presiona ESC en la ventana de preview para salir.")

    with mp_holistic.Holistic(min_detection_confidence=0.5, min_tracking_confidence=0.5, model_complexity=1 if live else 2) as holistic:
        
        # Calcular total frames para videos
        total_frames = 0
        if not live:
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            print(f"[STATE] Analizando video ({total_frames} frames)...")
        else:
            # Hacer que la ventana de la cámara sea redimensionable y empiece pequeña
            cv2.namedWindow("Animador VRM - Preview Tracking", cv2.WINDOW_NORMAL)
            cv2.resizeWindow("Animador VRM - Preview Tracking", 640, 360)

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
            
            if live or (frame_idx % frame_interval == 0):
                time_sec = frame_idx / video_fps
                
                # Feedback de progreso para Node.js
                if not live and total_frames > 0 and frame_idx % (frame_interval * 10) == 0:
                    pct = int((frame_idx / total_frames) * 100)
                    print(f"[PROGRESS] Analizando: {pct}% completado")

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
                positions = {}
                
                # Postura (Cuerpo)
                if results.pose_world_landmarks:
                    from utils.math_utils import calculate_full_body_angles, apply_anti_clipping
                    # Pasamos directamente el array de landmarks para evaluar visibilidad
                    b_angles, b_positions = calculate_full_body_angles(results.pose_world_landmarks.landmark)
                    angles.update(b_angles)
                    positions.update(b_positions)
                    
                    # El anti clipping lo aplicamos solo a las manos si están visibles
                    lms = results.pose_world_landmarks.landmark
                    lw = np.array([lms[15].x, -lms[15].y, lms[15].z])
                    rw = np.array([lms[16].x, -lms[16].y, lms[16].z])
                    ls = np.array([lms[11].x, -lms[11].y, lms[11].z])
                    rs = np.array([lms[12].x, -lms[12].y, lms[12].z])
                    angles = apply_anti_clipping(angles, lw, rw, ls, rs)
                    
                # Manos
                from utils.math_utils import calculate_hand_angles
                if results.left_hand_landmarks:
                    l_hand_angles = calculate_hand_angles(results.left_hand_landmarks.landmark, is_right=False)
                    angles.update(l_hand_angles)
                if results.right_hand_landmarks:
                    r_hand_angles = calculate_hand_angles(results.right_hand_landmarks.landmark, is_right=True)
                    angles.update(r_hand_angles)
                
                # Cara (Expresiones)
                blendshapes = {}
                if results.face_landmarks:
                    from utils.math_utils import calculate_face_blendshapes
                    blendshapes = calculate_face_blendshapes(results.face_landmarks)
                
                if angles or positions or blendshapes:
                    if live and osc_client:
                        from scipy.spatial.transform import Rotation
                        
                        # Filtro Exponencial (EMA) para suavizar y verificar errores
                        ALPHA = 0.4
                        
                        for bone, rot in angles.items():
                            if bone not in live_angle_history:
                                live_angle_history[bone] = np.array(rot)
                            else:
                                live_angle_history[bone] = ALPHA * np.array(rot) + (1.0 - ALPHA) * live_angle_history[bone]
                                
                            try:
                                r = Rotation.from_euler('xyz', live_angle_history[bone].tolist())
                                qx, qy, qz, qw = r.as_quat()
                                osc_client.send_message("/VMC/Ext/Bone/Pos", [bone, 0.0, 0.0, 0.0, float(qx), float(qy), float(qz), float(qw)])
                            except Exception as e:
                                pass
                        
                        if 'hips' in positions:
                            hx, hy, hz = positions['hips']
                            osc_client.send_message("/VMC/Ext/Root/Pos", ["root", float(hx), float(hy), float(hz), 0.0, 0.0, 0.0, 1.0])
                            
                        # Enviar Blendshapes
                        for blend_name, val in blendshapes.items():
                            osc_client.send_message("/VMC/Ext/Blend/Val", [blend_name, float(val)])
                            
                        osc_client.send_message("/VMC/Ext/Blend/Apply", [])
                        
                    else:
                        for bone, rot in angles.items():
                            if bone not in tracks_raw: tracks_raw[bone] = []
                            tracks_raw[bone].append({"Id": f"tr_{frame_idx}_{bone}", "Tiempo": time_sec, "Valor": rot, "Tipo": "HuesoRotacion"})
                        for bone, pos in positions.items():
                            if bone not in tracks_raw: tracks_raw[bone] = []
                            tracks_raw[bone].append({"Id": f"tr_pos_{frame_idx}_{bone}", "Tiempo": time_sec, "Valor": pos, "Tipo": "HuesoPosicion"})
                        for blend_name, val in blendshapes.items():
                            if blend_name not in tracks_raw: tracks_raw[blend_name] = []
                            tracks_raw[blend_name].append({"Id": f"tr_exp_{frame_idx}_{blend_name}", "Tiempo": time_sec, "Valor": [val], "Tipo": "Expresion"})
                
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

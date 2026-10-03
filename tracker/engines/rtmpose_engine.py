import os
import cv2
import time
import numpy as np
import huggingface_hub
import onnxruntime as ort

def ensure_rtmpose_models():
    models_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    os.makedirs(models_dir, exist_ok=True)
    onnx_path = os.path.join(models_dir, "rtmpose-m.onnx")
    
    if not os.path.exists(onnx_path):
        print("[INFO] Descargando modelo RTMPose ONNX desde bukuroo/RTMPose-ONNX...")
        # Descarga desde un repo público de HuggingFace que contiene pesos ONNX de RTMPose
        onnx_path = huggingface_hub.hf_hub_download(
            repo_id="bukuroo/RTMPose-ONNX", 
            filename="rtmpose-m.onnx",
            local_dir=models_dir
        )
    return onnx_path

def run_rtmpose_tracking(source, live=False, osc_client=None, fps_target=24):
    onnx_path = ensure_rtmpose_models()
    
    # Iniciar Sesión ONNX
    session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name
    
    if live and isinstance(source, str) and source.isdigit():
        source = int(source)
        
    import platform
    if live and isinstance(source, int) and platform.system() == 'Windows':
        cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
    else:
        cap = cv2.VideoCapture(source)
        
    if not cap.isOpened():
        print(f"[ERROR] No se pudo abrir {source}")
        return {}, 0
        
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if video_fps <= 0: video_fps = 30
    
    tracks_raw = {}
    live_angle_history = {}
    frame_idx = 0
    
    if live:
        cv2.namedWindow("Animador VRM - RTMPose", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("Animador VRM - RTMPose", 640, 360)
    else:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        print(f"[STATE] Analizando video con RTMPose ({total_frames} frames)...")

    # Adaptador de RTMPose (COCO 17) a MediaPipe/Unity
    # COCO: 0:Nose, 1:LEye, 2:REye, 3:LEar, 4:REar, 5:LShoulder, 6:RShoulder, 7:LElbow, 8:RElbow, 9:LWrist, 10:RWrist, 11:LHip, 12:RHip, 13:LKnee, 14:RKnee, 15:LAnkle, 16:RAnkle
    def map_coco_to_mp(kpts, scores):
        class Landmark:
            def __init__(self, x, y, z, v):
                self.x, self.y, self.z, self.visibility = x, y, z, v
        
        # RTMPose da x, y en pixeles. Normalizamos a 0-1
        # Z es simulado (0) porque RTMPose base es 2D. 
        mp_landmarks = [Landmark(0,0,0,0)] * 33
        
        def set_mp(mp_idx, coco_idx):
            if coco_idx < len(kpts):
                mp_landmarks[mp_idx] = Landmark(
                    kpts[coco_idx][0] / 192.0, 
                    kpts[coco_idx][1] / 256.0, 
                    0.0, # Z simulado
                    scores[coco_idx]
                )
                
        set_mp(0, 0)   # Nose
        set_mp(7, 3)   # L Ear
        set_mp(8, 4)   # R Ear
        set_mp(11, 5)  # L Shoulder
        set_mp(12, 6)  # R Shoulder
        set_mp(13, 7)  # L Elbow
        set_mp(14, 8)  # R Elbow
        set_mp(15, 9)  # L Wrist
        set_mp(16, 10) # R Wrist
        set_mp(23, 11) # L Hip
        set_mp(24, 12) # R Hip
        set_mp(25, 13) # L Knee
        set_mp(26, 14) # R Knee
        set_mp(27, 15) # L Ankle
        set_mp(28, 16) # R Ankle
        
        return mp_landmarks

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        
        time_sec = frame_idx / video_fps
        
        # RTMPose requiere 192x256 (Ratio 3:4)
        h, w = frame.shape[:2]
        target_w = int(h * 0.75)
        if target_w <= w:
            crop_w, crop_h = target_w, h
        else:
            crop_w, crop_h = w, int(w / 0.75)
            
        cy, cx = h//2, w//2
        crop = frame[cy-crop_h//2 : cy+crop_h//2, cx-crop_w//2 : cx+crop_w//2].copy()
        resized = cv2.resize(crop, (192, 256))
        
        # Preprocesamiento ImageNet
        input_data = resized.astype(np.float32) / 255.0
        input_data = (input_data - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        input_data = input_data.transpose(2, 0, 1) # HWC a CHW
        input_data = np.expand_dims(input_data, 0).astype(np.float32) # Añadir batch y asegurar float32
        
        # Inferencia
        start_t = time.time()
        outputs = session.run(None, {input_name: input_data})
        simcc_x = outputs[0]
        simcc_y = outputs[1]
        
        kpts = []
        scores = []
        for i in range(17):
            x_idx = np.argmax(simcc_x[0, i])
            y_idx = np.argmax(simcc_y[0, i])
            score_x = np.max(simcc_x[0, i])
            score_y = np.max(simcc_y[0, i])
            kpts.append([x_idx, y_idx])
            scores.append((score_x + score_y) / 2.0)
            
        mp_lms = map_coco_to_mp(kpts, scores)
        
        # Dibujar debug en 2D sobre la imagen HD recortada
        for pt in kpts:
            px = int((pt[0] / 192.0) * crop_w)
            py = int((pt[1] / 256.0) * crop_h)
            cv2.circle(crop, (px, py), 6, (0, 255, 0), -1)
            
        # Calcular ángulos con el engine matemático 
        from utils.math_utils import calculate_full_body_angles
        angles, positions = calculate_full_body_angles(mp_lms)
        
        # Aquí el problema: Al ser 2D (Z=0), el personaje será plano.
        # Mandar OSC o JSON
        if angles or positions:
            if live and osc_client:
                from scipy.spatial.transform import Rotation
                ALPHA = 0.4
                for bone, rot in angles.items():
                    if bone not in live_angle_history: live_angle_history[bone] = np.array(rot)
                    else: live_angle_history[bone] = ALPHA * np.array(rot) + (1.0 - ALPHA) * live_angle_history[bone]
                    try:
                        r = Rotation.from_euler('xyz', live_angle_history[bone].tolist())
                        qx, qy, qz, qw = r.as_quat()
                        osc_client.send_message("/VMC/Ext/Bone/Pos", [bone, 0.0, 0.0, 0.0, float(qx), float(qy), float(qz), float(qw)])
                    except: pass
                osc_client.send_message("/VMC/Ext/Blend/Apply", [])
            else:
                for bone, rot in angles.items():
                    if bone not in tracks_raw: tracks_raw[bone] = []
                    tracks_raw[bone].append({"Id": f"tr_{frame_idx}_{bone}", "Tiempo": time_sec, "Valor": rot, "Tipo": "HuesoRotacion"})
                    
        if live:
            cv2.imshow("Animador VRM - RTMPose", crop)
            if cv2.waitKey(1) & 0xFF == 27: break
        else:
            if frame_idx % 10 == 0 and total_frames > 0:
                print(f"[PROGRESS] {int((frame_idx / total_frames) * 100)}")
            
        frame_idx += 1
        
    cap.release()
    cv2.destroyAllWindows()
    return tracks_raw, (frame_idx / video_fps)

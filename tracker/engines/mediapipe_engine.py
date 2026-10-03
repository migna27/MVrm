import cv2
import mediapipe as mp
import numpy as np
from utils.math_utils import calculate_euler_angles_from_landmarks, apply_anti_clipping

def run_mediapipe_tracking(video_path, fps_target=24):
    mp_pose = mp.solutions.pose
    cap = cv2.VideoCapture(video_path)
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if video_fps <= 0: video_fps = 30
    frame_interval = max(1, int(video_fps / fps_target))
    
    tracks_raw = {}
    frame_idx = 0
    
    with mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5, model_complexity=2) as pose:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
            
            if frame_idx % frame_interval == 0:
                time_sec = frame_idx / video_fps
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
                    
                    for bone, rot in angles.items():
                        if bone not in tracks_raw: tracks_raw[bone] = []
                        tracks_raw[bone].append({"Id": f"tr_{frame_idx}_{bone}", "Tiempo": time_sec, "Valor": rot})
            frame_idx += 1
            
    cap.release()
    return tracks_raw, (frame_idx / video_fps)

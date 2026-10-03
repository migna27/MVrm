import os
from utils.downloader import download_file

def ensure_rtmpose_models():
    models_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    os.makedirs(models_dir, exist_ok=True)
    
    # URL ficticia/referencial. En producción usaríamos la oficial de MMPose ONNX
    rtmpose_url = "https://github.com/open-mmlab/mmpose/releases/download/v1.1.0/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.pth"
    dest_path = os.path.join(models_dir, "rtmpose_m.pth")
    
    # Nota: Si el usuario exige ONNX, descargaríamos el ONNX. Aquí descargamos el PTH o el ONNX.
    print("[INFO] Comprobando pesos de RTMPose...")
    # download_file(rtmpose_url, dest_path) # Comentado para evitar demoras en esta fase experimental
    
def run_rtmpose_tracking(video_path, fps_target=24):
    ensure_rtmpose_models()
    print("[INFO] RTMPose Engine inicializado (Stubs listos para inferencia pesada)")
    # TODO: Implementar inferencia con onnxruntime
    # return tracks_raw, duration
    return {}, 0

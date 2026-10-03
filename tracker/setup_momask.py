import os
import sys
import subprocess
import time

def print_progress(msg, percentage=None):
    if percentage is not None:
        print(f"[PROGRESS] {percentage}")
    print(f"[STATE] {msg}")
    sys.stdout.flush()

def ensure_package(package_name, import_name=None):
    if import_name is None: import_name = package_name
    try:
        __import__(import_name)
    except ImportError:
        print_progress(f"Instalando dependencia: {package_name}...", 10)
        subprocess.check_call([sys.executable, "-m", "pip", "install", package_name])

def main():
    print_progress("Verificando requisitos de MoMask...", 5)
    
    # 1. Asegurar dependencias pesadas
    # Solo instalamos la version CPU de Torch si no existe para mantenerlo liviano, o dejamos que instale el default
    try:
        import torch
    except ImportError:
        print_progress("Instalando PyTorch (Esto puede tardar varios minutos)...", 10)
        # Usamos torch normal. Para CPU-only en portable enviroment se suele usar index-url especifico, 
        # pero usaremos el paquete estandar por simplicidad.
        subprocess.check_call([sys.executable, "-m", "pip", "install", "torch", "torchvision"])

    ensure_package("huggingface_hub")
    
    print_progress("Preparando descarga del modelo MoMask (geedog/momask-codes-models)...", 30)
    
    from huggingface_hub import hf_hub_download
    
    models_dir = os.path.join(os.path.dirname(__file__), 'models', 'momask')
    os.makedirs(models_dir, exist_ok=True)
    
    repo_id = "geedog/momask-codes-models"
    
    # 2. Clonar el repositorio fuente para tener la arquitectura
    momask_code_dir = os.path.join(models_dir, 'momask_codes')
    if not os.path.exists(momask_code_dir):
        print_progress("Clonando código fuente de MoMask (EricGuo5513/momask-codes)...", 20)
        subprocess.check_call(["git", "clone", "https://github.com/EricGuo5513/momask-codes.git", momask_code_dir])
        
        # Instalar dependencias adicionales de MoMask
        print_progress("Instalando dependencias de texto para MoMask (spacy, clip)...", 25)
        subprocess.check_call([sys.executable, "-m", "pip", "install", "spacy", "scipy", "ftfy", "regex", "tqdm"])
        subprocess.check_call([sys.executable, "-m", "pip", "install", "git+https://github.com/openai/CLIP.git"])
        try:
            import spacy
            if not spacy.util.is_package("en_core_web_sm"):
                subprocess.check_call([sys.executable, "-m", "spacy", "download", "en_core_web_sm"])
        except Exception as e:
            print(f"[WARN] No se pudo descargar modelo SpaCy: {e}")
            
    print_progress("Preparando descarga de los pesos de la red neuronal...", 30)
    
    files_to_download = [
        "t2m/rvq_nq6_dc512_nc512_noshare_qdp0.2/meta/mean.npy",
        "t2m/rvq_nq6_dc512_nc512_noshare_qdp0.2/meta/std.npy",
        "t2m/rvq_nq6_dc512_nc512_noshare_qdp0.2/model/net_best_fid.tar",
        "t2m/rvq_nq6_dc512_nc512_noshare_qdp0.2/opt.txt",
        "t2m/t2m_nlayer8_nhead6_ld384_ff1024_cdp0.1_rvq6ns/model/latest.tar",
        "t2m/t2m_nlayer8_nhead6_ld384_ff1024_cdp0.1_rvq6ns/opt.txt",
        "t2m/tres_nlayer8_ld384_ff1024_rvq6ns_cdp0.2_sw/model/net_best_fid.tar",
        "t2m/tres_nlayer8_ld384_ff1024_rvq6ns_cdp0.2_sw/opt.txt",
        "t2m/length_estimator/model/finest.tar"
    ]
    
    total_files = len(files_to_download)
    for i, file_path in enumerate(files_to_download):
        progress = 30 + int((i / total_files) * 60)
        file_basename = os.path.basename(file_path)
        print_progress(f"Descargando {file_basename} ({i+1}/{total_files})...", progress)
        
        try:
            downloaded_path = hf_hub_download(repo_id=repo_id, filename=file_path, local_dir=models_dir)
        except Exception as e:
            print(f"[ERROR] Falló la descarga de {file_path}: {e}")
            sys.exit(1)
            
    print_progress("¡Modelos de MoMask instalados correctamente!", 100)
    time.sleep(1) # Dar tiempo a la UI para procesar el 100%

if __name__ == "__main__":
    main()

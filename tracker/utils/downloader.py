import os
import requests
from tqdm import tqdm

def download_file(url, dest_path):
    if os.path.exists(dest_path):
        print(f"[INFO] El archivo ya existe: {dest_path}")
        return True

    print(f"[INFO] Descargando modelo desde: {url}")
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        total_size = int(response.headers.get('content-length', 0))
        
        with open(dest_path, 'wb') as file, tqdm(
            desc=os.path.basename(dest_path),
            total=total_size,
            unit='iB',
            unit_scale=True,
            unit_divisor=1024,
        ) as bar:
            for data in response.iter_content(chunk_size=1024):
                size = file.write(data)
                bar.update(size)
        return True
    except Exception as e:
        print(f"[ERROR] Fallo en la descarga: {e}")
        if os.path.exists(dest_path):
            os.remove(dest_path)
        return False

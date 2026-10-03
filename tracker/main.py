import argparse
import json
import sys
from utils.math_utils import smooth_tracks

def export_to_vrm_format(tracks_smoothed, duration, output_json):
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
        
    out_data = {"Duracion": duration, "Pistas": pistas_finales}
    with open(output_json, 'w') as f:
        json.dump(out_data, f, indent=2)
    print(f"[EXITO] Archivo guardado en: {output_json}")

def main():
    parser = argparse.ArgumentParser(description="Motor de Animación e Inteligencia Artificial")
    parser.add_argument('--engine', type=str, choices=['mediapipe', 'rtmpose', 'mdm'], default='mediapipe', help='Motor a utilizar')
    parser.add_argument('--input', type=str, help='Ruta del video de entrada')
    parser.add_argument('--prompt', type=str, help='Texto descriptivo (Solo para MDM)')
    parser.add_argument('--output', type=str, required=True, help='Ruta del JSON de salida')
    
    args = parser.parse_args()
    
    print(f"--- Iniciando IA Engine: {args.engine.upper()} ---")
    
    tracks_raw = {}
    duration = 0
    
    if args.engine == 'mediapipe':
        if not args.input:
            print("[ERROR] El motor mediapipe requiere --input")
            sys.exit(1)
        from engines.mediapipe_engine import run_mediapipe_tracking
        tracks_raw, duration = run_mediapipe_tracking(args.input)
        
    elif args.engine == 'rtmpose':
        if not args.input:
            print("[ERROR] El motor rtmpose requiere --input")
            sys.exit(1)
        from engines.rtmpose_engine import run_rtmpose_tracking
        tracks_raw, duration = run_rtmpose_tracking(args.input)
        
    elif args.engine == 'mdm':
        if not args.prompt:
            print("[ERROR] El motor mdm requiere --prompt")
            sys.exit(1)
        from engines.mdm_engine import run_mdm_generation
        tracks_raw, duration = run_mdm_generation(args.prompt)
        
    if not tracks_raw:
        print("[AVISO] No se generaron pistas. Comprueba los stubs o el video.")
        sys.exit(0)
        
    print("[INFO] Aplicando filtro cinemático (Savitzky-Golay)...")
    tracks_smoothed = smooth_tracks(tracks_raw)
    export_to_vrm_format(tracks_smoothed, duration, args.output)

if __name__ == "__main__":
    main()

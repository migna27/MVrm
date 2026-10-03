import argparse
import json
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils.math_utils import smooth_tracks

def export_to_vrm_format(tracks_smoothed, duration, output_json):
    pistas_finales = []
    for bone, keys in tracks_smoothed.items():
        tipo = keys[0].get("Tipo", "HuesoRotacion") if len(keys) > 0 else "HuesoRotacion"
        
        # Limpiar keys antes de guardar
        claves_limpias = []
        for k in keys:
            claves_limpias.append({"Id": k["Id"], "Tiempo": k["Tiempo"], "Valor": k["Valor"]})
            
        pistas_finales.append({
            "Id": f"pista_python_{bone}",
            "Nombre": f"Tracking Python {bone}",
            "Tipo": tipo,
            "Objetivo": bone,
            "Grupo": "SeguimientoCuerpo",
            "Claves": claves_limpias
        })
        
    out_data = {"Duracion": duration, "Pistas": pistas_finales}
    with open(output_json, 'w') as f:
        json.dump(out_data, f, indent=2)
    print(f"[EXITO] Archivo guardado en: {output_json}")

def main():
    parser = argparse.ArgumentParser(description="Motor de Animación e Inteligencia Artificial")
    parser.add_argument('--engine', type=str, choices=['mediapipe', 'rtmpose', 'mdm'], default='mediapipe')
    parser.add_argument('--input', type=str, help='Ruta del video o ID de camara (ej: 0)')
    parser.add_argument('--prompt', type=str, help='Texto descriptivo (Solo para MDM)')
    parser.add_argument('--output', type=str, help='Ruta del JSON de salida (Requerido en modo archivo)')
    
    # Nuevos parametros para Streaming en vivo (VMC/OSC)
    parser.add_argument('--live', action='store_true', help='Activar modo en vivo (cámara a OSC)')
    parser.add_argument('--osc-port', type=int, default=39539, help='Puerto destino OSC (VMC)')
    parser.add_argument('--osc-ip', type=str, default='127.0.0.1', help='IP destino OSC')
    
    args = parser.parse_args()
    
    print(f"--- Iniciando IA Engine: {args.engine.upper()} ---")
    
    osc_client = None
    if args.live:
        try:
            from pythonosc.udp_client import SimpleUDPClient
            osc_client = SimpleUDPClient(args.osc_ip, args.osc_port)
            print(f"[INFO] Streaming OSC VMC hacia {args.osc_ip}:{args.osc_port}")
        except ImportError:
            print("[ERROR] Faltan librerías para OSC. Ejecuta: pip install python-osc")
            sys.exit(1)
            
    if not args.live and not args.output:
        print("[ERROR] Debes especificar --output en modo archivo, o usar --live para modo streaming.")
        sys.exit(1)
    
    tracks_raw = {}
    duration = 0
    
    if args.engine == 'mediapipe':
        inp = args.input if args.input else ("0" if args.live else None)
        if inp is None:
            print("[ERROR] El motor mediapipe requiere --input (o usa --live)")
            sys.exit(1)
        from engines.mediapipe_engine import run_mediapipe_tracking
        tracks_raw, duration = run_mediapipe_tracking(inp, live=args.live, osc_client=osc_client)
        
    elif args.engine == 'rtmpose':
        inp = args.input if args.input else ("0" if args.live else None)
        if inp is None:
            print("[ERROR] El motor rtmpose requiere --input (o usa --live)")
            sys.exit(1)
        from engines.rtmpose_engine import run_rtmpose_tracking
        tracks_raw, duration = run_rtmpose_tracking(inp, live=args.live, osc_client=osc_client)
        
    elif args.engine == 'mdm':
        if not args.prompt:
            print("[ERROR] El motor mdm requiere --prompt")
            sys.exit(1)
        from engines.mdm_engine import run_mdm_generation
        tracks_raw, duration = run_mdm_generation(args.prompt)
        
    if args.live:
        print("[INFO] Streaming finalizado. Cerrando motor.")
        sys.exit(0)
        
    if not tracks_raw:
        print("[AVISO] No se generaron pistas.")
        sys.exit(0)
        
    print("[INFO] Aplicando filtro cinemático (Savitzky-Golay)...")
    tracks_smoothed = smooth_tracks(tracks_raw)
    export_to_vrm_format(tracks_smoothed, duration, args.output)

if __name__ == "__main__":
    main()

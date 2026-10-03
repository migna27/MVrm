import math
import numpy as np

def run_mdm_generation(prompt, live=False, osc_client=None, fps_target=24):
    print(f"[STATE] IA Generativa analizando el prompt: '{prompt}'...")
    
    prompt = prompt.lower()
    duration = 2.0 # Segundos por defecto
    tracks_raw = {}
    
    # Preparar huesos
    bones = ['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg', 
             'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm',
             'spine', 'head']
    for b in bones:
        tracks_raw[b] = []
    tracks_raw['hips'] = [] # Raiz (Posicion global)
    tracks_raw['hips_rot'] = [] # Rotacion global de la raiz
    
    total_frames = int(duration * fps_target)
    
    for f in range(total_frames):
        time_sec = f / fps_target
        t = f / total_frames # Normalizado 0 a 1
        
        # Estado base (Reposo)
        rot_state = {b: [0,0,0] for b in bones}
        root_pos = [0,0,0]
        root_rot = [0,0,0]
        
        # 1. SALTO
        if "salto" in prompt or "saltar" in prompt:
            if t < 0.2: # Preparacion (Agacharse)
                root_pos[1] = -0.2 * (t/0.2)
                rot_state['leftUpperLeg'] = [(t/0.2)*0.5, 0, 0]
                rot_state['rightUpperLeg'] = [(t/0.2)*0.5, 0, 0]
                rot_state['leftLowerLeg'] = [-(t/0.2)*1.0, 0, 0]
                rot_state['rightLowerLeg'] = [-(t/0.2)*1.0, 0, 0]
                rot_state['spine'] = [(t/0.2)*0.3, 0, 0]
            elif t < 0.8: # En el aire
                air_t = (t-0.2)/0.6
                root_pos[1] = math.sin(air_t * math.pi) * 0.8 # Altura del salto (0.8m)
                rot_state['leftUpperLeg'] = [-0.2, 0, 0]
                rot_state['rightUpperLeg'] = [-0.2, 0, 0]
                rot_state['leftLowerLeg'] = [0, 0, 0]
                rot_state['rightLowerLeg'] = [0, 0, 0]
                rot_state['leftUpperArm'] = [0, 0, -1.0] # Brazos arriba
                rot_state['rightUpperArm'] = [0, 0, 1.0]
            else: # Aterrizaje
                land_t = (t-0.8)/0.2
                root_pos[1] = -0.2 * (1.0 - land_t)
                rot_state['leftUpperLeg'] = [(1.0 - land_t)*0.5, 0, 0]
                rot_state['rightUpperLeg'] = [(1.0 - land_t)*0.5, 0, 0]
                rot_state['leftLowerLeg'] = [-(1.0 - land_t)*1.0, 0, 0]
                rot_state['rightLowerLeg'] = [-(1.0 - land_t)*1.0, 0, 0]
                
        # 2. AGACHADO
        elif "agacha" in prompt or "cuclillas" in prompt:
            bend = math.sin(t * math.pi) # Curva suave de ida y vuelta
            root_pos[1] = -0.4 * bend # Baja el centro de masa 40cm
            rot_state['leftUpperLeg'] = [bend * 1.0, 0, 0] # Flexiona cadera
            rot_state['rightUpperLeg'] = [bend * 1.0, 0, 0]
            rot_state['leftLowerLeg'] = [-bend * 2.0, 0, 0] # Flexiona rodilla
            rot_state['rightLowerLeg'] = [-bend * 2.0, 0, 0]
            rot_state['spine'] = [bend * 0.3, 0, 0] # Inclina torso adelante
            rot_state['leftUpperArm'] = [0, 0, -0.2*bend] # Equilibrio brazos
            rot_state['rightUpperArm'] = [0, 0, 0.2*bend]
            
        # 3. GIRO (Spin)
        elif "giro" in prompt or "girar" in prompt or "vuelta" in prompt:
            root_rot = [0, t * math.pi * 2, 0] # Gira 360 grados en el eje Y
            rot_state['leftUpperArm'] = [0, 0, -0.4] # Abre un poco los brazos por inercia
            rot_state['rightUpperArm'] = [0, 0, 0.4]
            
        # Almacenar Keyframes
        for b in bones:
            tracks_raw[b].append({"Id": f"tr_{f}_{b}", "Tiempo": time_sec, "Valor": rot_state[b], "Tipo": "HuesoRotacion"})
            
        tracks_raw['hips'].append({"Id": f"tr_pos_{f}_hips", "Tiempo": time_sec, "Valor": root_pos, "Tipo": "HuesoPosicion"})
        # La rotación del root se aplica a hips en VRM
        tracks_raw['hips_rot'].append({"Id": f"tr_rot_{f}_hips", "Tiempo": time_sec, "Valor": root_rot, "Tipo": "HuesoRotacion"})
        
        if f % 5 == 0:
            print(f"[PROGRESS] {int((f / total_frames) * 100)}")
            
    print("[PROGRESS] 100")
    print(f"[INFO] Animacion sintetizada con exito ({total_frames} frames).")
    return tracks_raw, duration

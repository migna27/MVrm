import * as THREE from 'three';
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { PistaAnimacion, ClaveAnimacion } from '../Tipos';
import { GenerarId } from '../Utilidades';
import { ContextoApp } from '../Principal';

/**
 * GestorVMC: Conecta con el backend WebSocket que hace de puente OSC para 
 * recibir datos del Protocolo VMC (Virtual Motion Capture).
 */
export class GestorVMC {
  private ws: WebSocket | null = null;
  public Estado: 'Desconectado' | 'Conectando' | 'Escuchando' = 'Desconectado';
  
  // Para grabar
  public Grabando = false;
  private PistasGrabacion: Record<string, PistaAnimacion> = {};
  private TiempoInicioGrabacion = 0;

  constructor(private Contexto: typeof ContextoApp) {}

  public Iniciar(Puerto: number = 39539, AlCambiarEstado: (estado: string) => void): void {
    if (this.ws) this.Detener();
    
    this.Estado = 'Conectando';
    AlCambiarEstado(this.Estado);
    
    // Conectar al websocket local expuesto por Vite
    const url = `ws://${window.location.host}/vmc`;
    this.ws = new WebSocket(url);
    
    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({ type: 'start', port: Puerto }));
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'status') {
        if (data.status === 'listening') {
          this.Estado = 'Escuchando';
          AlCambiarEstado(this.Estado);
          this.Contexto.NotificarEstado(`Receptor VMC activo en puerto UDP ${Puerto}`);
        } else {
          this.Estado = 'Desconectado';
          AlCambiarEstado(this.Estado);
        }
      } else if (data.type === 'error') {
        this.Contexto.NotificarEstado(`Error VMC: ${data.message}`);
        this.Detener();
      } else if (data.type === 'osc') {
        this.ProcesarMensajeOSC(data.message);
      }
    };
    
    this.ws.onclose = () => {
      this.Estado = 'Desconectado';
      AlCambiarEstado(this.Estado);
      this.ws = null;
    };
  }

  public Detener(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
      this.ws.close();
    }
    this.ws = null;
    this.Estado = 'Desconectado';
    if (this.Grabando) this.DetenerGrabacion();
  }

  public IniciarGrabacion(): void {
    if (!this.Contexto.Modelos.Vrm) return;
    this.Grabando = true;
    this.PistasGrabacion = {};
    this.TiempoInicioGrabacion = this.Contexto.Animacion.TiempoActual;
    this.Contexto.NotificarEstado('Grabando datos VMC... (Presiona Detener Grabación al terminar)');
  }

  public DetenerGrabacion(): void {
    this.Grabando = false;
    const Pistas = Object.values(this.PistasGrabacion);
    if (Pistas.length > 0) {
      this.Contexto.Animacion.AgregarPistas(Pistas);
      
      // Actualizar duración si nos pasamos
      const MaxTiempo = Math.max(...Pistas.map(p => p.Claves[p.Claves.length - 1].Tiempo));
      if (MaxTiempo > this.Contexto.Animacion.Duracion) {
        this.Contexto.Animacion.Duracion = Math.ceil(MaxTiempo);
      }
      
      this.Contexto.NotificarEstado(`Grabación VMC completada: ${Pistas.length} pistas guardadas.`);
    } else {
      this.Contexto.NotificarEstado('No se recibió ningún dato VMC durante la grabación.');
    }
    this.PistasGrabacion = {};
  }

  private ProcesarMensajeOSC(msg: any[]): void {
    const Direccion = msg[0] as string;
    const Vrm = this.Contexto.Modelos.Vrm;
    if (!Vrm) return;

    if (Direccion === '/VMC/Ext/Bone/Pos') {
      const name = msg[1] as VRMHumanBoneName;
      // Posición (2, 3, 4) y Cuaternión (5, 6, 7, 8) -> px, py, pz, qx, qy, qz, qw
      const qx = msg[5], qy = msg[6], qz = msg[7], qw = msg[8];
      
      const node = Vrm.humanoid?.getNormalizedBoneNode(name);
      if (node) {
        // En VMC, la rotación a veces requiere adaptaciones de espacio, pero probaremos directo 
        // ya que asume coordenadas de Unity (x derecha, y arriba, z adelante)
        // Unity a Three: Unity Left-Handed (x, y, z) -> Three Right-Handed (-x, y, z) para posiciones.
        // Para quaterniones (qx, qy, qz, qw) -> (-qx, qy, qz, -qw) o similar.
        // Pero @pixiv/three-vrm ya lidia con los mapeos si lo forzamos.
        // Usemos la convención estandar empírica:
        const quat = new THREE.Quaternion(-qx, -qy, qz, qw);
        node.quaternion.copy(quat);

        if (this.Grabando) {
          const Euler = new THREE.Euler().setFromQuaternion(node.quaternion, 'XYZ');
          this.GrabarClaveHueso(name, [Euler.x, Euler.y, Euler.z]);
        }
      }
    } 
    else if (Direccion === '/VMC/Ext/Blend/Val') {
      const BlendName = msg[1] as string;
      const Value = msg[2] as number;
      
      Vrm.expressionManager?.setValue(BlendName, Value);
      if (this.Grabando) {
        this.GrabarClaveExpresion(BlendName, Value);
      }
    }
    else if (Direccion === '/VMC/Ext/Blend/Apply') {
      Vrm.expressionManager?.update();
    }
  }

  private GrabarClaveHueso(Hueso: string, Valores: number[]): void {
    const Id = `VMC_Bone_${Hueso}`;
    if (!this.PistasGrabacion[Id]) {
      this.PistasGrabacion[Id] = {
        Id: GenerarId(), Nombre: `VMC Tracking ${Hueso}`, Tipo: 'HuesoRotacion',
        Objetivo: Hueso, Grupo: 'GrabacionVMC', Claves: []
      };
    }
    // Grabar a 24fps aprox (solo añadimos clave si ha pasado suficiente tiempo)
    const Pista = this.PistasGrabacion[Id];
    const TiempoRelativo = this.Contexto.Animacion.TiempoActual - this.TiempoInicioGrabacion;
    const TiempoAbsoluto = this.Contexto.Animacion.TiempoActual;
    
    // Evitar demasiados keyframes, grabar si difiere en tiempo por 1/30 seg
    if (Pista.Claves.length === 0 || (TiempoAbsoluto - Pista.Claves[Pista.Claves.length - 1].Tiempo > 0.03)) {
      Pista.Claves.push({ Id: GenerarId(), Tiempo: TiempoAbsoluto, Valor: Valores });
    }
  }

  private GrabarClaveExpresion(Expresion: string, Valor: number): void {
    const Id = `VMC_Exp_${Expresion}`;
    if (!this.PistasGrabacion[Id]) {
      this.PistasGrabacion[Id] = {
        Id: GenerarId(), Nombre: `VMC Exp ${Expresion}`, Tipo: 'Expresion',
        Objetivo: Expresion, Grupo: 'GrabacionVMC', Claves: []
      };
    }
    const Pista = this.PistasGrabacion[Id];
    const TiempoAbsoluto = this.Contexto.Animacion.TiempoActual;
    if (Pista.Claves.length === 0 || (TiempoAbsoluto - Pista.Claves[Pista.Claves.length - 1].Tiempo > 0.03)) {
      Pista.Claves.push({ Id: GenerarId(), Tiempo: TiempoAbsoluto, Valor: [Valor] });
    }
  }
}

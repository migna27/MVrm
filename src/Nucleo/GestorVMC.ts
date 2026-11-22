// ============================================================================
// GestorVMC.ts — Receptor OSC para protocolo Virtual Motion Capture (VMC)
// Reutiliza objetos matemáticos (0 GC por paquete), permite grabar en vivo sin
// necesitar reproducción previa e integra las pistas en el historial Undo/Redo.
// ============================================================================

import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { PistaAnimacion } from '../Tipos';
import { GenerarId } from '../Utilidades';
import { ComandoImportarAnimacion } from '../Arquitectura/ComandosAnimacion';
import type { ContextoAplicacion } from '../Contexto';

/**
 * GestorVMC: Conecta con el backend WebSocket que hace de puente OSC para
 * recibir datos del Protocolo VMC (Virtual Motion Capture).
 */
export class GestorVMC {
  private ws: WebSocket | null = null;
  public Estado: 'Desconectado' | 'Conectando' | 'Escuchando' = 'Desconectado';

  public Grabando = false;
  private PistasGrabacion: Record<string, PistaAnimacion> = {};
  private TiempoInicioGrabacion = 0;
  private RelojInicioMs = 0;
  private AlCambiarEstadoCb: ((estado: string) => void) | null = null;

  private readonly _Quat = new THREE.Quaternion();
  private readonly _Euler = new THREE.Euler();

  constructor(private Contexto: ContextoAplicacion) {}

  public Iniciar(Puerto: number = 39539, AlCambiarEstado: (estado: string) => void): void {
    if (this.ws) this.Detener();

    this.AlCambiarEstadoCb = AlCambiarEstado;
    this.Estado = 'Conectando';
    AlCambiarEstado(this.Estado);

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
          this.Contexto.NotificarEstado(`Receptor VMC activo en puerto UDP ${Puerto}`, 'exito');
        } else {
          this.Estado = 'Desconectado';
          AlCambiarEstado(this.Estado);
        }
      } else if (data.type === 'error') {
        this.Contexto.NotificarEstado(`Error VMC: ${data.message}`, 'error');
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
    this.AlCambiarEstadoCb?.('Desconectado');
    this.AlCambiarEstadoCb = null;
    if (this.Grabando) this.DetenerGrabacion();
  }

  public IniciarGrabacion(): void {
    if (!this.Contexto.Modelos.Vrm) return;
    this.Grabando = true;
    this.PistasGrabacion = {};
    this.TiempoInicioGrabacion = this.Contexto.Animacion.TiempoActual;
    this.RelojInicioMs = performance.now();
    this.Contexto.NotificarEstado('Grabando datos VMC en tiempo real… (Presiona Detener Grabación al terminar)', 'info');
  }

  public DetenerGrabacion(): void {
    this.Grabando = false;
    const Pistas = Object.values(this.PistasGrabacion);
    this.PistasGrabacion = {};

    if (Pistas.length > 0) {
      const MaxTiempo = Math.max(0.1, ...Pistas.map((p) => p.Claves[p.Claves.length - 1]?.Tiempo ?? 0));
      const Cmd = new ComandoImportarAnimacion(
        this.Contexto.Animacion,
        Pistas,
        {
          TiempoInicio: 0,
          Modo: 'ReemplazarGrupo',
          EscalaTiempo: 1,
          FpsMuestreo: 30,
          Simplificar: false,
          ToleranciaSimplificacion: 0.015,
          GrupoDestino: 'GrabacionVMC'
        },
        MaxTiempo,
        'Grabación VMC'
      );

      if (this.Contexto.Historial) {
        this.Contexto.Historial.Ejecutar(Cmd);
      } else {
        Cmd.Ejecutar();
      }

      const EntradaDur = document.getElementById('EntradaDuracion') as HTMLInputElement | null;
      if (EntradaDur) EntradaDur.value = String(this.Contexto.Animacion.Duracion);

      this.Contexto.NotificarEstado(
        `Grabación VMC completada: ${Pistas.length} pista(s) guardadas.`,
        'exito',
        true
      );
    } else {
      this.Contexto.NotificarEstado('No se recibió ningún dato VMC durante la grabación.', 'aviso');
    }
  }

  private ObtenerTiempoGrabacion(): number {
    const Anim = this.Contexto.Animacion;
    if (Anim.Reproduciendo) return Anim.TiempoActual;

    const T = Math.min(600, Math.max(0, this.TiempoInicioGrabacion + (performance.now() - this.RelojInicioMs) / 1000));
    Anim.TiempoActual = T;
    if (T > Anim.Duracion) {
      Anim.Duracion = Math.ceil(T);
    }
    this.Contexto.RefrescarLineaTiempo();
    return T;
  }

  private ProcesarMensajeOSC(msg: any[]): void {
    const Direccion = msg[0] as string;
    const Vrm = this.Contexto.Modelos.Vrm;
    if (!Vrm) return;

    if (Direccion === '/VMC/Ext/Bone/Pos') {
      const name = msg[1] as VRMHumanBoneName;
      const qx = msg[5], qy = msg[6], qz = msg[7], qw = msg[8];
      const node = Vrm.humanoid?.getNormalizedBoneNode(name);
      if (node) {
        // Asume cuaterniones de Unity, GestorVMC los convierte a ThreeJS (-x, -y, z, w)
        this._Quat.set(-qx, -qy, qz, qw);
        node.quaternion.copy(this._Quat);

        if (this.Grabando) {
          this._Euler.setFromQuaternion(node.quaternion, 'XYZ');
          this.GrabarClaveHueso(name, [this._Euler.x, this._Euler.y, this._Euler.z]);
        }
      }
    } else if (Direccion === '/VMC/Ext/Root/Pos') {
      const px = msg[2], py = msg[3], pz = msg[4];
      const node = Vrm.humanoid?.getNormalizedBoneNode('hips');
      if (node) {
        node.position.set(-px, py, -pz);

        if (this.Grabando) {
          const IdPos = 'VMC_Pos_hips';
          if (!this.PistasGrabacion[IdPos]) {
            this.PistasGrabacion[IdPos] = {
              Id: GenerarId(), Nombre: 'VMC · Posición cadera', Tipo: 'HuesoPosicion',
              Objetivo: 'hips', Grupo: 'GrabacionVMC', Claves: []
            };
          }
          const Pista = this.PistasGrabacion[IdPos];
          const TiempoAbs = this.ObtenerTiempoGrabacion();
          if (Pista.Claves.length === 0 || (TiempoAbs - Pista.Claves[Pista.Claves.length - 1].Tiempo > 0.03)) {
            Pista.Claves.push({
              Id: GenerarId(),
              Tiempo: TiempoAbs,
              Valor: [node.position.x, node.position.y, node.position.z],
              Interpolacion: 'Suave'
            });
          }
        }
      }
    } else if (Direccion === '/VMC/Ext/Blend/Val') {
      const BlendName = msg[1] as string;
      const Value = msg[2] as number;

      this.Contexto.Modelos.EstablecerExpresion(BlendName, Value);
      if (this.Grabando) {
        const ObjetivoResuelto = this.Contexto.Modelos.ResolverNombreExpresion(BlendName) ?? BlendName;
        this.GrabarClaveExpresion(ObjetivoResuelto, Value);
      }
    } else if (Direccion === '/VMC/Ext/Blend/Apply') {
      Vrm.expressionManager?.update();
    }
  }

  private GrabarClaveHueso(Hueso: string, Valores: number[]): void {
    const Id = `VMC_Bone_${Hueso}`;
    if (!this.PistasGrabacion[Id]) {
      this.PistasGrabacion[Id] = {
        Id: GenerarId(), Nombre: `VMC · ${Hueso}`, Tipo: 'HuesoRotacion',
        Objetivo: Hueso, Grupo: 'GrabacionVMC', Claves: []
      };
    }
    const Pista = this.PistasGrabacion[Id];
    const TiempoAbsoluto = this.ObtenerTiempoGrabacion();

    if (Pista.Claves.length === 0 || (TiempoAbsoluto - Pista.Claves[Pista.Claves.length - 1].Tiempo > 0.03)) {
      Pista.Claves.push({ Id: GenerarId(), Tiempo: TiempoAbsoluto, Valor: Valores, Interpolacion: 'Suave' });
    }
  }

  private GrabarClaveExpresion(Expresion: string, Valor: number): void {
    const Id = `VMC_Exp_${Expresion}`;
    if (!this.PistasGrabacion[Id]) {
      this.PistasGrabacion[Id] = {
        Id: GenerarId(), Nombre: `VMC · ${Expresion}`, Tipo: 'Expresion',
        Objetivo: Expresion, Grupo: 'GrabacionVMC', Claves: []
      };
    }
    const Pista = this.PistasGrabacion[Id];
    const TiempoAbsoluto = this.ObtenerTiempoGrabacion();
    if (Pista.Claves.length === 0 || (TiempoAbsoluto - Pista.Claves[Pista.Claves.length - 1].Tiempo > 0.03)) {
      Pista.Claves.push({ Id: GenerarId(), Tiempo: TiempoAbsoluto, Valor: [Valor], Interpolacion: 'Suave' });
    }
  }
}

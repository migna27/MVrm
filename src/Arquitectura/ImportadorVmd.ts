// ============================================================================
// ImportadorVmd.ts — Motor nativo .VMD (MikuMikuDance) directo al Timeline
// Parsea binario VMD (huesos, morphs, cámara y luz), resuelve curvas Bezier,
// aplica Auto-Retarget A-Pose→T-Pose, fusiona huesos twist/semi-estándar,
// ejecuta Two-Bone Foot IK y genera keyframes 100% editables.
// ============================================================================

import * as THREE from 'three';
import type { ContextoAplicacion } from '../Contexto';
import {
  ClaveAnimacion, OpcionesImportacionAnimacion, PistaAnimacion,
  ResultadoImportacion, VistaPreviaImportacion
} from '../Tipos';
import { NOMBRES_HUESOS_LEGIBLES } from '../Nucleo/GestorModelos';
import { GenerarId, Limitar } from '../Utilidades';
import type { EstrategiaImportacion } from './ImportadoresAnimacion';

// ----------------------------------------------------------------------------
// Tipos internos VMD
// ----------------------------------------------------------------------------

export interface ClaveHuesoVmd {
  Nombre: string;
  Cuadro: number;
  Pos: [number, number, number];
  Quat: [number, number, number, number];
  Bezier: Uint8Array; // 64 bytes
}

export interface ClaveMorphVmd {
  Nombre: string;
  Cuadro: number;
  Peso: number;
}

export interface ClaveCamaraVmd {
  Cuadro: number;
  Distancia: number;
  Pos: [number, number, number];
  Rot: [number, number, number];
  Bezier: Uint8Array; // 24 bytes
  Fov: number;
  Ortografica: boolean;
}

export interface ClaveLuzVmd {
  Cuadro: number;
  Color: [number, number, number];
  Dir: [number, number, number];
}

export interface DatosVmd {
  Cabecera: string;
  NombreModelo: string;
  Huesos: ClaveHuesoVmd[];
  Morphs: ClaveMorphVmd[];
  Camaras: ClaveCamaraVmd[];
  Luces: ClaveLuzVmd[];
  MaxCuadro: number;
}

// ----------------------------------------------------------------------------
// Tablas completas de equivalencia MMD (japonés) → VRM humanoide
// ----------------------------------------------------------------------------

const MAPA_HUESOS_SIMPLE: Record<string, string> = {
  '上半身2': 'chest',
  '上半身3': 'upperChest',
  '首': 'neck',
  '頭': 'head',
  '左目': 'leftEye',
  '右目': 'rightEye',
  '左手首': 'leftHand',
  '右手首': 'rightHand',
  '左足': 'leftUpperLeg',
  '左ひざ': 'leftLowerLeg',
  '左足首': 'leftFoot',
  '左つま先': 'leftToes',
  '右足': 'rightUpperLeg',
  '右ひざ': 'rightLowerLeg',
  '右足首': 'rightFoot',
  '右つま先': 'rightToes',
  // Dedos izquierda
  '左親指０': 'leftThumbMetacarpal', '左親指１': 'leftThumbProximal', '左親指２': 'leftThumbDistal',
  '左人指１': 'leftIndexProximal', '左人指２': 'leftIndexIntermediate', '左人指３': 'leftIndexDistal',
  '左中指１': 'leftMiddleProximal', '左中指２': 'leftMiddleIntermediate', '左中指３': 'leftMiddleDistal',
  '左薬指１': 'leftRingProximal', '左薬指２': 'leftRingIntermediate', '左薬指３': 'leftRingDistal',
  '左小指１': 'leftLittleProximal', '左小指２': 'leftLittleIntermediate', '左小指３': 'leftLittleDistal',
  // Dedos derecha
  '右親指０': 'rightThumbMetacarpal', '右親指１': 'rightThumbProximal', '右親指２': 'rightThumbDistal',
  '右人指１': 'rightIndexProximal', '右人指２': 'rightIndexIntermediate', '右人指３': 'rightIndexDistal',
  '右中指１': 'rightMiddleProximal', '右中指２': 'rightMiddleIntermediate', '右中指３': 'rightMiddleDistal',
  '右薬指１': 'rightRingProximal', '右薬指２': 'rightRingIntermediate', '右薬指３': 'rightRingDistal',
  '右小指１': 'rightLittleProximal', '右小指２': 'rightLittleIntermediate', '右小指３': 'rightLittleDistal'
};

const MAPA_MORPHS_VMD: Record<string, string> = {
  'あ': 'aa', 'あ２': 'aa', 'ワ': 'aa',
  'い': 'ih',
  'う': 'ou', 'お': 'oh',
  'え': 'ee',
  'まばたき': 'blink', '笑い目': 'blink', 'にっこり': 'blink',
  'ウィンク': 'blinkLeft', 'ウィンク２': 'blinkLeft', 'ｳｨﾝｸ': 'blinkLeft', 'ｳｨﾝｸ２': 'blinkLeft',
  'ウィンク右': 'blinkRight', 'ウィンク２右': 'blinkRight', 'ｳｨﾝｸ右': 'blinkRight', 'ｳｨﾝｸ２右': 'blinkRight',
  '笑い': 'happy', 'にこり': 'happy', '笑顔': 'happy',
  '怒り': 'angry',
  '困る': 'sad', '悲しみ': 'sad', '哀しみ': 'sad',
  'びっくり': 'surprised', '驚き': 'surprised',
  'なごみ': 'relaxed', 'じと目': 'relaxed'
};

// ----------------------------------------------------------------------------
// Parser binario y curvas Bezier MMD
// ----------------------------------------------------------------------------

function LeerCadenaShiftJis(bytes: Uint8Array, offset: number, length: number, decoder: TextDecoder): string {
  const fin = Math.min(bytes.length, offset + length);
  let realEnd = fin;
  for (let i = offset; i < fin; i++) {
    if (bytes[i] === 0) {
      realEnd = i;
      break;
    }
  }
  return decoder.decode(bytes.subarray(offset, realEnd)).trim();
}

/**
 * Parsea un archivo binario `.vmd` (Vocaloid Motion Data v1 / v2) completo.
 * Soporta archivos parciales que contengan solo cámara, luz, pose o morphs.
 */
export function ParsearVmd(buffer: ArrayBuffer): DatosVmd {
  if (buffer.byteLength < 50) {
    throw new Error('El archivo .vmd está vacío o dañado.');
  }
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const asciiDecoder = new TextDecoder('ascii');
  const sjisDecoder = new TextDecoder('shift-jis');

  const cabecera = asciiDecoder.decode(bytes.subarray(0, 30)).replace(/\0+$/g, '').trim();
  if (!cabecera.startsWith('Vocaloid Motion Data')) {
    throw new Error('Cabecera inválida: no es un archivo Vocaloid Motion Data (.vmd).');
  }

  const lenModelo = cabecera.includes('0002') ? 20 : 10;
  let off = 30;
  const nombreModelo = LeerCadenaShiftJis(bytes, off, lenModelo, sjisDecoder);
  off += lenModelo;

  const huesos: ClaveHuesoVmd[] = [];
  const morphs: ClaveMorphVmd[] = [];
  const camaras: ClaveCamaraVmd[] = [];
  const luces: ClaveLuzVmd[] = [];
  let maxCuadro = 0;

  if (off + 4 <= buffer.byteLength) {
    const boneCount = dv.getUint32(off, true);
    off += 4;
    const maxPosibles = Math.floor((buffer.byteLength - off) / 111);
    const total = Math.min(boneCount, maxPosibles);
    for (let i = 0; i < total; i++) {
      const r = off + i * 111;
      const nombre = LeerCadenaShiftJis(bytes, r, 15, sjisDecoder);
      const cuadro = dv.getUint32(r + 15, true);
      if (cuadro > maxCuadro) maxCuadro = cuadro;
      huesos.push({
        Nombre: nombre,
        Cuadro: cuadro,
        Pos: [dv.getFloat32(r + 19, true), dv.getFloat32(r + 23, true), dv.getFloat32(r + 27, true)],
        Quat: [
          dv.getFloat32(r + 31, true),
          dv.getFloat32(r + 35, true),
          dv.getFloat32(r + 39, true),
          dv.getFloat32(r + 43, true)
        ],
        Bezier: bytes.slice(r + 47, r + 111)
      });
    }
    off += total * 111;
  }

  if (off + 4 <= buffer.byteLength) {
    const morphCount = dv.getUint32(off, true);
    off += 4;
    const maxPosibles = Math.floor((buffer.byteLength - off) / 23);
    const total = Math.min(morphCount, maxPosibles);
    for (let i = 0; i < total; i++) {
      const r = off + i * 23;
      const nombre = LeerCadenaShiftJis(bytes, r, 15, sjisDecoder);
      const cuadro = dv.getUint32(r + 15, true);
      if (cuadro > maxCuadro) maxCuadro = cuadro;
      morphs.push({
        Nombre: nombre,
        Cuadro: cuadro,
        Peso: dv.getFloat32(r + 19, true)
      });
    }
    off += total * 23;
  }

  if (off + 4 <= buffer.byteLength) {
    const camCount = dv.getUint32(off, true);
    off += 4;
    const maxPosibles = Math.floor((buffer.byteLength - off) / 61);
    const total = Math.min(camCount, maxPosibles);
    for (let i = 0; i < total; i++) {
      const r = off + i * 61;
      const cuadro = dv.getUint32(r, true);
      if (cuadro > maxCuadro) maxCuadro = cuadro;
      camaras.push({
        Cuadro: cuadro,
        Distancia: dv.getFloat32(r + 4, true),
        Pos: [dv.getFloat32(r + 8, true), dv.getFloat32(r + 12, true), dv.getFloat32(r + 16, true)],
        Rot: [dv.getFloat32(r + 20, true), dv.getFloat32(r + 24, true), dv.getFloat32(r + 28, true)],
        Bezier: bytes.slice(r + 32, r + 56),
        Fov: dv.getUint32(r + 56, true),
        Ortografica: bytes[r + 60] !== 0
      });
    }
    off += total * 61;
  }

  if (off + 4 <= buffer.byteLength) {
    const lightCount = dv.getUint32(off, true);
    off += 4;
    const maxPosibles = Math.floor((buffer.byteLength - off) / 28);
    const total = Math.min(lightCount, maxPosibles);
    for (let i = 0; i < total; i++) {
      const r = off + i * 28;
      const cuadro = dv.getUint32(r, true);
      if (cuadro > maxCuadro) maxCuadro = cuadro;
      luces.push({
        Cuadro: cuadro,
        Color: [dv.getFloat32(r + 4, true), dv.getFloat32(r + 8, true), dv.getFloat32(r + 12, true)],
        Dir: [dv.getFloat32(r + 16, true), dv.getFloat32(r + 20, true), dv.getFloat32(r + 24, true)]
      });
    }
  }

  return {
    Cabecera: cabecera,
    NombreModelo: nombreModelo,
    Huesos: huesos,
    Morphs: morphs,
    Camaras: camaras,
    Luces: luces,
    MaxCuadro: maxCuadro
  };
}

/** Evalúa una curva Bezier cúbica MMD en x = u ∈ [0,1] mediante búsqueda binaria rápida. */
export function EvaluarBezierMmd(u: number, x1: number, y1: number, x2: number, y2: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (Math.abs(x1 - y1) < 1e-3 && Math.abs(x2 - y2) < 1e-3) return u;

  let lo = 0;
  let hi = 1;
  let t = u;
  for (let i = 0; i < 8; i++) {
    t = 0.5 * (lo + hi);
    const inv = 1 - t;
    const x = 3 * inv * inv * t * x1 + 3 * inv * t * t * x2 + t * t * t;
    if (x < u) lo = t; else hi = t;
  }
  const inv = 1 - t;
  return Limitar(3 * inv * inv * t * y1 + 3 * inv * t * t * y2 + t * t * t, 0, 1);
}

// ----------------------------------------------------------------------------
// Utilidades de muestreo, conversión LH→RH y Foot IK
// ----------------------------------------------------------------------------

function MuestrearHuesosPorCuadro(
  claves: ClaveHuesoVmd[],
  cuadro: number,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion
): void {
  const n = claves.length;
  if (n === 0) {
    outPos.set(0, 0, 0);
    outQuat.identity();
    return;
  }
  if (n === 1 || cuadro <= claves[0].Cuadro) {
    const c = claves[0];
    outPos.set(c.Pos[0], c.Pos[1], -c.Pos[2]);
    outQuat.set(-c.Quat[0], -c.Quat[1], c.Quat[2], c.Quat[3]).normalize();
    return;
  }
  if (cuadro >= claves[n - 1].Cuadro) {
    const c = claves[n - 1];
    outPos.set(c.Pos[0], c.Pos[1], -c.Pos[2]);
    outQuat.set(-c.Quat[0], -c.Quat[1], c.Quat[2], c.Quat[3]).normalize();
    return;
  }

  let lo = 0;
  let hi = n - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (claves[mid + 1].Cuadro <= cuadro) lo = mid + 1;
    else if (claves[mid].Cuadro > cuadro) hi = mid - 1;
    else { lo = mid; break; }
  }
  const idx = Limitar(lo, 0, n - 2);
  const a = claves[idx];
  const b = claves[idx + 1];
  const span = Math.max(1e-4, b.Cuadro - a.Cuadro);
  const u = Limitar((cuadro - a.Cuadro) / span, 0, 1);

  const bz = b.Bezier;
  const ax = EvaluarBezierMmd(u, bz[0] / 127, bz[4] / 127, bz[8] / 127, bz[12] / 127);
  const ay = EvaluarBezierMmd(u, bz[1] / 127, bz[5] / 127, bz[9] / 127, bz[13] / 127);
  const az = EvaluarBezierMmd(u, bz[2] / 127, bz[6] / 127, bz[10] / 127, bz[14] / 127);
  const ar = EvaluarBezierMmd(u, bz[3] / 127, bz[7] / 127, bz[11] / 127, bz[15] / 127);

  outPos.set(
    a.Pos[0] + (b.Pos[0] - a.Pos[0]) * ax,
    a.Pos[1] + (b.Pos[1] - a.Pos[1]) * ay,
    -(a.Pos[2] + (b.Pos[2] - a.Pos[2]) * az)
  );

  _qTmpA.set(-a.Quat[0], -a.Quat[1], a.Quat[2], a.Quat[3]).normalize();
  _qTmpB.set(-b.Quat[0], -b.Quat[1], b.Quat[2], b.Quat[3]).normalize();
  outQuat.copy(_qTmpA).slerp(_qTmpB, ar);
}

function MuestrearMorphPorCuadro(claves: ClaveMorphVmd[], cuadro: number): number {
  const n = claves.length;
  if (n === 0) return 0;
  if (n === 1 || cuadro <= claves[0].Cuadro) return claves[0].Peso;
  if (cuadro >= claves[n - 1].Cuadro) return claves[n - 1].Peso;

  let lo = 0;
  let hi = n - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (claves[mid + 1].Cuadro <= cuadro) lo = mid + 1;
    else if (claves[mid].Cuadro > cuadro) hi = mid - 1;
    else { lo = mid; break; }
  }
  const idx = Limitar(lo, 0, n - 2);
  const a = claves[idx];
  const b = claves[idx + 1];
  const u = Limitar((cuadro - a.Cuadro) / Math.max(1e-4, b.Cuadro - a.Cuadro), 0, 1);
  return Limitar(a.Peso + (b.Peso - a.Peso) * u, 0, 1);
}

const _qTmpA = new THREE.Quaternion();
const _qTmpB = new THREE.Quaternion();

interface MedidasPiernaVrm {
  HipsPosRest: THREE.Vector3;
  LeftLegOffsetFromHips: THREE.Vector3;
  RightLegOffsetFromHips: THREE.Vector3;
  LeftAnkleRestWorld: THREE.Vector3;
  RightAnkleRestWorld: THREE.Vector3;
  LeftL1: number;
  LeftL2: number;
  RightL1: number;
  RightL2: number;
  EscalaPos: number;
}

function MedirEsqueletoVrmParaVmd(ctx: ContextoAplicacion, personajeId?: string): MedidasPiernaVrm | null {
  const p = ctx.Modelos.ObtenerPersonaje(personajeId);
  if (!p) return null;
  ctx.Modelos.RestablecerPose(p.Id);
  p.Vrm.scene.updateMatrixWorld(true);

  const wHips = new THREE.Vector3();
  const wLUp = new THREE.Vector3();
  const wLLow = new THREE.Vector3();
  const wLFoot = new THREE.Vector3();
  const wRUp = new THREE.Vector3();
  const wRLow = new THREE.Vector3();
  const wRFoot = new THREE.Vector3();

  const pH = ctx.Modelos.ObtenerPosicionMundoHueso('hips', p.Id, wHips);
  const pLU = ctx.Modelos.ObtenerPosicionMundoHueso('leftUpperLeg', p.Id, wLUp);
  const pLL = ctx.Modelos.ObtenerPosicionMundoHueso('leftLowerLeg', p.Id, wLLow);
  const pLF = ctx.Modelos.ObtenerPosicionMundoHueso('leftFoot', p.Id, wLFoot);
  const pRU = ctx.Modelos.ObtenerPosicionMundoHueso('rightUpperLeg', p.Id, wRUp);
  const pRL = ctx.Modelos.ObtenerPosicionMundoHueso('rightLowerLeg', p.Id, wRLow);
  const pRF = ctx.Modelos.ObtenerPosicionMundoHueso('rightFoot', p.Id, wRFoot);

  if (!pH || !pLU || !pLL || !pLF || !pRU || !pRL || !pRF) return null;

  const hipsLocal = p.PoseReposo.get('hips')?.Posicion.clone() ?? new THREE.Vector3(0, 0.85, 0);
  // Altura típica cadera en MMD ~ 10.5 unidades -> escala automática adaptada al VRM
  const alturaCaderaReal = Math.max(0.45, Math.abs(wHips.y - p.Vrm.scene.position.y) || hipsLocal.y || 0.85);

  return {
    HipsPosRest: hipsLocal,
    LeftLegOffsetFromHips: wLUp.clone().sub(wHips),
    RightLegOffsetFromHips: wRUp.clone().sub(wHips),
    LeftAnkleRestWorld: wLFoot.clone().sub(p.Vrm.scene.position),
    RightAnkleRestWorld: wRFoot.clone().sub(p.Vrm.scene.position),
    LeftL1: Math.max(0.15, wLLow.distanceTo(wLUp)),
    LeftL2: Math.max(0.15, wLFoot.distanceTo(wLLow)),
    RightL1: Math.max(0.15, wRLow.distanceTo(wRUp)),
    RightL2: Math.max(0.15, wRFoot.distanceTo(wRLow)),
    EscalaPos: alturaCaderaReal / 10.5
  };
}

/**
 * Resuelve Two-Bone Analytical IK para una pierna VRM (pose de reposo colgando hacia -Y, rodilla +Z).
 * Devuelve rotaciones locales XYZ de muslo (upperLeg) y espinilla (lowerLeg) + orientación mundial espinilla.
 */
function ResolverPiernaTwoBoneIK(
  posCaderaMundo: THREE.Vector3,
  rotCaderaMundo: THREE.Quaternion,
  offsetMusloDesdeCadera: THREE.Vector3,
  objetivoTobilloMundo: THREE.Vector3,
  L1: number,
  L2: number,
  rotFkMusloOpcional?: THREE.Quaternion
): { UpperLocal: THREE.Quaternion; LowerLocal: THREE.Quaternion; CalfWorld: THREE.Quaternion } {
  const posMuslo = offsetMusloDesdeCadera.clone().applyQuaternion(rotCaderaMundo).add(posCaderaMundo);
  const objetivo = objetivoTobilloMundo.clone();
  objetivo.y = Math.max(0.03, objetivo.y); // Anti-hundimiento ligero sobre el piso

  const vecObj = objetivo.clone().sub(posMuslo);
  let dist = vecObj.length();
  const maxAlcance = (L1 + L2) * 0.996;
  const minAlcance = Math.max(0.05, Math.abs(L1 - L2) + 0.02);
  dist = Limitar(dist, minAlcance, maxAlcance);
  const dirObj = dist > 1e-5 ? vecObj.clone().normalize() : new THREE.Vector3(0, -1, 0);

  // Ángulos por Ley de Cosenos
  const cosAlfa = Limitar((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
  const alfa = Math.acos(cosAlfa);
  const cosBeta = Limitar((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1);
  const anguloRodilla = Math.PI - Math.acos(cosBeta); // Positivo en X dobla espinilla hacia -Z (atrás)

  // Dirección delantera preferida de la rodilla (pole vector)
  const poleForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotCaderaMundo);
  if (rotFkMusloOpcional) {
    const dirFk = new THREE.Vector3(0, 0, 1).applyQuaternion(rotFkMusloOpcional).applyQuaternion(rotCaderaMundo);
    poleForward.lerp(dirFk, 0.35);
  }
  // Ortogonalizar poleForward respecto a dirObj
  const polePerp = poleForward.clone().addScaledVector(dirObj, -poleForward.dot(dirObj));
  if (polePerp.lengthSq() < 1e-4) {
    polePerp.set(0, 0, 1);
  } else {
    polePerp.normalize();
  }

  // Eje lateral X del muslo = up(-dirObj) × forward(polePerp)
  const negDir = dirObj.clone().negate(); // +Y local apunta hacia arriba
  const ejeX = new THREE.Vector3().crossVectors(negDir, polePerp).normalize();
  if (ejeX.lengthSq() < 1e-4) ejeX.set(1, 0, 0);

  // Base directa sin flexión alfa
  const zSinAlfa = new THREE.Vector3().crossVectors(ejeX, negDir).normalize();
  const matBase = new THREE.Matrix4().makeBasis(ejeX, negDir, zSinAlfa);
  const qMusloBase = new THREE.Quaternion().setFromRotationMatrix(matBase);

  // Flexión alfa del muslo hacia adelante (-X local levanta pierna hacia +Z)
  const qFlexAlfa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -alfa);
  const qMusloMundo = qMusloBase.multiply(qFlexAlfa);

  const upperLocal = rotCaderaMundo.clone().invert().multiply(qMusloMundo).normalize();
  const lowerLocal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), anguloRodilla);
  const calfWorld = qMusloMundo.clone().multiply(lowerLocal).normalize();

  return { UpperLocal: upperLocal, LowerLocal: lowerLocal, CalfWorld: calfWorld };
}

// ----------------------------------------------------------------------------
// Conversión de VMD completo → Pistas animables del Timeline
// ----------------------------------------------------------------------------

function AgruparHuesosVmd(huesos: ClaveHuesoVmd[]): Map<string, ClaveHuesoVmd[]> {
  const mapa = new Map<string, ClaveHuesoVmd[]>();
  for (const c of huesos) {
    let lista = mapa.get(c.Nombre);
    if (!lista) {
      lista = [];
      mapa.set(c.Nombre, lista);
    }
    lista.push(c);
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => a.Cuadro - b.Cuadro);
  }
  return mapa;
}

function AgruparMorphsVmd(morphs: ClaveMorphVmd[]): Map<string, ClaveMorphVmd[]> {
  const mapa = new Map<string, ClaveMorphVmd[]>();
  for (const c of morphs) {
    let lista = mapa.get(c.Nombre);
    if (!lista) {
      lista = [];
      mapa.set(c.Nombre, lista);
    }
    lista.push(c);
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => a.Cuadro - b.Cuadro);
  }
  return mapa;
}

function HayVariacionSerie(serie: number[][], umbral: number): boolean {
  if (serie.length === 0) return false;
  const d0 = serie[0].length;
  for (const v of serie) {
    for (let i = 0; i < d0; i++) {
      if (Math.abs(v[i]) > umbral || Math.abs(v[i] - serie[0][i]) > umbral) return true;
    }
  }
  return false;
}

/**
 * Estrategia de importación binaria nativa `.vmd` integrada en `ServicioImportacion`.
 */
export class ImportadorVmd implements EstrategiaImportacion {
  public readonly NombreFormato = 'VMD (MikuMikuDance)';
  public readonly Extensiones = ['.vmd'];
  private readonly CacheVmd = new WeakMap<File, DatosVmd>();

  public PuedeImportar(archivo: File): boolean {
    return archivo.name.toLowerCase().endsWith('.vmd');
  }

  private async ObtenerDatos(archivo: File): Promise<DatosVmd> {
    let datos = this.CacheVmd.get(archivo);
    if (!datos) {
      datos = ParsearVmd(await archivo.arrayBuffer());
      this.CacheVmd.set(archivo, datos);
    }
    return datos;
  }

  public async Previsualizar(archivo: File): Promise<VistaPreviaImportacion> {
    const vmd = await this.ObtenerDatos(archivo);
    const huesosUnicos = new Set(vmd.Huesos.map((h) => h.Nombre));
    const morphsUnicos = new Set(vmd.Morphs.map((m) => m.Nombre));
    const pistasEst =
      huesosUnicos.size +
      morphsUnicos.size +
      (vmd.Camaras.length > 0 ? 4 : 0) +
      (vmd.Luces.length > 0 ? 1 : 0);

    return {
      Nombre: archivo.name,
      Formato: `${this.NombreFormato} · Huesos: ${huesosUnicos.size}, Morphs: ${morphsUnicos.size}, Cám: ${vmd.Camaras.length}, Luz: ${vmd.Luces.length}`,
      Duracion: Math.max(0.25, vmd.MaxCuadro / 30),
      TotalPistas: Math.max(1, pistasEst),
      TotalClavesEstimado: vmd.Huesos.length + vmd.Morphs.length + vmd.Camaras.length * 4 + vmd.Luces.length
    };
  }

  public async Importar(
    archivo: File,
    opciones: OpcionesImportacionAnimacion,
    ctx: ContextoAplicacion
  ): Promise<ResultadoImportacion> {
    const vmd = await this.ObtenerDatos(archivo);
    const destinoPers = opciones.PersonajeId ?? ctx.Modelos.PersonajeActivoId ?? undefined;
    const persObj = ctx.Modelos.ObtenerPersonaje(destinoPers);

    if ((vmd.Huesos.length > 0 || vmd.Morphs.length > 0) && !persObj) {
      throw new Error('Carga primero un modelo VRM antes de importar movimiento o expresiones .vmd.');
    }

    const usarTwist = opciones.IntegrarTwist ?? true;
    const usarRetargetAPose = opciones.AutoRetargetAPose ?? true;
    const usarFootIk = opciones.UsarFootIK ?? true;
    const incluirCamara = opciones.IncluirCamaraVmd ?? true;
    const incluirLuces = opciones.IncluirLucesVmd ?? true;
    const velocidad = Limitar(1 / (opciones.EscalaTiempo || 1), 0.1, 8);
    const escalaTiempo = Limitar(opciones.EscalaTiempo || 1, 0.1, 8);
    const fps = Limitar(opciones.FpsMuestreo || 24, 5, 60);

    const pistasGeneradas: PistaAnimacion[] = [];
    const prefijoGrupo = ctx.Animacion.NombreGrupo(opciones.GrupoDestino);
    const prefijoPers = persObj && ctx.Modelos.Personajes.length > 1
      ? `[${persObj.Nombre.replace(/\.vrm$/i, '').slice(0, 12)}] `
      : '';

    const medidas = persObj ? MedirEsqueletoVrmParaVmd(ctx, persObj.Id) : null;
    const escalaPos = opciones.EscalaPosicionVmd ?? medidas?.EscalaPos ?? 0.08;

    // 1. Pistas de Huesos y Morphs
    let clavesOriginales = 0;
    let clavesFinales = 0;

    if (persObj && (vmd.Huesos.length > 0 || vmd.Morphs.length > 0)) {
      const porHueso = AgruparHuesosVmd(vmd.Huesos);
      const porMorph = AgruparMorphsVmd(vmd.Morphs);

      const esPoseUnica = vmd.MaxCuadro === 0;
      const duracionMotion = Math.max(0.05, vmd.MaxCuadro / 30);
      const totalMuestras = esPoseUnica ? 1 : Math.max(2, Math.round((duracionMotion * escalaTiempo) * fps) + 1);
      const tiempos: number[] = [];
      const cuadros: number[] = [];

      for (let i = 0; i < totalMuestras; i++) {
        const tOut = esPoseUnica ? 0 : Math.min(duracionMotion * escalaTiempo, i / fps);
        tiempos.push(Math.max(0, opciones.TiempoInicio + tOut));
        cuadros.push(esPoseUnica ? 0 : Math.min(vmd.MaxCuadro, (tOut * velocidad) * 30));
      }

      const huesosVrmActivos = new Set(ctx.Modelos.ObtenerTodosHuesosDisponibles(persObj.Id));
      const serieRot = new Map<string, number[][]>();
      const seriePosCadera: number[][] = [];

      const qAPoseIzq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 6);
      const qAPoseDer = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 6);

      // Vectores y cuaterniones temporales reutilizables
      const pTmp = new THREE.Vector3();
      const qTmp = new THREE.Quaternion();
      const qRaizTotal = new THREE.Quaternion();
      const pRaizTotal = new THREE.Vector3();
      const qCaderaFinal = new THREE.Quaternion();
      const qCuerpoInf = new THREE.Quaternion();
      const qColumna = new THREE.Quaternion();
      const qIkL = new THREE.Quaternion();
      const qIkR = new THREE.Quaternion();
      const pIkL = new THREE.Vector3();
      const pIkR = new THREE.Vector3();
      const qHombro = new THREE.Quaternion();
      const qBrazo = new THREE.Quaternion();
      const qCodo = new THREE.Quaternion();
      const qTwist = new THREE.Quaternion();
      const qOjoAmbos = new THREE.Quaternion();
      const eTmp = new THREE.Euler();

      const LeerHueso = (nombre: string, f: number, outQ: THREE.Quaternion, outP?: THREE.Vector3): boolean => {
        const lista = porHueso.get(nombre);
        if (!lista) {
          outQ.identity();
          outP?.set(0, 0, 0);
          return false;
        }
        MuestrearHuesosPorCuadro(lista, f, outP ?? pTmp, outQ);
        return true;
      };

      const RegistrarRot = (huesoVrm: string, q: THREE.Quaternion) => {
        if (!huesosVrmActivos.has(huesoVrm)) return;
        eTmp.setFromQuaternion(q, 'XYZ');
        let lista = serieRot.get(huesoVrm);
        if (!lista) {
          lista = [];
          serieRot.set(huesoVrm, lista);
        }
        lista.push([eTmp.x, eTmp.y, eTmp.z]);
      };

      const tieneIkIzq = porHueso.has('左足ＩＫ');
      const tieneIkDer = porHueso.has('右足ＩＫ');

      for (let m = 0; m < cuadros.length; m++) {
        const f = cuadros[m];

        // A. Cadena raíz y cadera (全ての親 -> センター -> グルーブ -> 腰 + 下半身)
        qRaizTotal.identity();
        pRaizTotal.set(0, 0, 0);
        for (const nombreRaiz of ['全ての親', '操作中心', 'センター', 'グルーブ', '腰']) {
          if (LeerHueso(nombreRaiz, f, qTmp, pTmp)) {
            pTmp.multiplyScalar(escalaPos).applyQuaternion(qRaizTotal);
            pRaizTotal.add(pTmp);
            qRaizTotal.multiply(qTmp);
          }
        }

        const hayInf = LeerHueso('下半身', f, qCuerpoInf);
        qCaderaFinal.copy(qRaizTotal).multiply(qCuerpoInf).normalize();
        RegistrarRot('hips', qCaderaFinal);

        const baseY = medidas?.HipsPosRest.y ?? 0.85;
        const baseX = medidas?.HipsPosRest.x ?? 0;
        const baseZ = medidas?.HipsPosRest.z ?? 0;
        const posCaderaMundo = new THREE.Vector3(baseX + pRaizTotal.x, baseY + pRaizTotal.y, baseZ + pRaizTotal.z);
        seriePosCadera.push([posCaderaMundo.x, posCaderaMundo.y, posCaderaMundo.z]);

        // B. Columna superior (上半身 compensado con inverso de 下半身)
        const haySup = LeerHueso('上半身', f, qColumna);
        if (hayInf || haySup) {
          const qSpineFinal = qCuerpoInf.clone().invert().multiply(qColumna).normalize();
          RegistrarRot('spine', qSpineFinal);
        }

        // C. Hombros y brazos (con fusión semi-estándar + Auto-Retarget A→T)
        for (const lado of ['L', 'R'] as const) {
          const j = lado === 'L' ? '左' : '右';
          const v = lado === 'L' ? 'left' : 'right';

          const hayS1 = LeerHueso(`${j}肩P`, f, qHombro);
          const hayS2 = LeerHueso(`${j}肩`, f, qTmp);
          if (hayS1 || hayS2) {
            RegistrarRot(`${v}Shoulder`, qHombro.multiply(qTmp).normalize());
          }

          const hayArm = LeerHueso(`${j}腕`, f, qBrazo);
          const hayArmTw = usarTwist && LeerHueso(`${j}腕捩`, f, qTwist);
          if (hayArm || hayArmTw || usarRetargetAPose) {
            if (hayArmTw) qBrazo.multiply(qTwist);
            if (usarRetargetAPose) {
              qBrazo.premultiply(lado === 'L' ? qAPoseIzq : qAPoseDer);
            }
            if (hayArm || hayArmTw || vmd.MaxCuadro > 0) {
              RegistrarRot(`${v}UpperArm`, qBrazo.normalize());
            }
          }

          const hayElb = LeerHueso(`${j}ひじ`, f, qCodo);
          const hayHandTw = usarTwist && LeerHueso(`${j}手捩`, f, qTwist);
          if (hayElb || hayHandTw) {
            if (hayHandTw) qCodo.multiply(qTwist);
            RegistrarRot(`${v}LowerArm`, qCodo.normalize());
          }
        }

        // D. Piernas (Foot IK analítico cuando hay 足ＩＫ, o FK directo)
        const usarIkL = usarFootIk && tieneIkIzq && medidas;
        const usarIkR = usarFootIk && tieneIkDer && medidas;

        if (usarIkL && medidas) {
          LeerHueso('左足ＩＫ', f, qIkL, pIkL);
          const targetL = medidas.LeftAnkleRestWorld.clone().addScaledVector(pIkL, escalaPos);
          LeerHueso('左足', f, qTmp);
          const ikRes = ResolverPiernaTwoBoneIK(
            posCaderaMundo,
            qCaderaFinal,
            medidas.LeftLegOffsetFromHips,
            targetL,
            medidas.LeftL1,
            medidas.LeftL2,
            porHueso.has('左足') ? qTmp : undefined
          );
          RegistrarRot('leftUpperLeg', ikRes.UpperLocal);
          RegistrarRot('leftLowerLeg', ikRes.LowerLocal);

          if (porHueso.has('左足首') || porHueso.has('左足ＩＫ')) {
            LeerHueso('左足首', f, qTmp);
            const qPieMundo = qRaizTotal.clone().multiply(qIkL).multiply(qTmp);
            const qPieLocal = ikRes.CalfWorld.clone().invert().multiply(qPieMundo).normalize();
            RegistrarRot('leftFoot', qPieLocal);
          }
        }

        if (usarIkR && medidas) {
          LeerHueso('右足ＩＫ', f, qIkR, pIkR);
          const targetR = medidas.RightAnkleRestWorld.clone().addScaledVector(pIkR, escalaPos);
          LeerHueso('右足', f, qTmp);
          const ikRes = ResolverPiernaTwoBoneIK(
            posCaderaMundo,
            qCaderaFinal,
            medidas.RightLegOffsetFromHips,
            targetR,
            medidas.RightL1,
            medidas.RightL2,
            porHueso.has('右足') ? qTmp : undefined
          );
          RegistrarRot('rightUpperLeg', ikRes.UpperLocal);
          RegistrarRot('rightLowerLeg', ikRes.LowerLocal);

          if (porHueso.has('右足首') || porHueso.has('右足ＩＫ')) {
            LeerHueso('右足首', f, qTmp);
            const qPieMundo = qRaizTotal.clone().multiply(qIkR).multiply(qTmp);
            const qPieLocal = ikRes.CalfWorld.clone().invert().multiply(qPieMundo).normalize();
            RegistrarRot('rightFoot', qPieLocal);
          }
        }

        // E. Huesos simples + 両目 compuesto
        const tieneAmbosOjos = LeerHueso('両目', f, qOjoAmbos);
        for (const [jNombre, vNombre] of Object.entries(MAPA_HUESOS_SIMPLE)) {
          if (usarIkL && (vNombre === 'leftUpperLeg' || vNombre === 'leftLowerLeg' || vNombre === 'leftFoot')) continue;
          if (usarIkR && (vNombre === 'rightUpperLeg' || vNombre === 'rightLowerLeg' || vNombre === 'rightFoot')) continue;

          if (vNombre === 'leftEye' || vNombre === 'rightEye') {
            const tieneInd = LeerHueso(jNombre, f, qTmp);
            if (tieneInd || tieneAmbosOjos) {
              RegistrarRot(vNombre, qOjoAmbos.clone().multiply(qTmp).normalize());
            }
            continue;
          }
          if (LeerHueso(jNombre, f, qTmp)) {
            RegistrarRot(vNombre, qTmp);
          }
        }
      }

      // Convertir series de huesos a pistas con simplificación RDP opcional
      for (const [huesoVrm, serie] of serieRot) {
        if (!HayVariacionSerie(serie, 0.008)) continue;
        let claves: ClaveAnimacion[] = tiempos.map((t, i) => ({
          Id: GenerarId(),
          Tiempo: t,
          Valor: serie[i],
          Interpolacion: ctx.Estado.InterpolacionPorDefecto
        }));
        clavesOriginales += claves.length;
        if (opciones.Simplificar) {
          claves = ctx.Animacion.SimplificarClaves(claves, opciones.ToleranciaSimplificacion);
        }
        clavesFinales += claves.length;
        pistasGeneradas.push({
          Id: GenerarId(),
          Nombre: `${prefijoPers}${prefijoGrupo} · ${NOMBRES_HUESOS_LEGIBLES[huesoVrm] ?? huesoVrm}`,
          Tipo: 'HuesoRotacion',
          Objetivo: huesoVrm,
          Grupo: opciones.GrupoDestino,
          PersonajeId: persObj.Id,
          Claves: claves
        });
      }

      if (HayVariacionSerie(seriePosCadera, 0.004)) {
        let clavesPos: ClaveAnimacion[] = tiempos.map((t, i) => ({
          Id: GenerarId(),
          Tiempo: t,
          Valor: seriePosCadera[i],
          Interpolacion: ctx.Estado.InterpolacionPorDefecto
        }));
        clavesOriginales += clavesPos.length;
        if (opciones.Simplificar) {
          clavesPos = ctx.Animacion.SimplificarClaves(clavesPos, opciones.ToleranciaSimplificacion * 0.5);
        }
        clavesFinales += clavesPos.length;
        pistasGeneradas.push({
          Id: GenerarId(),
          Nombre: `${prefijoPers}${prefijoGrupo} · Posición cadera`,
          Tipo: 'HuesoPosicion',
          Objetivo: 'hips',
          Grupo: opciones.GrupoDestino,
          PersonajeId: persObj.Id,
          Claves: clavesPos
        });
      }

      // F. Morphs / Expresiones (coalescencia de duplicados hacia expresión VRM única)
      const disponiblesExp = new Set(ctx.Modelos.ObtenerExpresiones(persObj.Id).map((e) => e.toLowerCase()));
      const seriesExp = new Map<string, number[]>();

      for (const [jMorph, clavesM] of porMorph) {
        const aliasStd = MAPA_MORPHS_VMD[jMorph];
        const objetivoExp = aliasStd
          ? (ctx.Modelos.ResolverNombreExpresion(aliasStd, persObj.Id) ?? aliasStd)
          : (disponiblesExp.has(jMorph.toLowerCase()) ? jMorph : null);
        if (!objetivoExp) continue;

        let acum = seriesExp.get(objetivoExp);
        if (!acum) {
          acum = new Array<number>(cuadros.length).fill(0);
          seriesExp.set(objetivoExp, acum);
        }
        for (let m = 0; m < cuadros.length; m++) {
          acum[m] = Math.max(acum[m], MuestrearMorphPorCuadro(clavesM, cuadros[m]));
        }
      }

      for (const [expVrm, serie] of seriesExp) {
        if (!serie.some((v) => v > 0.01)) continue;
        let clavesE: ClaveAnimacion[] = tiempos.map((t, i) => ({
          Id: GenerarId(),
          Tiempo: t,
          Valor: [serie[i]],
          Interpolacion: 'Lineal'
        }));
        clavesOriginales += clavesE.length;
        if (opciones.Simplificar) {
          clavesE = ctx.Animacion.SimplificarClaves(clavesE, opciones.ToleranciaSimplificacion);
        }
        clavesFinales += clavesE.length;
        pistasGeneradas.push({
          Id: GenerarId(),
          Nombre: `${prefijoPers}${prefijoGrupo} · ${expVrm}`,
          Tipo: 'Expresion',
          Objetivo: expVrm,
          Grupo: opciones.GrupoDestino,
          PersonajeId: persObj.Id,
          Claves: clavesE
        });
      }
    }

    // 2. Pistas de Cámara MMD (Posición, Objetivo, Roll, FOV) con detección de cortes instantáneos
    if (incluirCamara && vmd.Camaras.length > 0) {
      const cams = [...vmd.Camaras].sort((a, b) => a.Cuadro - b.Cuadro);
      const scaleCam = escalaPos;
      const clPos: ClaveAnimacion[] = [];
      const clObj: ClaveAnimacion[] = [];
      const clRoll: ClaveAnimacion[] = [];
      const clFov: ClaveAnimacion[] = [];

      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      const offset = new THREE.Vector3();
      const target = new THREE.Vector3();

      for (let i = 0; i < cams.length; i++) {
        const c = cams[i];
        const sig = cams[i + 1];
        const esCorte = Boolean(sig && sig.Cuadro - c.Cuadro <= 1);
        const interp = esCorte ? 'Escalon' : 'Suave';
        const t = Math.max(0, opciones.TiempoInicio + (c.Cuadro / 30) * escalaTiempo);

        // Conversión MMD → Three.js (target en +Z mirror, distancia positiva hacia +Z)
        target.set(c.Pos[0] * scaleCam, c.Pos[1] * scaleCam, -c.Pos[2] * scaleCam);
        euler.set(c.Rot[0], c.Rot[1], 0, 'YXZ');
        offset.set(0, 0, -c.Distancia * scaleCam).applyEuler(euler);
        const camPos = target.clone().add(offset);

        clPos.push({ Id: GenerarId(), Tiempo: t, Valor: [camPos.x, camPos.y, camPos.z], Interpolacion: interp });
        clObj.push({ Id: GenerarId(), Tiempo: t, Valor: [target.x, target.y, target.z], Interpolacion: interp });
        clRoll.push({ Id: GenerarId(), Tiempo: t, Valor: [-c.Rot[2]], Interpolacion: interp });
        clFov.push({ Id: GenerarId(), Tiempo: t, Valor: [Limitar(c.Fov || 40, 10, 120)], Interpolacion: interp });
      }

      clavesOriginales += cams.length * 4;
      const finPos = opciones.Simplificar ? ctx.Animacion.SimplificarClaves(clPos, 0.008) : clPos;
      const finObj = opciones.Simplificar ? ctx.Animacion.SimplificarClaves(clObj, 0.008) : clObj;
      const finRoll = opciones.Simplificar ? ctx.Animacion.SimplificarClaves(clRoll, 0.006) : clRoll;
      const finFov = opciones.Simplificar ? ctx.Animacion.SimplificarClaves(clFov, 0.25) : clFov;
      clavesFinales += finPos.length + finObj.length + finRoll.length + finFov.length;

      pistasGeneradas.push(
        { Id: GenerarId(), Nombre: `${prefijoGrupo} · Cámara Posición`, Tipo: 'CamaraPosicion', Objetivo: 'Posición', Grupo: opciones.GrupoDestino, Claves: finPos },
        { Id: GenerarId(), Nombre: `${prefijoGrupo} · Cámara Objetivo`, Tipo: 'CamaraObjetivo', Objetivo: 'Objetivo', Grupo: opciones.GrupoDestino, Claves: finObj },
        { Id: GenerarId(), Nombre: `${prefijoGrupo} · Cámara Roll`, Tipo: 'CamaraRoll', Objetivo: 'Roll', Grupo: opciones.GrupoDestino, Claves: finRoll },
        { Id: GenerarId(), Nombre: `${prefijoGrupo} · Cámara FOV`, Tipo: 'CamaraFOV', Objetivo: 'Campo de Visión', Grupo: opciones.GrupoDestino, Claves: finFov }
      );
    }

    // 3. Pistas de Luz MMD (intensidad calculada desde luminancia RGB)
    if (incluirLuces && vmd.Luces.length > 0) {
      const lucesOrd = [...vmd.Luces].sort((a, b) => a.Cuadro - b.Cuadro);
      const clLuz: ClaveAnimacion[] = lucesOrd.map((l) => {
        const t = Math.max(0, opciones.TiempoInicio + (l.Cuadro / 30) * escalaTiempo);
        const lum = Limitar((0.2126 * l.Color[0] + 0.7152 * l.Color[1] + 0.0722 * l.Color[2]) * 2.8, 0.1, 5.0);
        return { Id: GenerarId(), Tiempo: t, Valor: [lum], Interpolacion: 'Lineal' };
      });
      clavesOriginales += clLuz.length;
      clavesFinales += clLuz.length;
      pistasGeneradas.push({
        Id: GenerarId(),
        Nombre: `${prefijoGrupo} · Luz Direccional`,
        Tipo: 'Luz',
        Objetivo: 'LuzDireccional',
        Grupo: opciones.GrupoDestino,
        Claves: clLuz
      });
    }

    if (pistasGeneradas.length === 0) {
      throw new Error('No se encontraron datos de movimiento, rostro, cámara o luz compatibles en el archivo .vmd.');
    }

    return {
      Nombre: archivo.name,
      Formato: this.NombreFormato,
      Pistas: pistasGeneradas,
      DuracionClip: Math.max(0.25, (vmd.MaxCuadro / 30) * escalaTiempo),
      ClavesOriginales: clavesOriginales,
      ClavesFinales: clavesFinales
    };
  }
}

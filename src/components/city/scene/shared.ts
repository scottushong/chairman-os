import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
} from 'three'

/**
 * 3D 씬(Phase 8 G-2a)이 함께 쓰는 재질 · 형상 · 하늘 상태.
 *
 * 건물 열 채 · 사람 스물넷이 저마다 재질을 만들면 셰이더 전환이 수백 번이 된다 — 같은 대리석,
 * 같은 황동은 **한 벌**만 둔다. 이 모듈은 ssr:false 로만 읽히지만, 캔버스(document)가 필요한
 * 창 무늬 텍스처는 첫 사용 때 만든다.
 */

/* ------------------------------------------------------------------ 하늘 상태 */

/**
 * 하늘 전환의 현재 값. SkyRig가 매 프레임 목표로 lerp 하고, 건물 창 · 가로등 · 차 전조등이 읽는다.
 * React 상태로 두면 1초에 60번 다시 그린다 — 그래서 프레임 루프만 만지는 가변 객체다.
 */
export const skyState = { night: 0 }

/* ------------------------------------------------------------------ 재질 */

const std = (color: string, roughness: number, metalness = 0, extra: Partial<MeshStandardMaterial> = {}) =>
  Object.assign(new MeshStandardMaterial({ color, roughness, metalness }), extra)

export const MAT = {
  ground: std('#23201c', 0.95),
  sidewalk: std('#3a352e', 0.85),
  asphalt: std('#0d0d0f', 0.8),
  laneLine: std('#bfb49c', 0.6),
  marble: std('#e9e4da', 0.26),
  marbleShade: std('#d6cfc2', 0.32),
  brass: std('#b08d57', 0.26, 1),
  brassDark: std('#8c6d40', 0.38, 1),
  concrete: std('#9d978d', 0.92),
  concreteDark: std('#6c665e', 0.95),
  dirt: std('#3b2d21', 1),
  rebar: std('#7b4a2c', 0.55, 0.6),
  crane: std('#c69a3e', 0.55, 0.35),
  steel: std('#8e959b', 0.45, 0.75),
  lampPost: std('#2a2520', 0.5, 0.6),
  signPanel: std('#1b1a18', 0.5, 0.2),
  paper: std('#f4f1ea', 0.6),
  wood: std('#4a3526', 0.7),
  distant: std('#121318', 0.9, 0.1, { emissive: new Color('#ffcf8a'), emissiveIntensity: 0 }),
  // 가로등 · 전조등. 밤에 emissive를 크게 올려 bloom 문턱을 넘긴다.
  bulb: std('#fff1d6', 0.4, 0, { emissive: new Color('#ffd49a'), emissiveIntensity: 0.3 }),
  screen: std('#cfe6ff', 0.3, 0, { emissive: new Color('#9fd0ff'), emissiveIntensity: 0.8 }),
  cyan: std('#34e1ff', 0.3, 0, { emissive: new Color('#34e1ff'), emissiveIntensity: 2.2 }),
  progressBg: std('#15130f', 0.8),
  progressFill: std('#e8c27a', 0.4, 0.3, { emissive: new Color('#e8c27a'), emissiveIntensity: 1.2 }),
  car: std('#cbb58a', 0.32, 0.65),
  carGlass: std('#1a2228', 0.15, 0.8),
  tire: std('#111111', 0.9),
  blob: new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false }),
}

/** 사람 옷 색 — 색마다 재질 하나를 나눠 쓴다. */
const clothCache = new Map<string, MeshStandardMaterial>()
export function cloth(color: string, roughness = 0.75, metalness = 0): MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`
  let m = clothCache.get(key)
  if (!m) {
    m = std(color, roughness, metalness)
    clothCache.set(key, m)
  }
  return m
}

/* ------------------------------------------------------------------ 형상 */

/** 밑면이 y=0 에 놓인 단위 상자 — 높이만 scale.y 로 바꾸면 땅에서 자란다. */
export const BOX_BASE = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
export const BOX = new BoxGeometry(1, 1, 1)
/** 위 끝이 y=0 — 어깨 · 엉덩이에서 매달리는 팔다리. */
export const BOX_HANG = new BoxGeometry(1, 1, 1).translate(0, -0.5, 0)
export const SPHERE = new SphereGeometry(1, 14, 10)
export const SPHERE_LO = new SphereGeometry(1, 8, 6)
export const CAPSULE = new CapsuleGeometry(0.38, 0.7, 4, 10)
export const CYL = new CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0)
export const DISC = new CircleGeometry(1, 20).rotateX(-Math.PI / 2)
export const PYRAMID = new ConeGeometry(1, 1, 4).translate(0, 0.5, 0).rotateY(Math.PI / 4)

/* ------------------------------------------------------------------ 창 무늬 */

let windowTex: CanvasTexture | null = null

/**
 * 밤의 창 — 켜진 층 · 꺼진 칸이 섞인 16층 × 8칸 무늬. 커튼월 전체가 한 덩어리로 빛나면
 * 전등갑처럼 보인다. 난수는 씨앗 고정(매번 같은 도시).
 */
export function windowTexture(): CanvasTexture {
  if (windowTex) return windowTex
  const cols = 8
  const rows = 16
  const cw = 8
  const ch = 8
  const c = document.createElement('canvas')
  c.width = cols * cw
  c.height = rows * ch
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  const rnd = seeded(7)
  for (let r = 0; r < rows; r++) {
    // 층 단위로 켜고 끄는 편이 사무실답다 — 층 하나가 통째로 불이 꺼진 줄이 섞인다.
    const floorLit = rnd() < 0.72
    for (let k = 0; k < cols; k++) {
      if (!floorLit || rnd() < 0.25) continue
      const v = 150 + Math.floor(rnd() * 105)
      g.fillStyle = `rgb(${v},${Math.floor(v * 0.82)},${Math.floor(v * 0.55)})`
      g.fillRect(k * cw + 1, r * ch + 2, cw - 2, ch - 3)
    }
  }
  windowTex = new CanvasTexture(c)
  windowTex.colorSpace = SRGBColorSpace
  windowTex.wrapS = RepeatWrapping
  windowTex.wrapT = RepeatWrapping
  return windowTex
}
export const WINDOW_ROWS = 16
export const WINDOW_COLS = 8

/* ------------------------------------------------------------------ 난수 · 해시 */

/** 씨앗 고정 난수(mulberry32). 렌더 중 Math.random 을 쓰지 않는다 — 매번 같은 도시여야 한다. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 문자열 → 부호 없는 정수(lib/city-live staffVariant 와 같은 식). */
export function hashOf(s: string): number {
  let n = 0
  for (const ch of s) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return n
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/**
 * 그룹 시티 그림 팔레트 — 3D 씬(three.js) · 2D 그림(SVG 사람 · 차 · 봉투)의 색 값.
 *
 * WebGL 재질 · 캔버스 fillStyle 은 CSS 변수를 읽지 못한다 — 값 자체가 필요해서 이 폴더(검사 예외)에 리터럴로 둔다.
 * 이 색들은 «그림»이지 화면 테마가 아니다: 밝은 · 어두운 모양, 새 · 예전 모양이 바뀌어도 도시는 같은 도시로 보여야 한다.
 * 패널 · 단추 · 글자 같은 화면 틀은 여기 두지 않는다 — 그쪽은 globals.css 토큰(bg-scrim · text-on-dark …)을 쓴다.
 *
 * 값은 0098 이관 때 각 파일에서 그대로 옮겼다(그림이 한 점도 바뀌지 않게). 고칠 때는 스크린숏으로 확인한다.
 */

/* ------------------------------------------------------------------ 하늘 · 빛 · 안개 (scene/sky-rig.tsx) */

/** 하늘 셋의 빛 · 안개 · 하늘 돔(지평선 · 중간 · 천정) 색. SkyRig 가 프레임마다 이 사이를 lerp 한다. */
export const SKY_TINT = {
  day: {
    light: '#fff3df',
    hemiSky: '#cfe0ff',
    hemiGround: '#5e5344',
    fog: '#cfdbe8',
    domeLow: '#e3ecf5',
    domeMid: '#9cc3e8',
    domeTop: '#4a7fc0',
  },
  // 해질녘 — 주황 → 분홍 → 남보라.
  dusk: {
    light: '#ff9a5c',
    hemiSky: '#9a8fb4',
    hemiGround: '#3d2c22',
    fog: '#6a4f6e',
    domeLow: '#ff8a4c',
    domeMid: '#c4688a',
    domeTop: '#2b2d63',
  },
  night: {
    light: '#9db2ff',
    hemiSky: '#2c3a6e',
    hemiGround: '#0a0a10',
    fog: '#0b1224',
    domeLow: '#1f2a55',
    domeMid: '#121a3c',
    domeTop: '#05081a',
  },
} as const

/** 안개의 첫 색(첫 프레임 lerp 전). */
export const FOG_START = '#6d5572'

/** 환경광 카드(Lightformer) 색 — 하늘마다, 그리는 순서대로. 유리 커튼월이 비추는 하늘. */
export const ENV_LIGHT = {
  day: { top: '#eaf2ff', back: '#cfe0ff', right: '#fff2dc', left: '#ffffff' },
  dusk: { top: '#8a6fb8', sun: '#ff9a5c', side: '#e89aa6', front: '#fff0dc' },
  night: { top: '#34427a', horizon: '#ffbf73', ring: '#dfe6ff' },
} as const

/* ------------------------------------------------------------------ 공용 재질 (scene/shared.ts MAT) */

/** 재질 바탕색(color). 이름은 MAT 의 키와 같다. */
export const MATERIAL = {
  ground: '#23201c',
  sidewalk: '#3a352e',
  asphalt: '#0d0d0f',
  laneLine: '#bfb49c',
  marble: '#e9e4da',
  marbleShade: '#d6cfc2',
  brass: '#b08d57',
  brassDark: '#8c6d40',
  concrete: '#9d978d',
  concreteDark: '#6c665e',
  dirt: '#3b2d21',
  rebar: '#7b4a2c',
  crane: '#c69a3e',
  steel: '#8e959b',
  lampPost: '#2a2520',
  signPanel: '#1b1a18',
  paper: '#f4f1ea',
  wood: '#4a3526',
  distant: '#121318',
  bulb: '#fff1d6',
  screen: '#cfe6ff',
  cyan: '#34e1ff',
  progressBg: '#15130f',
  progressFill: '#e8c27a',
  car: '#cbb58a',
  carGlass: '#1a2228',
  tire: '#111111',
  /** 발밑 그림자 원판(불투명도는 재질 쪽 0.28). */
  blob: '#000000',
} as const

/** 스스로 빛나는 재질의 emissive 색. */
export const MATERIAL_GLOW = {
  distant: '#ffcf8a',
  bulb: '#ffd49a',
  screen: '#9fd0ff',
  cyan: '#34e1ff',
  progressFill: '#e8c27a',
} as const

/* ------------------------------------------------------------------ 밤의 창 무늬 (캔버스 텍스처) */

/** 창 무늬 캔버스의 바탕(꺼진 창). */
export const WINDOW_UNLIT = '#000'

/** 켜진 창 한 칸의 캔버스 fillStyle — 밝기 v(150~254)에서 따뜻한 전등색. */
export const windowLit = (v: number): string => `rgb(${v},${Math.floor(v * 0.82)},${Math.floor(v * 0.55)})`

/* ------------------------------------------------------------------ 건물 · 공사 (scene/buildings.tsx) */

export const BUILDING = {
  /** 선택 테두리 · 승격 섬광 금색. */
  gold: '#e8c27a',
  /** 유리 탑 커튼월. */
  glass: '#3b5866',
  /** 유리 탑 창 무늬(emissiveMap)를 비추는 빛. */
  glassGlow: '#ffffff',
  scaffold: '#9aa1a6',
  scaffoldNet: '#56645e',
  /** 승격 때 이는 먼지. */
  dust: '#b9ab95',
} as const

/* ------------------------------------------------------------------ 땅 · 물 · 오벨리스크 */

/** 광장을 두른 물길(반사 재질). */
export const CANAL_WATER = '#16242c'

export const OBELISK_TINT = {
  tip: '#c9a35a',
  tipGlow: '#ffc766',
  light: '#ffcf7a',
} as const

/* ------------------------------------------------------------------ 3D 이름표 (scene/labels.tsx — drei <Html>) */

/** 씬 위에 떠 있는 이름표 — 씬의 따뜻한 어둠 · 황동 테두리와 한 그림이라 씬 색을 쓴다. */
export const SCENE_LABEL = {
  plate: 'rgba(18,16,14,0.72)',
  personPlate: 'rgba(18,16,14,0.6)',
  edge: 'rgba(176,141,87,0.45)',
  edgeStrong: 'rgba(222,186,120,0.95)',
  glowStrong: '0 0 12px rgba(222,186,120,0.45)',
  text: '#f3eee4',
  fact: '#d9c39a',
} as const

/* ------------------------------------------------------------------ 3D 사람 · 로봇 (scene/characters.tsx) */

/** 캐릭터별 옷 색(셔츠 · 소매 · 바지 · 넥타이). */
export const PERSON_3D = {
  staff1: { shirt: '#3b6fb6', arms: '#3b6fb6', pants: '#2b2f3a' },
  staff2: { shirt: '#d8c4a0', arms: '#d8c4a0', pants: '#4a4238' },
  staff3: { shirt: '#4f8a5b', arms: '#4f8a5b', pants: '#2b2f3a' },
  staff4: { shirt: '#c98a95', arms: '#c98a95', pants: '#3a3440' },
  // 팀장 — 청록 조끼 위로 흰 셔츠 소매.
  lead: { shirt: '#1f7a78', arms: '#f1efe9', pants: '#2b2f3a' },
  ceo: { shirt: '#1c2a4a', arms: '#1c2a4a', pants: '#1c2a4a', tie: '#b3262d' },
  chairman: { shirt: '#111114', arms: '#111114', pants: '#111114', tie: '#c9a35a' },
} as const

export const SKIN_3D = '#e0b894'

export const ROBOT_3D = {
  shell: '#eef0f2',
  joint: '#8d9399',
} as const

/* ------------------------------------------------------------------ 2D 사람 · 로봇 · 책상 (city-character.tsx SVG) */

/** 캐릭터별 셔츠 · 바지 · 피부 · 머리 · 소품 색. 머리 모양 · 소품 종류는 그림 쪽이 정한다. */
export const PERSON_SVG = {
  staff1: { shirt: '#4f7cac', pants: '#2d3a4a', skin: '#f1c9a5', hair: '#2b2118' },
  staff2: { shirt: '#d8a878', pants: '#3b3b3b', skin: '#f3d2b3', hair: '#4a2f1d' },
  staff3: { shirt: '#7fa37a', pants: '#34423a', skin: '#e7b894', hair: '#1c1c1c' },
  staff4: { shirt: '#c9737b', pants: '#3a3440', skin: '#f0c7a4', hair: '#6b4a2b' },
  lead: { shirt: '#f4f4f0', pants: '#26323d', skin: '#eec3a0', hair: '#231a14', extraColor: '#2a7f7a' },
  ceo: { shirt: '#1f2a44', pants: '#1a2236', skin: '#eab99a', hair: '#8a8a8a', extraColor: '#b3303a' },
  chairman: { shirt: '#15151a', pants: '#101014', skin: '#ecc0a0', hair: '#c9c9c9', extraColor: '#d4af61' },
} as const

/** 사람 그림의 공통 소품. */
export const FIGURE_SVG = {
  shoe: '#1a1a1a',
  collar: '#f2f2f2',
  paper: '#fbfaf6',
  paperLine: '#b9b2a2',
} as const

/** 앉아 일하는 책상 · 모니터. */
export const DESK_SVG = {
  top: '#6b4f36',
  leg: '#57402b',
  monitor: '#20262e',
  screen: '#7fd3e6',
} as const

/** 2D 로봇. */
export const ROBOT_SVG = {
  leg: '#c9d2dc',
  arm: '#d7dee6',
  shell: '#eef2f6',
  outline: '#b9c4cf',
  light: '#35d0e0',
  antenna: '#9aa7b4',
  visor: '#12303a',
} as const

/* ------------------------------------------------------------------ 2D 차 · 봉투 (city-live-layer.tsx SVG) */

export const CAR_SVG = {
  body: '#c8a55e',
  glass: '#23303b',
  tire: '#1b1b1b',
  lamp: '#fff4c8',
} as const

export const ENVELOPE_SVG = {
  paper: '#fbfaf6',
  edge: '#cbbf9f',
  seal: '#b8913f',
} as const

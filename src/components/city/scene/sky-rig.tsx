'use client'

import { Environment, Lightformer, Sky, Stars } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import {
  BackSide,
  Color,
  type DirectionalLight,
  type Fog,
  type HemisphereLight,
  type Mesh,
  type ShaderMaterial,
  Vector3,
} from 'three'

import type { CitySky } from '@/lib/city-live'

import { MAT, skyState } from './shared'

/**
 * 하늘 · 빛 · 안개 · 환경광. 세 하늘(낮 · 해질녘 · 밤)의 목표값 사이를 **프레임마다 lerp** 한다 —
 * 하늘이 바뀌는 순간(17시 · 20시) 화면이 툭 바뀌지 않게. React 상태는 sky 목표 하나뿐이고
 * 나머지는 전부 이 useFrame 이 three 객체를 직접 만진다.
 *
 * 환경광은 HDR 파일(네트워크) 대신 Lightformer 몇 장으로 굽는다. 하늘이 바뀌면 key 로 다시 굽는다.
 */

interface Grade {
  sunEl: number
  sunAz: number
  turbidity: number
  rayleigh: number
  mie: number
  mieG: number
  lightEl: number
  lightAz: number
  light: string
  lightI: number
  hemiSky: string
  hemiGround: string
  hemiI: number
  env: number
  fog: string
  night: number
  /** 하늘 돔(지평선 · 중간 · 천정 3색)의 불투명도. 낮은 0 — Sky 셰이더만. */
  dome: number
  domeLow: string
  domeMid: string
  domeTop: string
}

const DEG = Math.PI / 180

const GRADE: Record<CitySky, Grade> = {
  day: {
    sunEl: 42, sunAz: -35, turbidity: 3.5, rayleigh: 1.0, mie: 0.004, mieG: 0.8,
    lightEl: 42, lightAz: -35, light: '#fff3df', lightI: 2.6,
    hemiSky: '#cfe0ff', hemiGround: '#5e5344', hemiI: 0.8, env: 1.0, fog: '#cfdbe8', night: 0,
    // 낮도 돔을 반쯤 겹친다 — Sky 셰이더만으로는 지평선이 회색으로 떠서 도시가 흐려 보였다(스크린샷 확인).
    dome: 0.55, domeLow: '#e3ecf5', domeMid: '#9cc3e8', domeTop: '#4a7fc0',
  },
  // 해질녘 — 도시 뒤편 낮은 해, 보라 · 분홍 하늘. 승인된 목업의 기본 모습.
  // Sky 셰이더만으로는 회색빛 분홍에 그쳐서, 주황 → 분홍 → 남보라 돔을 반쯤 겹친다.
  dusk: {
    sunEl: 1.2, sunAz: -58, turbidity: 10, rayleigh: 3.4, mie: 0.02, mieG: 0.96,
    lightEl: 13, lightAz: -58, light: '#ff9a5c', lightI: 2.2,
    hemiSky: '#9a8fb4', hemiGround: '#3d2c22', hemiI: 0.42, env: 1.0, fog: '#6a4f6e', night: 0.12,
    dome: 0.72, domeLow: '#ff8a4c', domeMid: '#c4688a', domeTop: '#2b2d63',
  },
  night: {
    sunEl: -8, sunAz: -58, turbidity: 2, rayleigh: 0.5, mie: 0.003, mieG: 0.7,
    lightEl: 55, lightAz: 30, light: '#9db2ff', lightI: 0.6,
    hemiSky: '#2c3a6e', hemiGround: '#0a0a10', hemiI: 0.42, env: 0.3, fog: '#0b1224', night: 1,
    dome: 1, domeLow: '#1f2a55', domeMid: '#121a3c', domeTop: '#05081a',
  },
}

const dirOf = (el: number, az: number, out: Vector3) =>
  out.set(Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG), -Math.cos(el * DEG) * Math.cos(az * DEG))

const COLOR_KEYS = ['light', 'hemiSky', 'hemiGround', 'fog', 'domeLow', 'domeMid', 'domeTop'] as const
type ColorKey = (typeof COLOR_KEYS)[number]

interface Live {
  g: Omit<Grade, ColorKey>
  c: Record<ColorKey, Color>
}

function liveOf(sky: CitySky): Live {
  const { light, hemiSky, hemiGround, fog, domeLow, domeMid, domeTop, ...g } = GRADE[sky]
  const c = { light, hemiSky, hemiGround, fog, domeLow, domeMid, domeTop }
  return {
    g: { ...g },
    c: Object.fromEntries(COLOR_KEYS.map((k) => [k, new Color(c[k])])) as Record<ColorKey, Color>,
  }
}

const tmp = new Vector3()
const tmpColor = new Color()

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const DOME_FRAG = /* glsl */ `
uniform vec3 low;
uniform vec3 mid;
uniform vec3 top;
uniform float opacity;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 c = mix(low, mid, smoothstep(0.0, 0.16, h));
  c = mix(c, top, smoothstep(0.12, 0.7, h));
  gl_FragColor = vec4(c, opacity);
}`

export function SkyRig({ sky, shadowMap }: { sky: CitySky; shadowMap: number }) {
  const skyRef = useRef<Mesh>(null)
  const sun = useRef<DirectionalLight>(null)
  const hemi = useRef<HemisphereLight>(null)
  const fog = useRef<Fog>(null)
  const dome = useRef<ShaderMaterial>(null)
  const live = useRef<Live | null>(null)
  // 돔 uniform 은 한 벌 — 렌더마다 새 객체를 주면 하늘이 바뀌는 순간 불투명도가 0으로 튄다.
  const [domeUniforms] = useState(() => ({
    low: { value: new Color() },
    mid: { value: new Color() },
    top: { value: new Color() },
    opacity: { value: 0 },
  }))

  useFrame((state, dtRaw) => {
    if (!live.current) live.current = liveOf(sky)
    const L = live.current
    const T = GRADE[sky]
    const k = 1 - Math.exp(-Math.min(dtRaw, 0.1) * 1.4)
    const g = L.g
    for (const key of Object.keys(g) as (keyof Live['g'])[]) g[key] += (T[key] - g[key]) * k
    for (const key of COLOR_KEYS) L.c[key].lerp(tmpColor.set(T[key]), k)

    const skyMat = skyRef.current?.material as ShaderMaterial | undefined
    if (skyMat?.uniforms) {
      dirOf(g.sunEl, g.sunAz, tmp)
      skyMat.uniforms.sunPosition.value.copy(tmp)
      skyMat.uniforms.turbidity.value = g.turbidity
      skyMat.uniforms.rayleigh.value = g.rayleigh
      skyMat.uniforms.mieCoefficient.value = g.mie
      skyMat.uniforms.mieDirectionalG.value = g.mieG
    }
    const s = sun.current
    if (s) {
      dirOf(g.lightEl, g.lightAz, tmp)
      s.position.copy(tmp.multiplyScalar(130))
      s.color.copy(L.c.light)
      s.intensity = g.lightI
    }
    if (hemi.current) {
      hemi.current.color.copy(L.c.hemiSky)
      hemi.current.groundColor.copy(L.c.hemiGround)
      hemi.current.intensity = g.hemiI
    }
    fog.current?.color.copy(L.c.fog)
    state.scene.environmentIntensity = g.env
    if (dome.current) {
      const u = dome.current.uniforms
      u.opacity.value = g.dome
      u.low.value.copy(L.c.domeLow)
      u.mid.value.copy(L.c.domeMid)
      u.top.value.copy(L.c.domeTop)
      dome.current.visible = g.dome > 0.01
    }

    // 창 · 가로등 · 먼 스카이라인이 읽는 밤의 정도.
    skyState.night = g.night
    MAT.bulb.emissiveIntensity = 0.3 + g.night * 7
    MAT.distant.emissiveIntensity = g.night * 0.35
  })

  return (
    <>
      <Sky ref={skyRef as never} distance={1000} />
      {/* 밤 하늘 — Sky 셰이더는 해가 지면 검게만 떨어진다. 짙은 남색 돔을 겹쳐 «밤»으로 읽히게. */}
      <mesh renderOrder={-1}>
        <sphereGeometry args={[440, 32, 16]} />
        <shaderMaterial
          ref={dome}
          side={BackSide}
          transparent
          depthWrite={false}
          fog={false}
          vertexShader={DOME_VERT}
          fragmentShader={DOME_FRAG}
          uniforms={domeUniforms}
        />
      </mesh>
      {sky === 'night' && <Stars radius={300} depth={60} count={2500} factor={6} saturation={0} fade speed={0.4} />}
      <fog ref={fog} attach="fog" args={['#6d5572', 120, 420]} />
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[shadowMap, shadowMap]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-75}
        shadow-camera-right={75}
        shadow-camera-top={75}
        shadow-camera-bottom={-75}
        shadow-camera-near={10}
        shadow-camera-far={320}
      />
      <Environment key={sky} resolution={128} frames={1}>
        <EnvForms sky={sky} />
      </Environment>
    </>
  )
}

/** 환경광 카드. 유리 커튼월이 비출 하늘 — 하늘마다 색과 세기만 다르다. */
function EnvForms({ sky }: { sky: CitySky }) {
  if (sky === 'day') {
    return (
      <>
        <Lightformer form="rect" intensity={2.2} color="#eaf2ff" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#cfe0ff" position={[0, 2, -12]} scale={[30, 6, 1]} />
        <Lightformer form="rect" intensity={1.0} color="#fff2dc" position={[12, 3, 0]} rotation-y={-Math.PI / 2} scale={[20, 6, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#ffffff" position={[-12, 3, 0]} rotation-y={Math.PI / 2} scale={[20, 6, 1]} />
      </>
    )
  }
  if (sky === 'dusk') {
    return (
      <>
        <Lightformer form="rect" intensity={1.0} color="#8a6fb8" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={3.0} color="#ff9a5c" position={[-8, 1.5, -10]} rotation-y={Math.PI / 5} scale={[26, 4, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#e89aa6" position={[10, 3, -6]} rotation-y={-Math.PI / 3} scale={[18, 5, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#fff0dc" position={[0, 3, 12]} rotation-y={Math.PI} scale={[30, 6, 1]} />
      </>
    )
  }
  return (
    <>
      <Lightformer form="rect" intensity={0.5} color="#34427a" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
      <Lightformer form="rect" intensity={0.9} color="#ffbf73" position={[0, 0.6, -12]} scale={[30, 1.2, 1]} />
      <Lightformer form="ring" intensity={1.2} color="#dfe6ff" position={[8, 10, -6]} scale={2} />
    </>
  )
}

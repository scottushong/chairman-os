'use client'

import { MeshReflectorMaterial } from '@react-three/drei'
import { useEffect, useMemo } from 'react'

import { StaticInstances, type Inst } from './instances'
import {
  CANAL_IN,
  CANAL_OUT,
  PLAZA_R,
  RING_IN,
  RING_MID,
  RING_OUT,
  radial,
  tangent,
  type Placement,
  type V3,
} from './layout3d'
import { BOX, BOX_BASE, CYL, MAT, SPHERE_LO, seeded, windowTexture } from './shared'

/**
 * 땅 — 대리석 광장 · 황동 고리 · 검은 순환 대로 · 방사 대로 · 운하(반사) · 가로등 · 먼 스카이라인.
 * 전부 움직이지 않으므로 useFrame 이 없다. 반복되는 것은 인스턴스 한 벌씩.
 */
export function Ground({ placements }: { placements: Placement[] }) {
  const { roads, lamps, bulbs } = useMemo(() => roadsAndLamps(placements), [placements])
  const skyline = useMemo(() => distantSkyline(), [])
  // 먼 스카이라인의 밤 창 — 면 전체가 빛나면 호박색 상자로 보인다. 창 무늬만 켠다(텍스처는 첫 사용 때 만든다).
  useEffect(() => {
    MAT.distant.emissiveMap = windowTexture()
    MAT.distant.needsUpdate = true
  }, [])

  return (
    <group>
      {/* 바닥 — 운하 너머까지. 안개가 끝을 지운다. */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={MAT.ground}>
        <circleGeometry args={[260, 48]} />
      </mesh>

      {/* 광장 둘레 보도 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.008} receiveShadow material={MAT.sidewalk}>
        <ringGeometry args={[PLAZA_R, RING_IN, 96]} />
      </mesh>

      {/* 대리석 광장 + 황동 상감 고리 둘 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} receiveShadow material={MAT.marble}>
        <circleGeometry args={[PLAZA_R, 96]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.036} material={MAT.brass}>
        <ringGeometry args={[9.7, 10.25, 128]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.036} material={MAT.brass}>
        <ringGeometry args={[4.3, 4.5, 96]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.034} receiveShadow material={MAT.marbleShade}>
        <ringGeometry args={[PLAZA_R - 0.6, PLAZA_R, 96]} />
      </mesh>

      {/* 순환 대로 + 가운데 선 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.014} receiveShadow material={MAT.asphalt}>
        <ringGeometry args={[RING_IN, RING_OUT, 128]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.018} material={MAT.laneLine}>
        <ringGeometry args={[RING_MID - 0.06, RING_MID + 0.06, 128]} />
      </mesh>

      <StaticInstances geometry={BOX} material={MAT.asphalt} list={roads} receiveShadow />
      <StaticInstances geometry={CYL} material={MAT.lampPost} list={lamps} />
      <StaticInstances geometry={SPHERE_LO} material={MAT.bulb} list={bulbs} />

      {/* 운하 — 반사 물. 해상도 512 · blur 로 싸게, 도시가 물에 비치는 한 장면을 위해. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <ringGeometry args={[CANAL_IN, CANAL_OUT, 160, 1]} />
        <MeshReflectorMaterial
          resolution={256}
          blur={[320, 90]}
          mixBlur={0.9}
          mixStrength={3.2}
          mixContrast={1}
          mirror={0.85}
          depthScale={0}
          roughness={0.35}
          metalness={0.55}
          color="#16242c"
        />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} material={MAT.marbleShade}>
        <ringGeometry args={[CANAL_IN - 0.7, CANAL_IN, 160, 1]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} material={MAT.marbleShade}>
        <ringGeometry args={[CANAL_OUT, CANAL_OUT + 0.7, 160, 1]} />
      </mesh>

      <StaticInstances geometry={BOX_BASE} material={MAT.distant} list={skyline} />
    </group>
  )
}

function strip(a: number, r0: number, r1: number, width: number): Inst {
  const u = radial(a)
  const rm = (r0 + r1) / 2
  return { p: [u[0] * rm, 0.012, u[2] * rm], ry: -a, s: [width, 0.024, r1 - r0] }
}

/**
 * 방사 대로: 광장 → 순환 대로의 짧은 길(자리마다 하나) + 순환 대로 → 운하의 긴 대로(자리 사이 틈마다).
 * 자리가 몇 개든 건물을 가로지르지 않게 **틈의 가운데**로만 낸다.
 */
function roadsAndLamps(placements: Placement[]) {
  const roads: Inst[] = []
  const lamps: Inst[] = []
  const bulbs: Inst[] = []
  const lamp = (p: V3) => {
    lamps.push({ p, s: [0.11, 5.2, 0.11] })
    bulbs.push({ p: [p[0], 5.35, p[2]], s: [0.32, 0.32, 0.32] })
  }

  const angles = placements.map((p) => p.angle)
  for (const a of angles) roads.push(strip(a, PLAZA_R - 0.4, RING_IN + 0.2, 3.4))

  // 틈 — 자리가 없으면 여덟 갈래.
  const sorted = [...angles].sort((a, b) => a - b)
  const avenues: number[] = []
  if (sorted.length === 0) {
    for (let k = 0; k < 8; k++) avenues.push((k * Math.PI) / 4 + Math.PI / 8)
  } else {
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]
      const b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2
      const gap = b - a
      if (gap < (18 * Math.PI) / 180) continue
      // 큰 틈(앞쪽 빈 호)에는 두세 갈래.
      const n = Math.max(1, Math.min(3, Math.floor(gap / ((60 * Math.PI) / 180))))
      for (let k = 1; k <= n; k++) avenues.push(a + (gap * k) / (n + 1))
    }
  }
  for (const a of avenues) {
    roads.push(strip(a, RING_OUT - 0.2, CANAL_IN - 0.7, 3.2))
    const u = radial(a)
    const t = tangent(a)
    for (let r = RING_OUT + 5; r < CANAL_IN - 2; r += 12) {
      for (const side of [-2.3, 2.3]) lamp([u[0] * r + t[0] * side, 0, u[2] * r + t[2] * side])
    }
  }
  // 순환 대로 바깥 가장자리 — 22.5°마다.
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8 + Math.PI / 16
    const u = radial(a)
    lamp([u[0] * (RING_OUT + 0.7), 0, u[2] * (RING_OUT + 0.7)])
  }
  return { roads, lamps, bulbs }
}

/** 운하 너머의 낮은 스카이라인 — 도시가 섬처럼 떠 보이지 않게. 씨앗 고정. */
function distantSkyline(): Inst[] {
  const rnd = seeded(42)
  const out: Inst[] = []
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2
    const r = 82 + rnd() * 80
    const u = radial(a)
    const h = 4 + Math.pow(rnd(), 2.2) * 22
    out.push({ p: [u[0] * r, 0, u[2] * r], ry: -a, s: [5 + rnd() * 6, h, 5 + rnd() * 6] })
  }
  return out
}

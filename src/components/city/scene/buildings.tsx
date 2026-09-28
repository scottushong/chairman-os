'use client'

import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  DoubleSide,
  EdgesGeometry,
  type Group,
  type InstancedMesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from 'three'

import type { CityStage } from '@/types'

import { StaticInstances, useInstances, writeInstances, type Inst } from './instances'
import { eok, NameTag } from './labels'
import { FLOOR_H, MAX_FLOORS, type Placement } from './layout3d'
import {
  BOX,
  BOX_BASE,
  CYL,
  MAT,
  PYRAMID,
  SPHERE_LO,
  WINDOW_COLS,
  WINDOW_ROWS,
  clamp,
  easeInOut,
  hashOf,
  seeded,
  skyState,
  windowTexture,
} from './shared'

const EDGES = new EdgesGeometry(BOX_BASE)
const GOLD = '#e8c27a'

interface ItemProps {
  pl: Placement
  selected: boolean
  onSelect: (layoutId: number) => void
  still: boolean
}

/* ------------------------------------------------------------------ 공통: 고르기 */

/** 누름 · 올림 처리. 끌어서 돌린 뒤 손을 뗀 것은 클릭이 아니다(delta = 누른 뒤 움직인 픽셀). */
function usePick(id: number, onSelect: (layoutId: number) => void) {
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    if (!hovered) return
    document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered])
  const handlers = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setHovered(true)
    },
    onPointerOut: () => setHovered(false),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (e.delta > 6) return
      e.stopPropagation()
      onSelect(id)
    },
  }
  return { hovered, handlers }
}

/** 발치의 금 고리 — 올리면 옅게, 고르면 진하게 숨쉰다. */
function SelectRing({ radius, selected, hovered, still }: { radius: number; selected: boolean; hovered: boolean; still: boolean }) {
  const mat = useRef<MeshBasicMaterial>(null)
  useFrame((state) => {
    const m = mat.current
    if (!m) return
    const base = selected ? 0.95 : hovered ? 0.45 : 0
    const pulse = selected && !still ? 0.75 + 0.25 * Math.sin(state.clock.elapsedTime * 3) : 1
    m.opacity = base * pulse
    m.visible = base > 0
  })
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.07}>
      <ringGeometry args={[radius, radius + 0.55, 64]} />
      <meshBasicMaterial ref={mat} color={GOLD} transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ 회사 건물 */

const craneOn = (s: CityStage) => s === 'frame' || s === 'finishing'

/**
 * 회사 = 유리 커튼월 + 황동 멀리언. 높이는 월 매출(layout3d.towerFloors), 모양은 단계.
 *
 * 움직임은 이 컴포넌트의 useFrame **하나**가 다 한다 — 매출이 바뀌면 2초에 걸쳐 층이 오르고,
 * 단계가 오르면 비계 · 크레인이 1.5초에 걸쳐 내려앉으며 사라진다. 지난 값은 프레임 루프 안의
 * anim(ref)이 들고 있다: 렌더 중에 ref 를 읽지 않고, 새 목표를 프레임에서 알아차린다.
 */
export function Building({ pl, selected, onSelect, still, promoted }: ItemProps & { promoted: boolean }) {
  const { w, d, item } = pl
  const stage: CityStage = item.stage === 'lot' ? 'foundation' : item.stage
  const target = pl.floors * FLOOR_H
  const { hovered, handlers } = usePick(pl.id, onSelect)

  const body = useRef<Group>(null)
  const tower = useRef<Group>(null)
  const glassMat = useRef<MeshStandardMaterial>(null)
  const hMull = useRef<InstancedMesh>(null)
  const vMull = useRef<InstancedMesh>(null)
  const crown = useRef<Group>(null)
  const frame = useRef<Group>(null)
  const cols = useRef<InstancedMesh>(null)
  const slabs = useRef<InstancedMesh>(null)
  const scaffold = useRef<Group>(null)
  const scaffoldMat = useRef<MeshStandardMaterial>(null)
  const netMat = useRef<MeshStandardMaterial>(null)
  const crane = useRef<Group>(null)
  const jib = useRef<Group>(null)
  const label = useRef<Group>(null)
  const fx = useRef<Group>(null)
  const fxSlab = useRef<Group>(null)
  const dust = useRef<InstancedMesh>(null)
  const dustMat = useRef<MeshBasicMaterial>(null)

  const anim = useRef({
    cur: target,
    from: target,
    to: target,
    t: 1,
    scaffold: stage === 'finishing' ? 1 : 0,
    crane: craneOn(stage) ? 1 : 0,
    // 기공식(이니셔티브 → 회사 승격) 시계. 음수면 없다.
    gb: promoted ? 0 : -1,
  })

  // 회사마다 다른 창 무늬 — 같은 텍스처를 복제해 오프셋만 바꾼다(이미지는 하나).
  const tex = useMemo(() => {
    const t = windowTexture().clone()
    const r = seeded(hashOf(item.id))
    t.offset.set(Math.floor(r() * WINDOW_COLS) / WINDOW_COLS, Math.floor(r() * WINDOW_ROWS) / WINDOW_ROWS)
    t.repeat.set(6 / WINDOW_COLS, 1)
    t.needsUpdate = true
    return t
  }, [item.id])
  useEffect(() => () => tex.dispose(), [tex])

  const vList = useMemo(() => verticalMullions(w, d), [w, d])
  const hList = useMemo(() => horizontalMullions(w, d), [w, d])
  const colList = useMemo(() => frameColumns(w, d), [w, d])
  const slabList = useMemo(() => frameSlabs(w, d), [w, d])
  const scaffoldParts = useMemo(() => scaffoldLists(w, d, target), [w, d, target])
  const dustDirs = useMemo(() => {
    const r = seeded(pl.id * 977 + 3)
    return Array.from({ length: 22 }, () => {
      const a = r() * Math.PI * 2
      return { x: Math.cos(a), z: Math.sin(a), up: 0.6 + r() * 1.2, s: 0.5 + r() * 0.7 }
    })
  }, [pl.id])
  useInstances(vMull, vList)
  useInstances(hMull, hList)
  useInstances(cols, colList)
  useInstances(slabs, slabList)
  // 먼지는 매 프레임 다시 쓴다 — 처음엔 한 점에 모아 둔다.
  useLayoutEffect(() => {
    if (dust.current) writeInstances(dust.current, dustDirs.map(() => ({ p: [0, -5, 0], s: [0, 0, 0] })))
  }, [dustDirs])

  const craneH = Math.max(16, target + 7)
  const showTower = stage === 'finishing' || stage === 'complete'

  useFrame((_, dtRaw) => {
    const a = anim.current
    const dt = Math.min(dtRaw, 0.1)

    // 매출 → 높이. 목표가 바뀐 프레임에 지금 높이에서 2초 트윈을 다시 건다.
    if (target !== a.to) {
      a.from = a.cur
      a.to = target
      a.t = 0
    }
    if (a.t < 1) {
      a.t = Math.min(1, a.t + dt / 2)
      a.cur = a.from + (a.to - a.from) * easeInOut(a.t)
    }
    const h = a.cur
    const fh = Math.max(FLOOR_H, h * 0.6)

    tower.current?.scale.set(1, h, 1)
    const gm = glassMat.current
    if (gm) {
      gm.emissiveIntensity = skyState.night * 1.4
      if (gm.emissiveMap) gm.emissiveMap.repeat.y = h / (FLOOR_H * WINDOW_ROWS)
    }
    if (hMull.current) hMull.current.count = 4 * Math.floor(h / FLOOR_H + 0.02)
    crown.current?.position.set(0, h, 0)
    frame.current?.scale.set(1, fh, 1)
    if (slabs.current) slabs.current.count = 1 + Math.floor(fh / FLOOR_H + 0.02)

    // 비계 — 마감 단계에만. 단계가 오르면 1.5초에 걸쳐 내려앉으며 옅어진다.
    a.scaffold = approach(a.scaffold, stage === 'finishing' ? 1 : 0, dt / 1.5)
    const sc = scaffold.current
    if (sc) {
      sc.visible = a.scaffold > 0.002
      sc.position.y = h - target - (1 - easeInOut(a.scaffold)) * 7
    }
    if (scaffoldMat.current) scaffoldMat.current.opacity = a.scaffold
    if (netMat.current) netMat.current.opacity = 0.32 * a.scaffold

    a.crane = approach(a.crane, craneOn(stage) ? 1 : 0, dt / 1.5)
    const cr = crane.current
    if (cr) {
      cr.visible = a.crane > 0.002
      cr.position.y = -(1 - easeInOut(a.crane)) * craneH
    }
    if (jib.current && !still) jib.current.rotation.y += dt * 0.12

    const top = stage === 'foundation' ? 1.6 : stage === 'frame' ? fh : h + (stage === 'complete' ? 5.2 : 1.6)
    label.current?.position.set(0, top + 3, 0)

    // 기공식: 터의 대리석판이 가라앉고(0~1.2s), 먼지가 일고(0.3~2.4s), 기초가 솟는다(1.0~2.6s).
    if (a.gb >= 0 && a.gb < 3) {
      a.gb += dt
      const g = a.gb
      if (fxSlab.current) fxSlab.current.position.y = -1.4 * easeInOut(clamp(g / 1.2, 0, 1))
      const tau = clamp((g - 0.3) / 2.1, 0, 1)
      const dm = dust.current
      if (dm) {
        writeInstances(
          dm,
          dustDirs.map((p) => {
            const r = 2 + tau * 7 * p.s
            const s = g < 0.3 ? 0 : (0.5 + tau * 1.6) * p.s
            return { p: [p.x * r, 0.4 + p.up * tau * 3 - tau * tau * 1.2, p.z * r], s: [s, s, s] }
          }),
        )
      }
      if (dustMat.current) dustMat.current.opacity = g < 0.3 ? 0 : 0.5 * (1 - tau)
      if (body.current) body.current.position.y = -3.5 * (1 - easeInOut(clamp((g - 1) / 1.6, 0, 1)))
      if (a.gb >= 3) {
        if (fx.current) fx.current.visible = false
        if (body.current) body.current.position.y = 0
      }
    }
  })

  const fact = [eok(item.revenue), item.completion.pct !== null ? `${item.completion.pct}%` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <group position={pl.pos} rotation-y={pl.rotY} {...handlers}>
      <group ref={body} position-y={promoted ? -3.5 : 0}>
        {stage === 'foundation' && <Foundation w={w} d={d} />}

        {/* 골조 — 기둥(단위 높이, 그룹을 세로로 늘린다) + 층 슬래브(층수만큼 count). */}
        <group visible={stage === 'frame'}>
          <mesh geometry={BOX_BASE} material={MAT.dirt} scale={[w + 1.4, 0.05, d + 1.4]} receiveShadow />
          <group ref={frame}>
            <instancedMesh ref={cols} args={[BOX_BASE, MAT.concrete, colList.length]} castShadow />
          </group>
          <instancedMesh ref={slabs} args={[BOX, MAT.concrete, slabList.length]} castShadow receiveShadow />
        </group>

        {/* 유리 탑 — 마감 · 완공 */}
        <group visible={showTower}>
          <mesh geometry={BOX_BASE} material={MAT.concreteDark} scale={[w + 0.7, 0.5, d + 0.7]} receiveShadow />
          <group ref={tower}>
            <mesh geometry={BOX_BASE} scale={[w, 1, d]} castShadow receiveShadow>
              <meshStandardMaterial
                ref={glassMat}
                color="#3b5866"
                metalness={0.75}
                roughness={0.1}
                envMapIntensity={1.8}
                emissive="#ffffff"
                emissiveMap={tex}
                emissiveIntensity={0}
              />
            </mesh>
            <instancedMesh ref={vMull} args={[BOX_BASE, MAT.brassDark, vList.length]} />
            {selected && (
              <lineSegments geometry={EDGES} scale={[w + 0.35, 1.002, d + 0.35]}>
                <lineBasicMaterial color={GOLD} toneMapped={false} />
              </lineSegments>
            )}
          </group>
          <instancedMesh ref={hMull} args={[BOX, MAT.brassDark, hList.length]} />
          {/* 입구 — 광장 쪽 황동 차양 */}
          <mesh geometry={BOX} material={MAT.brass} position={[0, 3.3, d / 2 + 0.75]} scale={[3.4, 0.16, 1.5]} castShadow />
          <group ref={crown} visible={stage === 'complete'}>
            <mesh geometry={BOX_BASE} material={MAT.brass} scale={[w * 0.86, 1.1, d * 0.86]} castShadow />
            <mesh geometry={BOX_BASE} material={MAT.brass} position-y={1.1} scale={[w * 0.52, 1.5, d * 0.52]} castShadow />
            <mesh geometry={PYRAMID} material={MAT.brass} position-y={2.6} scale={[w * 0.3, 1.6, d * 0.3]} castShadow />
            <mesh geometry={CYL} material={MAT.brass} position-y={4.1} scale={[0.07, 3, 0.07]} />
          </group>
        </group>

        {/* 비계 — 목표 높이에 맞춰 짓고, 트윈 중에는 꼭대기를 따라 오르내린다. */}
        <group ref={scaffold} visible={stage === 'finishing'}>
          <StaticInstances geometry={BOX_BASE} list={scaffoldParts.tubes}>
            <meshStandardMaterial ref={scaffoldMat} color="#9aa1a6" metalness={0.7} roughness={0.45} transparent />
          </StaticInstances>
          <StaticInstances geometry={BOX_BASE} list={scaffoldParts.nets}>
            <meshStandardMaterial
              ref={netMat}
              color="#56645e"
              roughness={0.9}
              transparent
              opacity={0.32}
              depthWrite={false}
              side={DoubleSide}
            />
          </StaticInstances>
        </group>
      </group>

      <group ref={crane} visible={craneOn(stage)}>
        <Crane x={w / 2 + 2.4} z={-d / 2 + 1} height={craneH} jibRef={jib} />
      </group>

      {promoted && (
        <group ref={fx}>
          <group ref={fxSlab}>
            <mesh geometry={BOX_BASE} material={MAT.marble} scale={[w, 0.3, d - 1]} receiveShadow />
          </group>
          <instancedMesh ref={dust} args={[SPHERE_LO, undefined, dustDirs.length]}>
            <meshBasicMaterial ref={dustMat} color="#b9ab95" transparent opacity={0} depthWrite={false} />
          </instancedMesh>
        </group>
      )}

      <SelectRing radius={Math.max(w, d) * 0.78 + 0.4} selected={selected} hovered={hovered} still={still} />
      <group ref={label}>
        <NameTag name={item.name} fact={fact || null} strong={selected || hovered} />
      </group>
    </group>
  )
}

function approach(v: number, target: number, step: number) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step)
}

/** 기초 — 파낸 구덩이 + 흙막이 + 콘크리트 기초판 + 철근 꽂이. */
function Foundation({ w, d }: { w: number; d: number }) {
  const rebar = useMemo(() => {
    const out: Inst[] = []
    for (let i = 0; i < 5; i++)
      for (let k = 0; k < 4; k++)
        out.push({ p: [-w / 2 + 1 + (i * (w - 2)) / 4, 0.5, -d / 2 + 1 + (k * (d - 2)) / 3], s: [0.07, 1.9, 0.07] })
    return out
  }, [w, d])
  const W = w + 1.6
  const D = d + 1.6
  return (
    <group>
      <mesh geometry={BOX_BASE} material={MAT.dirt} scale={[W, 0.05, D]} receiveShadow />
      <mesh geometry={BOX_BASE} material={MAT.concreteDark} position-z={D / 2} scale={[W, 0.7, 0.3]} castShadow receiveShadow />
      <mesh geometry={BOX_BASE} material={MAT.concreteDark} position-z={-D / 2} scale={[W, 0.7, 0.3]} castShadow receiveShadow />
      <mesh geometry={BOX_BASE} material={MAT.concreteDark} position-x={W / 2} scale={[0.3, 0.7, D]} castShadow receiveShadow />
      <mesh geometry={BOX_BASE} material={MAT.concreteDark} position-x={-W / 2} scale={[0.3, 0.7, D]} castShadow receiveShadow />
      <mesh geometry={BOX_BASE} material={MAT.concrete} scale={[w - 0.4, 0.5, d - 0.4]} castShadow receiveShadow />
      <StaticInstances geometry={CYL} material={MAT.rebar} list={rebar} castShadow />
    </group>
  )
}

/** 타워 크레인 — 마스트 · 지브 · 카운터웨이트 · 운전실 · 훅. 지브가 천천히 돈다. */
function Crane({ x, z, height, jibRef }: { x: number; z: number; height: number; jibRef: RefObject<Group | null> }) {
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={BOX_BASE} material={MAT.concreteDark} scale={[2, 0.5, 2]} />
      <mesh geometry={BOX_BASE} material={MAT.crane} scale={[0.8, height, 0.8]} castShadow />
      <group ref={jibRef} position-y={height}>
        <mesh geometry={BOX} material={MAT.crane} position-x={3.5} scale={[16, 0.6, 0.6]} castShadow />
        <mesh geometry={BOX} material={MAT.concreteDark} position={[-4, -0.5, 0]} scale={[2, 1.2, 1.3]} castShadow />
        <mesh geometry={BOX} material={MAT.steel} position={[0.9, -0.9, 0]} scale={[1.2, 1.1, 1.2]} />
        <mesh geometry={PYRAMID} material={MAT.crane} position-y={0.3} scale={[0.55, 2.6, 0.55]} />
        <mesh geometry={BOX_BASE} material={MAT.steel} position={[9, -height * 0.45, 0]} scale={[0.05, height * 0.45, 0.05]} />
        <mesh geometry={BOX} material={MAT.crane} position={[9, -height * 0.45 - 0.3, 0]} scale={[0.5, 0.6, 0.5]} />
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ 인스턴스 목록 */

/** 세로 멀리언 — 단위 높이(탑 그룹의 scale.y 가 높이). 앞 · 뒤 7개, 옆 4개씩. */
function verticalMullions(w: number, d: number): Inst[] {
  const out: Inst[] = []
  const o = 0.06
  for (let i = 0; i <= 6; i++) {
    const x = -w / 2 + (w * i) / 6
    out.push({ p: [x, 0, d / 2 + o], s: [0.13, 1, 0.13] }, { p: [x, 0, -d / 2 - o], s: [0.13, 1, 0.13] })
  }
  for (let k = 1; k <= 4; k++) {
    const z = -d / 2 + (d * k) / 5
    out.push({ p: [w / 2 + o, 0, z], s: [0.13, 1, 0.13] }, { p: [-w / 2 - o, 0, z], s: [0.13, 1, 0.13] })
  }
  return out
}

/** 가로 멀리언 — 층마다 네 변. 층 순서로 쌓아 두어 count 만 줄이면 위층부터 사라진다. */
function horizontalMullions(w: number, d: number): Inst[] {
  const out: Inst[] = []
  const o = 0.06
  for (let k = 1; k <= MAX_FLOORS; k++) {
    const y = k * FLOOR_H - 0.08
    out.push(
      { p: [0, y, d / 2 + o], s: [w + 0.14, 0.16, 0.14] },
      { p: [0, y, -d / 2 - o], s: [w + 0.14, 0.16, 0.14] },
      { p: [w / 2 + o, y, 0], s: [0.14, 0.16, d + 0.14] },
      { p: [-w / 2 - o, y, 0], s: [0.14, 0.16, d + 0.14] },
    )
  }
  return out
}

function frameColumns(w: number, d: number): Inst[] {
  const out: Inst[] = []
  for (const x of [-w / 2 + 0.5, 0, w / 2 - 0.5])
    for (const z of [-d / 2 + 0.5, 0, d / 2 - 0.5]) if (x !== 0 || z !== 0) out.push({ p: [x, 0, z], s: [0.55, 1, 0.55] })
  return out
}

function frameSlabs(w: number, d: number): Inst[] {
  return Array.from({ length: MAX_FLOORS + 1 }, (_, k) => ({ p: [0, k * FLOOR_H + 0.16, 0], s: [w - 0.1, 0.32, d - 0.1] }))
}

/** 비계 — 위쪽 40% 띠를 두르는 파이프(기둥 · 가로대) + 그물망. 목표 높이에 맞춰 짓는다. */
function scaffoldLists(w: number, d: number, target: number) {
  const tubes: Inst[] = []
  const nets: Inst[] = []
  const o = 1.0
  const y0 = Math.max(0.5, target * 0.6 - 1)
  const y1 = target + 1.4
  const H = y1 - y0
  const W = w + o * 2
  const D = d + o * 2
  const nx = Math.max(2, Math.ceil(W / 2.2))
  const nz = Math.max(2, Math.ceil(D / 2.2))
  for (let i = 0; i <= nx; i++) {
    const x = -W / 2 + (W * i) / nx
    tubes.push({ p: [x, y0, D / 2], s: [0.1, H, 0.1] }, { p: [x, y0, -D / 2], s: [0.1, H, 0.1] })
  }
  for (let k = 1; k < nz; k++) {
    const z = -D / 2 + (D * k) / nz
    tubes.push({ p: [W / 2, y0, z], s: [0.1, H, 0.1] }, { p: [-W / 2, y0, z], s: [0.1, H, 0.1] })
  }
  for (let y = y0 + 0.3; y <= y1; y += 1.6) {
    tubes.push(
      { p: [0, y, D / 2], s: [W, 0.08, 0.08] },
      { p: [0, y, -D / 2], s: [W, 0.08, 0.08] },
      { p: [W / 2, y, 0], s: [0.08, 0.08, D] },
      { p: [-W / 2, y, 0], s: [0.08, 0.08, D] },
    )
  }
  nets.push(
    { p: [0, y0, D / 2 + 0.08], s: [W, H, 0.02] },
    { p: [0, y0, -D / 2 - 0.08], s: [W, H, 0.02] },
    { p: [W / 2 + 0.08, y0, 0], s: [0.02, H, D] },
    { p: [-W / 2 - 0.08, y0, 0], s: [0.02, H, D] },
  )
  return { tubes, nets }
}

/* ------------------------------------------------------------------ 이니셔티브 터 */

/** 이니셔티브 = 대리석 빈 터 + 안내판(기둥 둘 + 판). 이름은 판 위 Html. */
export function Lot({ pl, selected, onSelect, still }: ItemProps) {
  const { w, d, item } = pl
  const { hovered, handlers } = usePick(pl.id, onSelect)
  return (
    <group position={pl.pos} rotation-y={pl.rotY} {...handlers}>
      <mesh geometry={BOX_BASE} material={MAT.marble} scale={[w, 0.3, d]} castShadow receiveShadow />
      <mesh geometry={BOX_BASE} material={MAT.brass} position-z={d / 2} scale={[w, 0.34, 0.12]} />
      <mesh geometry={BOX_BASE} material={MAT.brass} position-z={-d / 2} scale={[w, 0.34, 0.12]} />
      <mesh geometry={BOX_BASE} material={MAT.brass} position-x={w / 2} scale={[0.12, 0.34, d]} />
      <mesh geometry={BOX_BASE} material={MAT.brass} position-x={-w / 2} scale={[0.12, 0.34, d]} />
      <group position={[-w / 2 + 2.4, 0.3, d / 2 - 1.2]}>
        <mesh geometry={BOX_BASE} material={MAT.lampPost} position-x={-1.3} scale={[0.18, 3.2, 0.18]} castShadow />
        <mesh geometry={BOX_BASE} material={MAT.lampPost} position-x={1.3} scale={[0.18, 3.2, 0.18]} castShadow />
        <mesh geometry={BOX} material={MAT.brass} position-y={3.1} scale={[3.5, 1.8, 0.12]} castShadow />
        <mesh geometry={BOX} material={MAT.signPanel} position={[0, 3.1, 0.05]} scale={[3.2, 1.5, 0.06]} />
      </group>
      <SelectRing radius={Math.max(w, d) * 0.78 + 0.4} selected={selected} hovered={hovered} still={still} />
      <group position={[-w / 2 + 2.4, 5.6, d / 2 - 1.2]}>
        <NameTag name={item.name} fact="이니셔티브" strong={selected || hovered} />
      </group>
    </group>
  )
}

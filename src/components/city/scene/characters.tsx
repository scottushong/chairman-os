'use client'

import { Billboard } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import type { Group, Mesh } from 'three'

import type { CityActor, CityCharacter } from '@/lib/city-live'

import { PersonTag } from './labels'
import { arcDelta, LANE_CAR, LANE_ROBOT, ringPoint, tangent, type SpotPos } from './layout3d'
import { BOX, BOX_BASE, BOX_HANG, CAPSULE, CYL, DISC, MAT, SPHERE, SPHERE_LO, cloth } from './shared'

/**
 * 살아 있는 도시의 사람 · 로봇 · 차(G-3). 낮은 폴리곤 — 상자 · 캡슐 · 구로만.
 * 사람마다 useFrame 하나(걸음 · 팔 · 진행바를 한 번에). 스물넷을 넘지 않는다(MAX_ACTORS).
 */

const WALK_S = 6
const CARRY_CYCLE = 10
const CARRY_WALK = 8

interface Look {
  shirt: string
  arms: string
  pants: string
  tie?: string
}

const LOOK: Record<Exclude<CityCharacter, 'robot'>, Look> = {
  staff1: { shirt: '#3b6fb6', arms: '#3b6fb6', pants: '#2b2f3a' },
  staff2: { shirt: '#d8c4a0', arms: '#d8c4a0', pants: '#4a4238' },
  staff3: { shirt: '#4f8a5b', arms: '#4f8a5b', pants: '#2b2f3a' },
  staff4: { shirt: '#c98a95', arms: '#c98a95', pants: '#3a3440' },
  // 팀장 — 청록 조끼 위로 흰 셔츠 소매.
  lead: { shirt: '#1f7a78', arms: '#f1efe9', pants: '#2b2f3a' },
  ceo: { shirt: '#1c2a4a', arms: '#1c2a4a', pants: '#1c2a4a', tie: '#b3262d' },
  chairman: { shirt: '#111114', arms: '#111114', pants: '#111114', tie: '#c9a35a' },
}
const SKIN = '#e0b894'

interface Limbs {
  legL: Mesh | null
  legR: Mesh | null
  armL: Mesh | null
  armR: Mesh | null
  torso: Group | null
}

/** 팔다리 한 벌 — ref 하나에 담아 Figure 가 callback ref 로 채우고, useFrame 이 읽는다. */
function useLimbs(): RefObject<Limbs> {
  return useRef<Limbs>({ legL: null, legR: null, armL: null, armR: null, torso: null })
}

/** 몸 — 모양만. 움직임은 부르는 쪽 useFrame 이 limbs 로 준다. */
function Figure({ character, rigRef }: { character: CityCharacter; rigRef: RefObject<Limbs> }) {
  const robot = character === 'robot'
  const look = robot ? null : LOOK[character]
  const white = cloth('#eef0f2', 0.35, 0.1)
  const grey = cloth('#8d9399', 0.5, 0.4)
  return (
    <group>
      <mesh geometry={DISC} material={MAT.blob} position-y={0.03} scale={0.75} />
      <mesh ref={(o: Mesh | null) => {
          rigRef.current.legL = o
        }} geometry={BOX_HANG} material={robot ? grey : cloth(look!.pants)} position={[0.17, 1.0, 0]} scale={[0.26, 1.0, 0.3]} />
      <mesh ref={(o: Mesh | null) => {
          rigRef.current.legR = o
        }} geometry={BOX_HANG} material={robot ? grey : cloth(look!.pants)} position={[-0.17, 1.0, 0]} scale={[0.26, 1.0, 0.3]} />
      <group ref={(o: Group | null) => {
          rigRef.current.torso = o
        }}>
        {robot ? (
          <>
            <mesh geometry={SPHERE} material={white} position-y={1.62} scale={[0.56, 0.68, 0.5]} />
            <mesh geometry={SPHERE} material={white} position-y={2.55} scale={0.4} />
            <mesh geometry={BOX} material={MAT.cyan} position={[0, 2.6, 0.36]} scale={[0.34, 0.09, 0.06]} />
            <mesh geometry={CYL} material={grey} position-y={2.9} scale={[0.03, 0.45, 0.03]} />
            <mesh geometry={SPHERE_LO} material={MAT.cyan} position-y={3.4} scale={0.09} />
          </>
        ) : (
          <>
            <mesh geometry={CAPSULE} material={cloth(look!.shirt)} position-y={1.7} scale={[1, 1, 0.78]} />
            <mesh geometry={SPHERE} material={cloth(SKIN, 0.6)} position-y={2.72} scale={0.34} />
            {look!.tie && <mesh geometry={BOX} material={cloth(look!.tie, 0.5, 0.2)} position={[0, 2.0, 0.31]} scale={[0.1, 0.5, 0.04]} />}
          </>
        )}
        <mesh
          ref={(o: Mesh | null) => {
          rigRef.current.armL = o
        }}
          geometry={BOX_HANG}
          material={robot ? white : cloth(look!.arms)}
          position={[0.5, 2.25, 0]}
          scale={[0.17, 0.85, 0.2]}
        />
        <mesh
          ref={(o: Mesh | null) => {
          rigRef.current.armR = o
        }}
          geometry={BOX_HANG}
          material={robot ? white : cloth(look!.arms)}
          position={[-0.5, 2.25, 0]}
          scale={[0.17, 0.85, 0.2]}
        />
      </group>
    </group>
  )
}

type Pose = 'idle' | 'walk' | 'carry' | 'type' | 'raise'

/** 한 프레임의 자세. 걷는 중(moving)이면 다리를 엇갈려 흔들고 몸이 조금 튄다. 팔은 자세마다. */
function pose(limbs: Limbs, p: Pose, moving: boolean, t: number, still: boolean) {
  const { legL, legR, armL, armR, torso } = limbs
  if (!legL || !legR || !armL || !armR || !torso) return
  const ph = t * 9
  const swing = moving ? Math.sin(ph) : 0
  legL.rotation.x = swing * 0.6
  legR.rotation.x = -swing * 0.6
  torso.position.y = moving ? Math.abs(Math.sin(ph)) * 0.08 : still ? 0 : Math.sin(t * 2) * 0.02
  armL.rotation.set(0, 0, 0)
  armR.rotation.set(0, 0, 0)
  if (p === 'walk' && moving) {
    armL.rotation.x = -swing * 0.5
    armR.rotation.x = swing * 0.5
  } else if (p === 'carry') {
    armL.rotation.x = -1.15
    armR.rotation.x = -1.15
  } else if (p === 'type') {
    armL.rotation.x = -0.95 + (still ? 0 : Math.sin(t * 13) * 0.07)
    armR.rotation.x = -0.95 + (still ? 0 : Math.sin(t * 13 + 1.7) * 0.07)
  } else if (p === 'raise') {
    // 오른팔을 머리 위로 — 흔든다.
    armR.rotation.z = -2.75 + (still ? 0 : Math.sin(t * 8) * 0.3)
  }
}

/* ------------------------------------------------------------------ 사람 */

export function Actor({
  actor,
  from,
  to,
  ghost,
  still,
}: {
  actor: CityActor
  from: SpotPos
  to: SpotPos
  ghost?: 'exit' | 'raise'
  still: boolean
}) {
  const root = useRef<Group>(null)
  const turn = useRef<Group>(null)
  const box = useRef<Mesh>(null)
  const fill = useRef<Mesh>(null)
  const limbs = useLimbs()
  const st = useRef({ t: 0, key: '', yaw: to.face })
  const pathKey = `${actor.motion}|${from.p.join(',')}|${to.p.join(',')}`
  const progress = actor.progress ?? null

  useFrame((_, dtRaw) => {
    const s = st.current
    const dt = Math.min(dtRaw, 0.1)
    // 같은 사람이 새 길을 받으면(폴링 사이 자리가 바뀌면) 걸음을 처음부터.
    if (s.key !== pathKey) {
      s.key = pathKey
      s.t = 0
    }
    s.t += dt
    const g = root.current
    if (!g) return

    let u = 1
    let p: Pose = 'idle'
    if (actor.motion === 'walk') {
      u = Math.min(1, s.t / WALK_S)
      p = 'walk'
    } else if (actor.motion === 'carry') {
      u = Math.min(1, (s.t % CARRY_CYCLE) / CARRY_WALK)
      p = 'carry'
    } else if (actor.motion === 'desk') {
      p = 'type'
    } else {
      p = 'raise'
    }
    const moving = actor.motion === 'walk' || actor.motion === 'carry'
    const a = moving ? from.p : to.p
    const x = a[0] + (to.p[0] - a[0]) * u
    const z = a[2] + (to.p[2] - a[2]) * u
    g.position.set(x, 0, z)

    // 걷는 동안은 가는 쪽을, 멈추면 자리의 방향을 본다. 급히 돌지 않게 감아 돈다.
    const dx = to.p[0] - from.p[0]
    const dz = to.p[2] - from.p[2]
    const walking = moving && u < 1 && dx * dx + dz * dz > 0.01
    const want = walking ? Math.atan2(dx, dz) : to.face
    let diff = want - s.yaw
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    s.yaw += diff * (1 - Math.exp(-dt * 8))
    if (turn.current) turn.current.rotation.y = s.yaw

    pose(limbs.current, p, walking, s.t, still)
    if (box.current) box.current.visible = actor.motion === 'carry'

    // 나가는 유령은 길에 닿으면 사라진다.
    if (ghost === 'exit') g.visible = u < 1

    const f = fill.current
    if (f) {
      if (progress === null) {
        // 잴 수 없는 진행 — 짧은 막대가 좌우로 흐른다.
        const k = still ? 0.5 : (Math.sin(s.t * 2.2) + 1) / 2
        f.scale.x = 0.36
        f.position.x = -0.52 + k * 1.04
      } else {
        const v = Math.max(0.02, Math.min(1, progress))
        f.scale.x = 1.4 * v
        f.position.x = -0.7 + 0.7 * v
      }
    }
  })

  return (
    <group ref={root}>
      <group ref={turn}>
        <Figure character={actor.character} rigRef={limbs} />
        <mesh ref={box} geometry={BOX} material={MAT.paper} position={[0, 1.75, 0.62]} scale={[0.8, 0.55, 0.55]} visible={false} />
        {actor.motion === 'desk' && (
          <group position-z={0.95}>
            <mesh geometry={BOX_BASE} material={MAT.wood} scale={[1.6, 0.95, 0.7]} />
            <mesh geometry={BOX} material={MAT.screen} position={[0, 1.22, 0.12]} rotation-x={-0.25} scale={[0.72, 0.46, 0.04]} />
          </group>
        )}
      </group>
      {actor.motion === 'desk' && (
        <Billboard position-y={3.55}>
          <mesh geometry={BOX} material={MAT.progressBg} scale={[1.5, 0.16, 0.05]} />
          <mesh ref={fill} geometry={BOX} material={MAT.progressFill} position-z={0.03} scale={[0.02, 0.12, 0.05]} />
        </Billboard>
      )}
      {actor.label && (
        <group position-y={actor.motion === 'desk' ? 4.2 : 3.6}>
          <PersonTag label={actor.label} />
        </group>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ 로봇 순찰 */

const PATROL_S = 48

/** AI Job 이 도는 동안 — 로봇이 순환 대로 안쪽 차선을 한 바퀴씩 돈다(모든 회사의 길 앞을 지난다). */
export function RobotPatrol({ still }: { still: boolean }) {
  const root = useRef<Group>(null)
  const limbs = useLimbs()
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.1)
    const a = (t.current / PATROL_S) * Math.PI * 2
    const g = root.current
    if (!g) return
    const p = ringPoint(a, LANE_ROBOT)
    g.position.set(p[0], 0, p[2])
    const tg = tangent(a)
    g.rotation.y = Math.atan2(tg[0], tg[2])
    pose(limbs.current, 'walk', true, t.current * 0.8, still)
  })
  return (
    <group ref={root}>
      <Figure character="robot" rigRef={limbs} />
    </group>
  )
}

/* ------------------------------------------------------------------ 차 */

const CAR_SPEED = 7
const CAR_PAUSE = 1.5

/**
 * 오늘이 다음 행동인 이니셔티브의 차 — 순환 대로 바깥 차선을 따라 from 의 각에서 to 의 각까지 달리고,
 * 잠깐 섰다가 다시 출발점에서 떠난다. 광장은 오벨리스크 앞(각 π).
 */
export function Vehicle({ from, to, still }: { from: SpotPos; to: SpotPos; still: boolean }) {
  const root = useRef<Group>(null)
  const t = useRef(0)
  const a1 = from.angle
  const delta = arcDelta(a1, to.angle)
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.1)
    const drive = (Math.abs(delta) * LANE_CAR) / CAR_SPEED
    const cyc = t.current % (drive + CAR_PAUSE)
    const u = still ? 0.5 : Math.min(1, cyc / drive)
    const a = a1 + delta * u
    const g = root.current
    if (!g) return
    const p = ringPoint(a, LANE_CAR)
    g.position.set(p[0], 0, p[2])
    const tg = tangent(a)
    const sgn = Math.sign(delta)
    g.rotation.y = Math.atan2(tg[0] * sgn, tg[2] * sgn)
  })
  return (
    <group ref={root}>
      <mesh geometry={DISC} material={MAT.blob} position-y={0.03} scale={[1.3, 1, 2.1]} />
      <mesh geometry={BOX} material={MAT.car} position-y={0.62} scale={[1.6, 0.62, 3.3]} castShadow />
      <mesh geometry={BOX} material={MAT.carGlass} position={[0, 1.18, -0.25]} scale={[1.38, 0.55, 1.7]} />
      {[
        [0.72, 1.05],
        [-0.72, 1.05],
        [0.72, -1.05],
        [-0.72, -1.05],
      ].map(([x, z]) => (
        <mesh key={`${x},${z}`} geometry={BOX} material={MAT.tire} position={[x, 0.3, z]} scale={[0.32, 0.6, 0.6]} />
      ))}
      <mesh geometry={BOX} material={MAT.bulb} position={[0.5, 0.7, 1.66]} scale={[0.34, 0.14, 0.04]} />
      <mesh geometry={BOX} material={MAT.bulb} position={[-0.5, 0.7, 1.66]} scale={[0.34, 0.14, 0.04]} />
    </group>
  )
}

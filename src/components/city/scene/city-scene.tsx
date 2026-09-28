'use client'

import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useMemo, useRef, useState } from 'react'

import type { CityItem } from '@/lib/city'
import type { CityLive, CitySky } from '@/lib/city-live'

import type { CityGhost } from '../use-city-live'
import { Building, Lot } from './buildings'
import { Actor, RobotPatrol, Vehicle } from './characters'
import { Ground } from './ground'
import { LabelPortal } from './labels'
import { placeItems, spotPos, type Placement } from './layout3d'
import { Obelisk } from './obelisk'
import { SkyRig } from './sky-rig'

/**
 * PC 그룹 시티 3D 씬 (Phase 8 G-2a). next/dynamic({ ssr:false }) 으로만 불린다.
 *
 * 그림(2D 폴백)과 **같은 규격**(CityItem · CityLive · CityGhost)을 읽는다 — 자리는 layout3d 가
 * 3D 로 다시 잡고, 사람 · 차 · 오벨리스크는 CityLive 한 장에서 나온다. 네트워크 자원은 없다:
 * 형상은 전부 코드로 만들고, 환경광은 Lightformer 로 굽고, 글자는 DOM(Html)이다.
 */

export interface CitySceneProps {
  items: CityItem[]
  live: CityLive
  ghosts: CityGhost[]
  sky: CitySky
  selectedId: number | null
  onSelect: (layoutId: number) => void
  reducedMotion: boolean
}

export default function CityScene(props: CitySceneProps) {
  const { items, reducedMotion } = props
  // 사용자가 누르기 전에는 «동작 줄이기»를 따른다 — 켜져 있으면 멈춘 채로 시작.
  const [pausedByUser, setPausedByUser] = useState<boolean | null>(null)
  const paused = pausedByUser ?? reducedMotion
  const frame = useRef<HTMLDivElement>(null)

  // 승격(이니셔티브 → 회사, 같은 layout.id) 감지 — 지난 items 를 상태로 들고 렌더 중에 견준다
  // (React 가 권하는 «이전 prop 으로 상태 맞추기»). 감지된 자리는 기공식을 한 번 튼다.
  const [prevItems, setPrevItems] = useState(items)
  const [promoted, setPromoted] = useState<ReadonlySet<number>>(() => new Set())
  if (items !== prevItems) {
    const before = new Map(prevItems.map((i) => [i.layout.id, i.kind]))
    const born = items.filter((i) => i.kind === 'business' && before.get(i.layout.id) === 'initiative').map((i) => i.layout.id)
    setPrevItems(items)
    if (born.length > 0) setPromoted((p) => new Set([...p, ...born]))
  }

  return (
    <div ref={frame} className="relative aspect-video w-full overflow-hidden rounded-glass bg-[#16130f]">
      <Canvas
        shadows="percentage"
        dpr={[1, 1.75]}
        camera={{ position: [0, 34, 88], fov: 36, near: 1, far: 2500 }}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      >
        <LabelPortal value={frame}>
          <World {...props} promoted={promoted} paused={paused} />
        </LabelPortal>
      </Canvas>
      <button
        type="button"
        onClick={() => setPausedByUser(!paused)}
        aria-label={paused ? '자동 회전 다시' : '자동 회전 멈춤'}
        title={paused ? '자동 회전 다시' : '자동 회전 멈춤'}
        aria-pressed={paused}
        className="absolute bottom-3 left-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-[#b08d57]/60 bg-black/55 text-[#f3eee4] backdrop-blur-sm transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8c27a]"
      >
        {paused ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3.5 2 L12 7 L3.5 12 Z" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="3" y="2" width="3" height="10" rx="0.8" fill="currentColor" />
            <rect x="8" y="2" width="3" height="10" rx="0.8" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  )
}

function World({
  items,
  live,
  ghosts,
  sky,
  selectedId,
  onSelect,
  reducedMotion,
  promoted,
  paused,
}: CitySceneProps & { promoted: ReadonlySet<number>; paused: boolean }) {
  const placements = useMemo(() => placeItems(items), [items])
  const byId = useMemo(() => new Map<number, Placement>(placements.map((p) => [p.id, p])), [placements])
  const still = reducedMotion

  return (
    <>
      <SkyRig sky={sky} shadowMap={1536} />
      <Ground placements={placements} />
      <Obelisk online={live.chairmanOnline} brief={live.briefDelivered} still={still} />

      {placements.map((pl) =>
        pl.item.kind === 'business' ? (
          <Building
            key={`b:${pl.id}`}
            pl={pl}
            selected={selectedId === pl.id}
            onSelect={onSelect}
            still={still}
            promoted={promoted.has(pl.id)}
          />
        ) : (
          <Lot key={`l:${pl.id}`} pl={pl} selected={selectedId === pl.id} onSelect={onSelect} still={still} />
        ),
      )}

      {live.actors.map((a) => (
        <Actor key={`a:${a.id}`} actor={a} from={spotPos(a.from, byId, a.id)} to={spotPos(a.to, byId, a.id)} still={still} />
      ))}
      {ghosts.map((g) => (
        <Actor
          key={`g:${g.id}:${g.until}`}
          actor={g}
          ghost={g.ghost}
          from={spotPos(g.from, byId, g.id)}
          to={spotPos(g.to, byId, g.id)}
          still={still}
        />
      ))}
      {live.vehicles.map((v) => (
        <Vehicle key={v.id} from={spotPos(v.from, byId, v.id)} to={spotPos(v.to, byId, v.id)} still={still} />
      ))}
      {live.robotPatrol && <RobotPatrol still={still} />}

      <OrbitControls
        makeDefault
        target={[0, 13, -8]}
        autoRotate={!paused}
        autoRotateSpeed={0.3}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={32}
        maxDistance={170}
        minPolarAngle={0.25}
        maxPolarAngle={1.36}
      />

      <EffectComposer multisampling={2}>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={1.1} luminanceSmoothing={0.25} />
        <Vignette offset={0.28} darkness={0.55} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>

      <FpsMeter />
    </>
  )
}

/** 검증용 fps — 최근 2초의 프레임 수를 window.__cityFps 에 적는다(콘솔에는 아무것도 쓰지 않는다). */
function FpsMeter() {
  const stamps = useRef<number[]>([])
  useFrame(() => {
    const now = performance.now()
    const b = stamps.current
    b.push(now)
    while (b.length > 0 && now - b[0] > 2000) b.shift()
    if (b.length > 1) {
      ;(window as unknown as { __cityFps?: number }).__cityFps = Math.round(((b.length - 1) * 1000 * 10) / (now - b[0])) / 10
    }
  })
  return null
}

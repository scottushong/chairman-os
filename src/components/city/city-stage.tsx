'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { CityLiveLayer } from '@/components/city/city-live-layer'
import { CityMap } from '@/components/city/city-map'
import { useCityGhosts, useCitySnapshot, useLocalSky, useReducedMotion } from '@/components/city/use-city-live'
import { imageOf } from '@/lib/city'
import { CITY_SKY_LABEL_KO, type CitySky, type CitySnapshot } from '@/lib/city-live'

/**
 * /group의 도시 한 칸 (Phase 8 G-2) — PC는 3D 씬, 폰 · 저사양 · «동작 줄이기»는 그림 + 레이어.
 *
 * **처음 그림은 늘 그림 + 레이어다.** 서버가 그대로 그릴 수 있고(첫 화면이 비지 않는다), 3D 묶음(three.js)은
 * 기기를 재 본 뒤에만 받는다 — 폰이 수백 KB의 3D 코드를 받아 놓고 쓰지 않는 일이 없다.
 *
 * 3D로 가는 조건(전부):
 *   · 폭 1024px 이상 + 마우스(pointer: fine) — 폰 · 태블릿은 그림이다.
 *   · navigator.deviceMemory가 4 이상(모르면 통과 — Safari · Firefox는 이 값을 주지 않는다).
 *   · «동작 줄이기»가 꺼져 있다.
 *   · WebGL2가 선다.
 * 회장이 «그림으로 보기»를 누르면 이 기기에서는 그림으로 남는다(localStorage — 기기의 사정이라 기기에 둔다).
 *
 * 1분 폴링 · 하늘 · 유령은 여기 한 곳에서 돌고 두 렌더러가 같은 값을 받는다(use-city-live.ts).
 */

const CityScene = dynamic(() => import('@/components/city/scene/city-scene'), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-video w-full items-center justify-center rounded-glass bg-[#0d1016] text-t12 text-white/60">
      3D 도시를 세우는 중…
    </div>
  ),
})

const PREFER_2D = 'chairman.city.prefer2d'

function canRun3d(): boolean {
  if (!window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches) return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof memory === 'number' && memory < 4) return false
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}

function readPrefer2d(): boolean {
  try {
    return window.localStorage.getItem(PREFER_2D) === '1'
  } catch {
    return false
  }
}

export function CityStage({
  initial,
  sky: serverSky,
  flow,
  selectedId,
  sizes,
}: {
  initial: CitySnapshot
  sky: CitySky
  /** 강물 · 구름 흐름(설정 city_motion). */
  flow: boolean
  selectedId: number | null
  sizes?: string
}) {
  const router = useRouter()
  const snap = useCitySnapshot(initial)
  const sky = useLocalSky(serverSky)
  const reduced = useReducedMotion()
  const ghosts = useCityGhosts(snap.live)
  const [capable, setCapable] = useState(false)
  const [prefer2d, setPrefer2d] = useState(false)

  useEffect(() => {
    // 기기를 재는 것은 브라우저에서만 된다 — 서버 그림(2D) 다음 첫 효과에서 한 번.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCapable(canRun3d())
    setPrefer2d(readPrefer2d())
  }, [])

  const use3d = capable && !prefer2d && !reduced
  const choose2d = (value: boolean) => {
    setPrefer2d(value)
    try {
      window.localStorage.setItem(PREFER_2D, value ? '1' : '0')
    } catch {
      // 저장이 막힌 브라우저 — 이번 화면에서만 바뀐다.
    }
  }

  return (
    <div className="relative" data-city-renderer={use3d ? '3d' : '2d'} data-city-sky={sky}>
      {use3d ? (
        <CityScene
          items={snap.items}
          live={snap.live}
          ghosts={ghosts}
          sky={sky}
          selectedId={selectedId}
          onSelect={(id) => router.push(`/group?focus=${id}`, { scroll: false })}
          reducedMotion={reduced}
        />
      ) : (
        <CityMap
          phase={imageOf(sky)}
          items={snap.items}
          selectedId={selectedId}
          focusHref={(id) => `/group?focus=${id}`}
          sizes={sizes}
          overlay={
            <CityLiveLayer items={snap.items} live={snap.live} ghosts={ghosts} sky={sky} flow={flow && !reduced} still={reduced} />
          }
        />
      )}

      {/* 하늘 표시 · 보기 전환. 3D가 설 수 있는 기기에서만 전환 단추가 선다. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 max-md:hidden">
        <span className="rounded-md bg-black/55 px-2 py-1 text-t11 text-white/90 backdrop-blur-sm">{CITY_SKY_LABEL_KO[sky]}</span>
        {capable && !reduced ? (
          <button
            type="button"
            onClick={() => choose2d(!prefer2d)}
            className="pointer-events-auto rounded-md bg-black/55 px-2 py-1 text-t11 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/75"
          >
            {prefer2d ? '3D로 보기' : '그림으로 보기'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

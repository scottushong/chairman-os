'use client'

import { CityLiveLayer } from '@/components/city/city-live-layer'
import { useCityGhosts, useCitySnapshot, useLocalSky, useReducedMotion } from '@/components/city/use-city-live'
import type { CitySky, CitySnapshot } from '@/lib/city-live'

/**
 * 서버가 그린 그림 상자(HOME 띠) 위에 얹는 살아 있는 레이어 (Phase 8 G-2b · G-3).
 * 스스로 1분마다 읽는다. 건물 · 라벨은 서버 그림 그대로 두고 사람 · 하늘만 바뀐다.
 */
export function CityLiveOverlay({ initial, sky: serverSky, flow }: { initial: CitySnapshot; sky: CitySky; flow: boolean }) {
  const snap = useCitySnapshot(initial)
  const sky = useLocalSky(serverSky)
  const reduced = useReducedMotion()
  const ghosts = useCityGhosts(snap.live)
  return <CityLiveLayer items={snap.items} live={snap.live} ghosts={ghosts} sky={sky} flow={flow && !reduced} still={reduced} />
}

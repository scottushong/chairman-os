'use client'

import { useEffect, useRef, useState } from 'react'

import { skyAt, type CityActor, type CityLive, type CitySky, type CitySnapshot } from '@/lib/city-live'

/**
 * 살아 있는 도시의 브라우저 쪽 고리 (Phase 8 G-3). 3D 씬과 그림 + 레이어가 **같은 고리**를 쓴다.
 *
 *   useCitySnapshot  1분 폴링. 탭이 안 보이면 쉬고, 다시 보이면 바로 한 번 읽는다.
 *   useLocalSky      브라우저 시계로 낮 · 해질녘 · 밤. 첫 값은 서버가 준 것(깜빡임 없이), 1분마다 다시 잰다.
 *   useReducedMotion 기기의 «동작 줄이기».
 *   useCityGhosts    폴링 사이의 **사라짐**을 그린다 — 로그아웃한 사람은 길로 걸어 나가고,
 *                    끝낸 업무의 주인은 자리에서 3초 손을 든다. 서버 규격은 «지금»만 말하므로
 *                    «방금 무엇이 끝났나»는 지난 응답과 견주는 여기서만 안다.
 */

export const POLL_MS = 60_000

export function useCitySnapshot(initial: CitySnapshot): CitySnapshot {
  const [snap, setSnap] = useState(initial)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const res = await fetch('/api/city/live', { cache: 'no-store' })
        if (res.ok && alive) setSnap((await res.json()) as CitySnapshot)
      } catch {
        // 한 번 못 읽으면 다음 분에 다시 읽는다. 도시가 멈춰 보일 뿐 화면의 본문(건물)은 그대로다.
      }
    }
    const loop = () => {
      timer = setTimeout(async () => {
        await load()
        if (alive) loop()
      }, POLL_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    loop()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return snap
}

export function useLocalSky(initial: CitySky): CitySky {
  const [sky, setSky] = useState(initial)
  useEffect(() => {
    const tick = () => setSky(skyAt(new Date().getHours()))
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])
  return sky
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** 폴링 사이에 사라진 것을 잠깐 더 세우는 유령. until(ms, Date.now 기준)이 지나면 빠진다. */
export interface CityGhost extends CityActor {
  ghost: 'exit' | 'raise'
  until: number
}

export const EXIT_MS = 8_000
export const RAISE_MS = 3_000

export function useCityGhosts(live: CityLive): CityGhost[] {
  const prev = useRef<CityLive | null>(null)
  const [ghosts, setGhosts] = useState<CityGhost[]>([])

  useEffect(() => {
    const before = prev.current
    prev.current = live
    if (!before) return
    const now = Date.now()
    const still = new Set(live.actors.map((a) => a.id))
    const done = new Set(live.doneTaskIds)
    const born: CityGhost[] = []
    for (const a of before.actors) {
      if (still.has(a.id)) continue
      if (a.id.startsWith('u:')) {
        // 들어올 때의 길을 거꾸로 — 입구에서 길로 걸어 나간다.
        born.push({ ...a, motion: 'walk', from: a.to, to: a.from, ghost: 'exit', until: now + EXIT_MS })
      } else if (a.id.startsWith('t:') && done.has(a.id)) {
        born.push({ ...a, motion: 'raise', ghost: 'raise', until: now + RAISE_MS })
      }
    }
    if (born.length === 0) return
    // 폴링 결과에 반응해 유령을 더한다 — 외부(서버) 상태를 화면 상태로 옮기는 자리다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGhosts((g) => [...g.filter((x) => x.until > now), ...born])
  }, [live])

  // 가장 먼저 끝나는 유령의 시각에 한 번 치운다.
  useEffect(() => {
    if (ghosts.length === 0) return
    const wait = Math.max(0, Math.min(...ghosts.map((g) => g.until)) - Date.now()) + 50
    const id = setTimeout(() => setGhosts((g) => g.filter((x) => x.until > Date.now())), wait)
    return () => clearTimeout(id)
  }, [ghosts])

  return ghosts
}

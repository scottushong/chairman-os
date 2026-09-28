'use client'

import { useEffect, useMemo, useRef } from 'react'

import { CityCharacterSvg } from '@/components/city/city-character'
import type { CityGhost } from '@/components/city/use-city-live'
import type { CityItem } from '@/lib/city'
import { anchorsOf, spotPoint, type CityActor, type CityLive, type CitySky, type CityVehicle } from '@/lib/city-live'
import type { CityLayout, CityPoint } from '@/types'

import s from './city-live.module.css'

/**
 * 그림 위 레이어 (Phase 8 G-2b) — HOME 띠 · 폰 · 3D 폴백이 쓴다.
 *
 * 전경 그림 상자(원본 비율, 핫스팟과 같은 상자) 안에 절대 위치로 깐다. 좌표는 전부 그림에 대한 %라서
 * 폭이 바뀌어도 사람이 건물 입구에서 떨어지지 않는다.
 *
 *   하늘  밤 = 저녁 그림 + 남색 곱하기 + 창문 점등. 구름이 흐르고 강물에 물결이 흐른다(설정에서 끔).
 *   사람  lib/city-live.ts 규격 그대로 — 걷기 · 앉아 일하기 · 서류 들고 걷기 · 손들기.
 *   광장  회장 접속 = 첨탑 빛, 브리핑 완료 = 봉투.
 *
 * 클릭을 받지 않는다(pointer-events: none) — 누르는 것은 아래 핫스팟이다.
 */

/** 오벨리스크 꼭대기(첨탑)와 봉투 자리 — 전경에서 눈으로 잰 %. lib/city-live.ts CITY_PLAZA 옆. */
const SPIRE: CityPoint = { x: 59.55, y: 47.6 }
const ENVELOPE: CityPoint = { x: 61.8, y: 64.8 }

/**
 * 강의 가운데 줄(%). 전경(city-day) 위에서 눈으로 땄다. 물결은 이 줄과 좌우로 조금 비낀 줄 셋이다.
 * 그림이 바뀌면 여기도 같이 본다.
 */
const RIVER = 'M52 31 C50.5 37, 48 43, 44.5 50 S 36 60, 35.2 67 S 38.5 77, 41.5 82 S 47 94, 49 100'

const WALK_MS = 6_000
const CARRY_MS = 10_000
const LEG_MS = 7_000

export function CityLiveLayer({
  items,
  live,
  ghosts,
  sky,
  flow,
  still,
}: {
  items: CityItem[]
  live: CityLive
  ghosts: CityGhost[]
  sky: CitySky
  /** 강물 · 구름 흐름(설정 city_motion). */
  flow: boolean
  /** «동작 줄이기» — 모든 움직임을 멈추고 사람은 도착한 자리에 선다. */
  still: boolean
}) {
  const layoutById = useMemo(() => new Map(items.map((i) => [i.layout.id, i.layout])), [items])
  const companies = useMemo(() => items.filter((i) => i.kind === 'business'), [items])
  const actors: (CityActor | CityGhost)[] = [...live.actors, ...ghosts]

  // 같은 길목에 둘 이상이 서면 옆으로 조금씩 비킨다 — 겹쳐 한 사람으로 보이지 않게.
  const slot = new Map<string, number>()
  const offsetOf = (a: CityActor) => {
    const key = JSON.stringify(a.to)
    const n = slot.get(key) ?? 0
    slot.set(key, n + 1)
    return n === 0 ? 0 : (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2) * 1.1
  }

  return (
    <div className={`${s.layer} ${still ? s.still : ''}`} aria-hidden="true">
      {sky === 'night' ? (
        <>
          <div className={s.night} />
          <div className={s.nightTint} />
        </>
      ) : null}

      {flow ? <Clouds sky={sky} /> : null}
      {flow ? <River /> : null}

      {sky !== 'day' ? <Windows companies={companies} dense={sky === 'night'} /> : null}

      {live.chairmanOnline ? <div className={s.spire} style={{ left: `${SPIRE.x}%`, top: `${SPIRE.y}%` }} /> : null}
      {live.briefDelivered ? <Envelope /> : null}

      {live.vehicles.map((v) => (
        <Vehicle key={v.id} vehicle={v} layoutById={layoutById} still={still} />
      ))}

      {actors.map((a) => (
        <Walker
          key={'ghost' in a ? `${a.id}:${a.ghost}` : a.id}
          actor={a}
          layoutById={layoutById}
          still={still}
          dx={offsetOf(a)}
        />
      ))}

      {live.robotPatrol ? <Robot companies={companies} still={still} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ 사람 */

function at(p: CityPoint, dx = 0) {
  return { left: `${p.x + dx}%`, top: `${p.y}%` }
}

function Walker({
  actor,
  layoutById,
  still,
  dx,
}: {
  actor: CityActor | CityGhost
  layoutById: Map<number, CityLayout>
  still: boolean
  dx: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const from = spotPoint(actor.from, layoutById)
  const to = spotPoint(actor.to, layoutById)
  const moving = (actor.motion === 'walk' || actor.motion === 'carry') && (from.x !== to.x || from.y !== to.y)
  const exiting = 'ghost' in actor && actor.ghost === 'exit'

  // 걸음은 Web Animations로 — 좌표가 사람마다 달라 CSS 키프레임 한 벌로 못 적는다.
  useEffect(() => {
    const el = ref.current
    if (!el || still || !moving) return
    const a = at(from, dx)
    const b = at(to, dx)
    const loop = actor.motion === 'carry'
    const anim = el.animate(
      loop
        ? [
            { ...a, opacity: 0, offset: 0 },
            { ...a, opacity: 1, offset: 0.08 },
            { ...b, opacity: 1, offset: 0.85 },
            { ...b, opacity: 0, offset: 1 },
          ]
        : exiting
          ? [
              { ...a, opacity: 1 },
              { ...b, opacity: 1, offset: 0.8 },
              { ...b, opacity: 0 },
            ]
          : [{ ...a }, { ...b }],
      { duration: loop ? CARRY_MS : WALK_MS, iterations: loop ? Infinity : 1, fill: 'forwards', easing: loop ? 'linear' : 'ease-in-out' },
    )
    return () => anim.cancel()
    // 같은 사람의 같은 길이면 다시 걷지 않는다 — 폴링마다 처음부터 걸으면 1분마다 순간 이동한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, moving, from.x, from.y, to.x, to.y, dx, actor.motion, exiting])

  // 걷는 방향으로 몸을 돌린다(왼쪽으로 가면 좌우 반전).
  const flip = moving && to.x < from.x
  const rest = still || !moving ? to : from
  const motion = still && actor.motion === 'walk' ? 'walk' : actor.motion

  return (
    <div
      ref={ref}
      className={s.actor}
      style={{ ...at(rest, dx), opacity: still && exiting ? 0 : undefined }}
      data-actor={actor.id}
      data-motion={actor.motion}
    >
      <div style={flip ? { transform: 'scaleX(-1)' } : undefined}>
        <CityCharacterSvg character={actor.character} motion={motion} />
      </div>
      {actor.label ? <span className={s.label}>{actor.label}</span> : null}
      {actor.motion === 'desk' ? (
        <span className={s.bar}>
          {typeof actor.progress === 'number' ? (
            <span className={s.barFill} style={{ display: 'block', width: `${Math.round(actor.progress * 100)}%` }} />
          ) : (
            <span className={s.barFlow} style={{ display: 'block' }} />
          )}
        </span>
      ) : null}
    </div>
  )
}

/** AI Job이 도는 동안 로봇이 회사들 앞 길을 차례로 돈다(왼쪽 → 오른쪽 → 처음). */
function Robot({ companies, still }: { companies: CityItem[]; still: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const route = useMemo(
    () => [...companies].sort((a, b) => a.layout.x - b.layout.x).map((c) => anchorsOf(c.layout).road),
    [companies],
  )
  const key = route.map((p) => `${p.x},${p.y}`).join(' ')

  useEffect(() => {
    const el = ref.current
    if (!el || still || route.length < 2) return
    const loop = [...route, route[0]]
    const anim = el.animate(
      loop.map((p) => at(p)),
      { duration: LEG_MS * (loop.length - 1), iterations: Infinity, easing: 'linear' },
    )
    return () => anim.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, key])

  if (route.length === 0) return null
  return (
    <div ref={ref} className={s.actor} style={at(route[0])} data-actor="robot" data-motion="walk">
      <CityCharacterSvg character="robot" motion="walk" />
    </div>
  )
}

function Vehicle({ vehicle, layoutById, still }: { vehicle: CityVehicle; layoutById: Map<number, CityLayout>; still: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const from = spotPoint(vehicle.from, layoutById)
  const to = spotPoint(vehicle.to, layoutById)

  useEffect(() => {
    const el = ref.current
    if (!el || still) return
    const anim = el.animate([at(from), at(to)], {
      duration: 12_000,
      iterations: Infinity,
      direction: 'alternate',
      easing: 'ease-in-out',
    })
    return () => anim.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, from.x, from.y, to.x, to.y])

  return (
    <div ref={ref} className={s.vehicle} style={at(from)} data-vehicle={vehicle.id} title={vehicle.label}>
      <svg viewBox="0 0 24 14" aria-hidden="true" style={{ display: 'block', width: '100%', height: 'auto' }}>
        <ellipse cx="12" cy="12.8" rx="10" ry="1.2" fill="rgba(0,0,0,.3)" />
        <path d="M2 9 Q2 6 5 6 L7.5 3 Q8.3 2 9.6 2 L15 2 Q16.4 2 17.2 3 L19.4 6 Q22 6.2 22 9 L22 10.5 L2 10.5 Z" fill="#c8a55e" />
        <path d="M8.3 3.4 L10.6 3.4 L10.6 6 L6.6 6 Z M12 3.4 L15 3.4 Q15.8 3.4 16.3 4 L17.6 6 L12 6 Z" fill="#23303b" />
        <circle cx="6.5" cy="10.8" r="2" fill="#1b1b1b" />
        <circle cx="17.5" cy="10.8" r="2" fill="#1b1b1b" />
        <rect x="20.6" y="7.4" width="1.4" height="1" rx=".4" fill="#fff4c8" />
      </svg>
    </div>
  )
}

function Envelope() {
  return (
    <div className={s.envelope} style={at(ENVELOPE)} data-envelope="brief">
      <svg viewBox="0 0 20 14" aria-hidden="true" style={{ display: 'block', width: '100%', height: 'auto' }}>
        <rect x="1" y="1" width="18" height="12" rx="1.4" fill="#fbfaf6" stroke="#cbbf9f" strokeWidth=".6" />
        <path d="M1.4 1.8 L10 8 L18.6 1.8" fill="none" stroke="#cbbf9f" strokeWidth=".7" />
        <circle cx="10" cy="8" r="2.1" fill="#b8913f" />
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ 하늘 · 물 · 창 */

const CLOUDS = [
  { top: 3, w: 22, h: 7, dur: 140, delay: -20 },
  { top: 9, w: 30, h: 8, dur: 190, delay: -110 },
  { top: 1, w: 16, h: 5, dur: 120, delay: -70 },
  { top: 14, w: 26, h: 6, dur: 170, delay: -150 },
]

function Clouds({ sky }: { sky: CitySky }) {
  const alpha = sky === 'night' ? 0.25 : sky === 'dusk' ? 0.6 : 0.85
  return (
    <>
      {CLOUDS.map((c, i) => (
        <div
          key={i}
          className={s.cloud}
          style={{
            left: 0,
            top: `${c.top}%`,
            width: `${c.w}%`,
            height: `${c.h}%`,
            opacity: alpha,
            animationDuration: `${c.dur}s`,
            animationDelay: `${c.delay}s`,
          }}
        />
      ))}
    </>
  )
}

function River() {
  return (
    <svg className={s.river} viewBox="0 0 100 100" preserveAspectRatio="none">
      {[
        { dx: 0, dash: '1.2 5', w: 1.6, dur: 9 },
        { dx: -1.4, dash: '0.8 7', w: 1.1, dur: 12 },
        { dx: 1.3, dash: '1 6', w: 1.2, dur: 10.5 },
      ].map((l, i) => (
        <path
          key={i}
          d={RIVER}
          className={s.riverLine}
          transform={`translate(${l.dx} 0)`}
          strokeDasharray={l.dash}
          strokeWidth={l.w}
          vectorEffect="non-scaling-stroke"
          style={{ animationDuration: `${l.dur}s` }}
        />
      ))}
    </svg>
  )
}

/** 결정적인 난수 — 같은 건물은 늘 같은 창이 켜진다(새로고침마다 창이 바뀌면 불안하다). */
function rng(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function Windows({ companies, dense }: { companies: CityItem[]; dense: boolean }) {
  const dots = useMemo(() => {
    const out: { x: number; y: number; d: number }[] = []
    for (const c of companies) {
      const { x, y, w, h } = c.layout
      const next = rng(c.layout.id * 7919)
      const n = Math.min(46, Math.round(((w * h) / 9) * (dense ? 1 : 0.35)))
      for (let i = 0; i < n; i++) {
        out.push({ x: x + w * (0.18 + next() * 0.64), y: y + h * (0.06 + next() * 0.74), d: next() * 7 })
      }
    }
    // 배경 도시의 불빛 — 회사가 아닌 건물도 밤에는 켜져 있다. 스카이라인 띠(15~48%)에 흩뿌린다.
    const next = rng(20260928)
    const m = dense ? 140 : 40
    for (let i = 0; i < m; i++) out.push({ x: next() * 100, y: 15 + next() * 33, d: next() * 7 })
    return out
  }, [companies, dense])

  return (
    <>
      {dots.map((p, i) => (
        <span key={i} className={s.window} style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `-${p.d.toFixed(2)}s` }} />
      ))}
    </>
  )
}

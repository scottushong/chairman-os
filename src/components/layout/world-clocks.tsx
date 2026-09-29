'use client'

import { useEffect, useState } from 'react'

import { formatOffsetDiff, HOME_CITY_ID, isDaytimeIn, tzOffsetMinutes, type WorldCity } from '@/lib/world-cities'

/**
 * 세계시간 격자 — 대시보드 «날씨와 세계시간» 카드와 아침 루틴 인사 칸이 같이 쓴다.
 *
 * 도시는 부르는 쪽이 넘긴다(app_prefs.world_cities → lib/world-cities.ts). 한 벌이라
 * 시계와 날씨가 다른 도시를 보는 일이 없다.
 *
 * 열 곳은 한 줄에 서지 않는다 — 상자가 넓으면 **5개씩 줄**, 좁으면(폰 · 1024px 화면의 1/4 카드)
 * **가로 스크롤**이다. 기준은 뷰포트가 아니라 **이 상자의 폭**(@container, 250px)이다. 폰은 상자가 넓어도 가로 스크롤이다(회장 지시) —
 * 대시보드 카드는 넓은 화면에서도 좁다. 서울은 늘 첫 칸이고 시각을 크게 쓴다.
 *
 * 각 도시 옆 «+8h»는 **이 기기의 시각과의 차이**다. 회장이 여는 기기가 곧 회장이 있는 자리다 —
 * 아침 인사 칸의 큰 시계가 브라우저 로컬 시각인 것과 같은 기준이다(greeting-clock.tsx).
 * 해·달은 그 도시의 현지 06~18시를 낮으로 친다.
 *
 * 서버는 UTC로 렌더링된다 — 서버에서 시각을 찍으면 브라우저와 달라 하이드레이션이 어긋난다.
 * 그래서 null로 시작해 마운트 뒤 타이머 콜백에서만 채운다('--:--'로 자리를 먼저 잡는다).
 */

interface Reading {
  time: string
  diff: string
  day: boolean
}

function read(cities: WorldCity[]): Reading[] {
  const now = new Date()
  const local = -now.getTimezoneOffset()
  return cities.map(({ tz }) => ({
    time: new Intl.DateTimeFormat('ko-KR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now),
    diff: formatOffsetDiff(tzOffsetMinutes(tz, now) - local),
    day: isDaytimeIn(tz, now),
  }))
}

/** 해 · 달. weather-icon.tsx의 그림 여섯에는 달이 없고, 날씨 그림과 섞이지 않게 여기 따로 둔다. */
function DayNight({ day }: { day: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-label={day ? '낮' : '밤'}
      role="img"
      className={`size-3 shrink-0 ${day ? 'text-gold' : 'text-ink-muted'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {day ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.1 5.1l1.4 1.4M17.5 17.5l1.4 1.4M5.1 18.9l1.4-1.4M17.5 6.5l1.4-1.4" />
        </>
      ) : (
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
      )}
    </svg>
  )
}

export function WorldClocks({
  cities,
  size = 'card',
}: {
  cities: WorldCity[]
  /** card = 대시보드 1/4 카드(좁다) · panel = 아침 루틴 인사 칸 */
  size?: 'card' | 'panel'
}) {
  // null = 마운트 전. 서버와 첫 클라이언트 렌더가 똑같이 '--:--'를 그려야 하이드레이션이 맞는다.
  const [readings, setReadings] = useState<Reading[] | null>(null)

  useEffect(() => {
    // 첫 갱신도 타이머 콜백 안에서 한다(react-hooks/set-state-in-effect).
    // 15초마다 — 1분이면 분이 바뀐 뒤 최대 59초 늦게 넘어간다.
    const tick = () => setReadings(read(cities))
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 15_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [cities])

  const panel = size === 'panel'

  return (
    <div className="@container">
      <ul
        aria-label="세계 시간"
        className={[
          // 좁은 상자: 한 줄 가로 스크롤. 폭 640px 이상 화면에서 상자가 250px 이상이면 5개씩 줄.
          'flex snap-x gap-x-3 overflow-x-auto pb-1',
          'sm:@min-[250px]:grid sm:@min-[250px]:grid-cols-5 sm:@min-[250px]:overflow-visible sm:@min-[250px]:pb-0',
          panel ? 'gap-y-2.5' : 'gap-y-1.5',
        ].join(' ')}
      >
        {cities.map((c, i) => {
          const r = readings?.[i]
          const home = c.id === HOME_CITY_ID
          const label = panel ? c.nameKo : (c.shortKo ?? c.nameKo)
          return (
            <li
              key={c.id}
              title={`${c.nameKo} · ${c.tz}${r ? ` · 이 기기 시각과 ${r.diff}` : ''}`}
              className="min-w-[58px] shrink-0 snap-start leading-tight sm:@min-[250px]:min-w-0"
            >
              <span
                className={`block truncate ${panel ? 'text-t10' : 'text-t9'} ${home ? 'font-semibold text-ink' : 'text-ink-muted'}`}
              >
                {label}
              </span>
              <span
                className={[
                  'block tnum',
                  home
                    ? `${panel ? 'text-t18' : 'text-t14'} font-bold text-ink`
                    : `${panel ? 'text-t13' : 'text-t11'} text-ink-dim`,
                ].join(' ')}
              >
                {r?.time ?? '--:--'}
              </span>
              <span className={`flex items-center gap-0.5 tnum text-ink-muted ${panel ? 'text-t10' : 'text-t9'}`}>
                {r ? (
                  <>
                    <DayNight day={r.day} />
                    {r.diff}
                  </>
                ) : (
                  ' '
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

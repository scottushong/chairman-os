'use client'

import { useEffect, useState } from 'react'

import { weatherAtCoordinates } from '@/app/actions/weather'
import { useGeolocation } from '@/components/morning/use-geolocation'
import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'
import { WeatherIcon } from '@/components/ui/weather-icon'
import type { Coordinates } from '@/lib/cities'
// 값은 순수 어휘 모듈(cities.ts / weather-codes.ts)에서만 가져온다. lib/weather.ts나
// lib/geo.ts에서 값을 가져오면 next/headers가 이 클라이언트 번들로 끌려 들어와 빌드가 깨진다.
// geo.ts는 import 'server-only'로 봉해 두었으므로 실수하면 바로 터진다.
import { weatherIconFor } from '@/lib/weather-codes'
import type { CityWeather, WeatherCurrent } from '@/lib/weather'

/**
 * 상단 3칸 중 둘째 칸 — 현재 위치 날씨 + 관심 도시.
 *
 * 요구사항은 "현재 위치 + 관심 도시(호치민·싱가폴·상하이·두바이·토론토·SF)"다.
 * 관심 도시는 서버가 한 번에 불러(getBusinessCitiesWeather, 좌표 6개를 콤마로 묶은 요청 하나)
 * 내려 준다 — 이 컴포넌트는 그리기만 한다. 브라우저 위치 버튼은 현재 위치만 바꾼다.
 *
 * 아침에 훑는 칸이라 도시는 3칸 2줄로 접어 이름과 기온만 둔다. 날씨 앱이 아니다 —
 * 라벨(맑음/비)까지 넣으면 여섯 줄이 되어 이 칸이 옆 두 칸보다 두 배 길어진다.
 *
 * 처음 뜨는 값은 서버가 정한 위치다(P5-5b resolveLocation → getCurrentLocationWeather).
 * Vercel 엣지의 IP 헤더가 있으면 그 도시, 없으면 서울 기본값이다.
 *
 * **브라우저 위치 권한은 버튼을 눌렀을 때만 묻는다.** 아침에 화면을 열자마자 권한 팝업이
 * 뜨면 안 된다(use-geolocation.ts의 계약). 거부·미지원이면 서버가 정한 위치가 그대로 남는다 —
 * 이 칸이 비거나 오류로 바뀌지 않는다.
 *
 * 날씨를 못 불러오면(외부 API 실패) "날씨를 불러오지 못했습니다"로 떨어진다.
 * 아침에 회장이 여는 첫 화면이 Open-Meteo 때문에 비면 안 되므로, 실패는 이 칸 안에서 끝난다.
 */
export function WeatherPanel({
  city,
  source,
  initial,
  cities,
}: {
  /** 서버가 정한 도시 이름 */
  city: string
  /** 'vercel-ip' = IP로 구한 위치 | 'default' = 서울 기본값 */
  source: 'vercel-ip' | 'default'
  /** 서버가 미리 불러 둔 그 위치의 현재 날씨. 실패했으면 null이다. */
  initial: WeatherCurrent | null
  /** 관심 도시 6곳. 도시별 current가 null이면 그 도시만 부분 실패다(weather.ts). */
  cities: CityWeather[]
}) {
  const { coordinates, status, locate } = useGeolocation()
  /**
   * null = 아직 브라우저 위치로 바꾼 적이 없다. 그동안은 서버 값(initial)을 그린다.
   * 어느 좌표에 대한 답인지(for)를 같이 들고 있는 이유는 '불러오는 중'을 따로 저장하지 않기
   * 위해서다 — effect 본문에서 setState를 부르면 react-hooks/set-state-in-effect에 걸린다.
   * 답이 지금 좌표의 것이 아니면 그게 곧 '불러오는 중'이라, 상태 하나로 세 경우가 다 갈린다.
   */
  const [answer, setAnswer] = useState<{ for: Coordinates; current: WeatherCurrent | null } | null>(
    null,
  )

  useEffect(() => {
    if (!coordinates) return
    // setState는 Server Action의 응답 콜백 안에서만 부른다(effect 본문이 아니다).
    let alive = true
    void weatherAtCoordinates(coordinates)
      .then((result) => {
        if (alive) setAnswer({ for: coordinates, current: result })
      })
      .catch(() => {
        // 거절도 답으로 친다. 안 받아 주면 answer가 영영 비고, busy가 그 값에서 나오므로
        // 버튼이 '확인 중…'에 영구히 잠긴다 — 실패가 이 칸 안에서 끝난다는 약속이 깨진다.
        if (alive) setAnswer({ for: coordinates, current: null })
      })
    return () => {
      alive = false
    }
  }, [coordinates])

  const usingBrowser = answer !== null
  const current = answer ? answer.current : initial
  const placeLabel = usingBrowser ? '현재 위치' : city
  // 좌표는 있는데 그 좌표의 답이 아직 없으면 날씨를 부르는 중이다.
  const busy = status === 'locating' || (coordinates !== null && answer?.for !== coordinates)

  // 못 불러온 도시는 빼고 가진 것만 그린다(weather.ts의 부분 실패 계약). 전부 비면 아래에서
  // 한 줄로 밝힌다 — 그래도 이 칸 밖(나머지 화면)은 그대로 뜬다.
  // flatMap으로 거르는 것은 타입 때문이다 — filter로는 current가 null이 아님이 안 좁혀져
  // 그리는 자리에서 단언(!)을 쓰게 된다.
  const shownCities = cities.flatMap(({ city: c, current }) =>
    current
      ? [{ id: c.id, nameKo: c.nameKo, temperatureC: current.temperatureC, code: current.code }]
      : [],
  )

  return (
    <GlassCard as="section" aria-label="날씨 — 현재 위치와 관심 도시" className="flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Icon name="pin" className="size-3.5 shrink-0 text-ink-muted" />
          <span className="truncate">{placeLabel}</span>
        </p>
        <button
          type="button"
          onClick={locate}
          disabled={busy}
          title="브라우저 위치 권한을 물어 지금 있는 자리의 날씨로 바꿉니다."
          className="shrink-0 rounded-md border border-line bg-raised px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? '확인 중…' : '현재 위치'}
        </button>
      </div>

      {current ? (
        // 그림은 기온 왼쪽에 크게 선다. items-center인 이유는 52px 숫자와 아이콘의
        // 시각 중심을 맞추기 위해서다 — baseline에 걸면 구름이 숫자보다 위로 뜬다.
        <p className="mt-4 flex items-center gap-3 text-ink">
          <WeatherIcon
            name={weatherIconFor(current.code)}
            className="size-11 shrink-0 text-ink-dim"
          />
          <span className="flex items-baseline gap-2">
            <span className="text-[52px] leading-none font-bold tnum">
              {Math.round(current.temperatureC)}°
            </span>
            {/* 날씨 코드는 WEATHER_CODE_LABEL_KO를 거쳐 온 라벨이다 — 날것의 숫자는 화면에 못 나간다. */}
            <span className="text-[14px] text-ink-dim">{current.labelKo}</span>
          </span>
        </p>
      ) : (
        <p className="mt-4 text-[13px] text-ink-muted">날씨를 불러오지 못했습니다.</p>
      )}

      {/* 관심 도시. 전부 GlassCard 안이라 ink-muted를 써도 된다 —
          라이트는 5.39(최악 4.64), 다크는 어두운 스크림 위 7.03이다(globals.css). */}
      {shownCities.length > 0 ? (
        <ul
          aria-label="관심 도시 날씨"
          className="mt-4 grid grid-cols-3 gap-x-3 gap-y-1 border-t border-line-soft pt-3"
        >
          {shownCities.map((c) => (
            // 도시 줄은 아이콘이 붙어도 한 줄 그대로다 — 이름 옆에 들어가지
            // 아래로 늘어나지 않는다. 위 주석의 '여섯 줄이 되면 안 된다'가 그대로 유효하다.
            <li key={c.id} className="flex items-center justify-between gap-1 text-[11px]">
              <span className="flex min-w-0 items-center gap-1 text-ink-muted">
                <WeatherIcon name={weatherIconFor(c.code)} className="size-3.5 shrink-0" />
                <span className="truncate">{c.nameKo}</span>
              </span>
              <span className="shrink-0 text-ink tnum">{Math.round(c.temperatureC)}°</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 border-t border-line-soft pt-3 text-[11px] text-ink-muted">
          관심 도시 날씨를 불러오지 못했습니다.
        </p>
      )}

      <p className="mt-3 text-[11px] text-ink-muted">
        {status === 'denied'
          ? '위치 권한이 거부되었습니다. 접속 위치로 표시합니다.'
          : status === 'unsupported'
            ? '이 브라우저는 위치를 알려주지 않습니다. 접속 위치로 표시합니다.'
            : status === 'error'
              ? '위치를 확인하지 못했습니다. 접속 위치로 표시합니다.'
              : usingBrowser
                ? '브라우저가 알려 준 위치입니다.'
                : source === 'default'
                  ? '접속 위치를 알 수 없어 서울 기준입니다.'
                  : '접속 IP로 추정한 위치입니다.'}
      </p>
    </GlassCard>
  )
}

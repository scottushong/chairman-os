'use client'

import { useEffect, useState } from 'react'

import { weatherAtCoordinates } from '@/app/actions/weather'
import { useGeolocation } from '@/components/morning/use-geolocation'
import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'
import type { Coordinates } from '@/lib/geo'
import type { WeatherCurrent } from '@/lib/weather'

/**
 * 상단 3칸 중 둘째 칸 — 현재 위치 날씨.
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
}: {
  /** 서버가 정한 도시 이름 */
  city: string
  /** 'vercel-ip' = IP로 구한 위치 | 'default' = 서울 기본값 */
  source: 'vercel-ip' | 'default'
  /** 서버가 미리 불러 둔 그 위치의 현재 날씨. 실패했으면 null이다. */
  initial: WeatherCurrent | null
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

  return (
    <GlassCard as="section" aria-label="현재 위치 날씨" className="flex flex-col justify-between">
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
        <p className="mt-4 flex items-baseline gap-2 text-ink">
          <span className="text-[52px] leading-none font-bold tnum">
            {Math.round(current.temperatureC)}°
          </span>
          {/* 날씨 코드는 WEATHER_CODE_LABEL_KO를 거쳐 온 라벨이다 — 날것의 숫자는 화면에 못 나간다. */}
          <span className="text-[14px] text-ink-dim">{current.labelKo}</span>
        </p>
      ) : (
        <p className="mt-4 text-[13px] text-ink-muted">날씨를 불러오지 못했습니다.</p>
      )}

      <p className="mt-4 border-t border-line-soft pt-3 text-[11px] text-ink-muted">
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

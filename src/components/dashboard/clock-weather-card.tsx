import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'
import { WorldClocks } from '@/components/layout/world-clocks'
import { WeatherIcon } from '@/components/ui/weather-icon'
import { weatherIconFor } from '@/lib/weather-codes'
import type { WeatherCurrent } from '@/lib/weather'

/**
 * 날씨 + 세계시간 카드 (Phase 5-D 1줄 우측 1/4).
 *
 * 헤더에 칩으로 있던 둘을 카드로 옮겼다. 헤더에서는 11px 글자 한 줄이라 훑기 어려웠고,
 * 검색창이 가장 넓은 자리를 써야 하는 바에서 자리만 다투고 있었다.
 * 카드로 내리면 기온을 크게 쓸 수 있고 도시 네 곳의 시각이 나란히 선다.
 *
 * 날씨를 못 불러오면 그 칸만 빠지고 시계는 그대로 선다 — 외부 API 하나가
 * 카드 전체를 비우지 않는다(lib/weather.ts의 계약과 같다).
 */
export function ClockWeatherCard({
  city,
  weather,
}: {
  city: string
  weather: WeatherCurrent | null
}) {
  return (
    <GlassCard as="section" padding="p-3.5" aria-label="날씨와 세계시간" className="flex h-full flex-col justify-between">
      <div>
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Icon name="pin" className="size-3.5 shrink-0 text-ink-muted" />
          <span className="truncate">{city}</span>
        </p>

        {weather ? (
          <p className="mt-2.5 flex items-center gap-2.5 text-ink">
            <WeatherIcon
              name={weatherIconFor(weather.code)}
              className="size-8 shrink-0 text-ink-dim"
            />
            <span className="flex items-baseline gap-1.5">
              <span className="text-[34px] leading-none font-bold tnum">
                {Math.round(weather.temperatureC)}°
              </span>
              <span className="text-[12px] text-ink-dim">{weather.labelKo}</span>
            </span>
          </p>
        ) : (
          <p className="mt-2.5 text-[12px] text-ink-muted">날씨를 불러오지 못했습니다.</p>
        )}
      </div>

      {/* 세계시간. 헤더에서 쓰던 컴포넌트를 그대로 쓴다 — 브라우저 로컬 시각으로 1분마다 갱신한다. */}
      <div className="mt-3 border-t border-line-soft pt-2.5">
        <WorldClocks />
      </div>
    </GlassCard>
  )
}

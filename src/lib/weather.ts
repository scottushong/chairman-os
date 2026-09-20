import { BUSINESS_CITIES, type BusinessCity, type Coordinates } from '@/lib/cities'
import { weatherLabel } from '@/lib/weather-codes'

/**
 * Open-Meteo 현재 날씨. 키 없이 익명으로 부른다(초당 요청 제한만 있음).
 *
 * 실패해도 화면이 죽지 않는다 — 아침에 회장이 여는 첫 화면이 외부 API 때문에 통째로
 * 비면 안 된다. 모든 실패 경로(네트워크 에러, 429, 5xx, 응답 파싱 실패)는 null로
 * 수렴하고, 패널(P5-5c)이 null을 "날씨를 불러오지 못했습니다"로 그린다.
 */

export interface WeatherCurrent {
  temperatureC: number
  code: number
  labelKo: string
}

/** Open-Meteo current 블록의 생김새만 필요한 만큼 선언한다 — 나머지 필드(elevation 등)는 안 쓴다. */
interface OpenMeteoEntry {
  current?: {
    temperature_2m: number
    weather_code: number
  }
  // 두 번째 항목부터 붙는다(①). 매칭에는 쓰지 않지만 존재는 알아 둔다.
  location_id?: number
}

/**
 * 좌표 목록으로 한 번에 현재 날씨를 부른다. 도시마다 따로 부르면 N번 왕복이라
 * Open-Meteo가 지원하는 콤마 결합 좌표로 단일 요청을 쓴다.
 *
 * 좌표가 하나면 응답이 객체 하나로 오고, 여럿이면 배열로 온다(같은 URL 모양인데도) —
 * 그래서 항상 배열로 정규화한 뒤 진행한다. 정규화를 건너뛰면 "현재 위치 한 곳만 부르는"
 * 이 화면의 기본 경로(coords.length === 1)에서 바로 깨진다.
 *
 * 응답을 요청 좌표에 되맞출 때 location_id를 쓰지 않는다 — 첫 항목엔 그 필드가 없다.
 * 대신 "요청에 넣은 좌표 순서 == 응답 배열 순서"라는 Open-Meteo의 동작에 기대어
 * 인덱스로 짝짓는다. 응답이 요청보다 짧으면(부분 실패) 넘치는 뒤쪽 인덱스는 그냥 null —
 * 없는 도시는 빼고 가진 것만 그리게 둔다.
 *
 * 30분 캐시: 회장이 아침에 이 화면을 여러 번 새로고침해도 Open-Meteo를 다시 때리지
 * 않기 위해서다. 현재 날씨는 30분 안에 체감상 안 바뀌고, 더 짧게 잡을 이유가 없다 —
 * 반대로 더 길면(예: 3시간) 낮 동안 화면을 열었을 때 아침 숫자가 그대로 남는다.
 */
async function fetchOpenMeteoCurrent(coords: Coordinates[]): Promise<(WeatherCurrent | null)[]> {
  if (coords.length === 0) return []

  const latitude = coords.map((c) => c.latitude).join(',')
  const longitude = coords.map((c) => c.longitude).join(',')
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,weather_code&timezone=auto`

  try {
    // cache: 'force-cache'가 있어야 실제로 캐시된다. Next 16에서 캐시는 opt-in이라
    // next.revalidate만 두면 아무것도 안 붙는다(node_modules/next/dist/docs의 fetch.md:
    // "Caching is opt-in"). /ai도 대시보드도 쿠키를 읽는 동적 라우트라, 이 한 줄이 없으면
    // 화면을 새로고침할 때마다 Open-Meteo를 때린다 — 30분 캐시는 주석에만 있고 없었다.
    const res = await fetch(url, { cache: 'force-cache', next: { revalidate: 1800 } })
    if (!res.ok) return coords.map(() => null)

    const json: unknown = await res.json()
    // 배열이 아니면(좌표 1개) 배열로 감싼다 — ①의 정규화.
    const entries = (Array.isArray(json) ? json : [json]) as OpenMeteoEntry[]

    // ②의 인덱스 매칭. entries[i]가 없으면(응답이 짧으면) 그 도시는 null.
    return coords.map((_, i) => {
      const entry = entries[i]
      if (!entry?.current) return null
      const code = entry.current.weather_code
      return {
        temperatureC: entry.current.temperature_2m,
        code,
        labelKo: weatherLabel(code),
      }
    })
  } catch {
    // 네트워크 에러 · 타임아웃 · 레이트리밋 등 무엇이든 여기서 삼킨다.
    return coords.map(() => null)
  }
}

/** 회장이 지금 있는 곳의 날씨. resolveLocation()의 좌표를 그대로 넘겨 부른다. */
export async function getCurrentLocationWeather(coordinates: Coordinates): Promise<WeatherCurrent | null> {
  const [current] = await fetchOpenMeteoCurrent([coordinates])
  return current ?? null
}

export interface CityWeather {
  city: BusinessCity
  current: WeatherCurrent | null
}

/** 사업 도시 6곳의 날씨를 한 번에. 도시별 null은 부분 실패 — 패널이 있는 도시만 그린다. */
export async function getBusinessCitiesWeather(): Promise<CityWeather[]> {
  const results = await fetchOpenMeteoCurrent(BUSINESS_CITIES.map((c) => c.coordinates))
  return BUSINESS_CITIES.map((city, i) => ({ city, current: results[i] ?? null }))
}

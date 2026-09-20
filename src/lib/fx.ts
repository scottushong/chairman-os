/**
 * frankfurter 환율. 키 없이 익명으로 부른다(ECB 기준환율 재배포).
 *
 * lib/weather.ts와 같은 규칙이다 — 모든 실패 경로(네트워크 에러, 4xx/5xx, 파싱 실패,
 * 모양이 다른 응답)가 null로 수렴하고, 띠(FxStrip)가 null을 "환율을 불러오지 못했습니다"로
 * 그린다. 아침에 회장이 여는 첫 화면이 외부 API 때문에 통째로 비면 안 된다.
 *
 * **base=EUR로 부른다. base=KRW가 아니다.**
 * frankfurter 응답은 소수점 5자리라 KRW를 기준으로 부르면 USD가 0.00072로 뭉개지고,
 * 하루 5원이 움직여도 두 날이 같은 값이 된다 — 전일비 화살표가 영원히 '변동 없음'이 된다.
 * ECB 원본 방향인 EUR 기준으로 받아 KRW/EUR ÷ X/EUR로 교차하면 정밀도가 산다.
 * scripts/check-fx.ts의 krwBaseLosesTheChange()가 이 회귀를 숫자로 못 박아 둔다.
 *
 * **VND·AED는 없다.** frankfurter는 ECB가 고시하는 30개 통화만 준다.
 * 호치민·두바이는 사업 도시지만 이 띠에 칸이 서지 않는다(DEFERRED 기록).
 */

/** 띠에 세우는 통화. BUSINESS_CITIES 여섯 곳 중 다섯이 여기 대응한다(호치민·두바이 제외, EUR 추가). */
export const FX_CODES = ['USD', 'EUR', 'CNY', 'CAD', 'SGD'] as const
export type FxCode = (typeof FX_CODES)[number]

/** 하루치 EUR 기준 환율. 값은 'EUR 1당 그 통화 얼마'다. */
export type EurRates = Record<string, number>
/** 날짜(YYYY-MM-DD) → 그날의 EUR 기준 환율. */
export type EurSeries = Record<string, EurRates>

export interface FxChip {
  code: string
  /** 그 통화 1단위가 몇 원인가. 반올림하지 않는다 — 자리수는 화면이 정한다. */
  krw: number
  deltaKrw: number
  deltaPct: number
  direction: 'up' | 'down' | 'flat'
}

export interface FxStrip {
  /** 기준일. '오늘'이 아니라 ECB가 마지막으로 고시한 날이다. */
  asOf: string
  /** 전일비의 '전일'. 달력상 어제가 아니라 직전 고시일이다. */
  comparedTo: string
  chips: FxChip[]
}

function usable(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0
}

/**
 * EUR 기준 한 줄에서 '그 통화 1단위 = 몇 원'을 뽑는다.
 *
 * EUR만 교차가 필요 없다 — KRW/EUR 그 자체가 답이다.
 * 분모가 없거나 0이면 null이다. 나누지 않는다.
 */
export function crossRate(rates: EurRates, code: string): number | null {
  const krwPerEur = rates?.KRW
  if (!usable(krwPerEur)) return null
  if (code === 'EUR') return krwPerEur

  const perEur = rates[code]
  if (!usable(perEur)) return null
  return krwPerEur / perEur
}

/**
 * 응답에 실제로 있는 마지막 두 고시일.
 *
 * ECB는 주말·공휴일에 발표하지 않으므로 '어제'를 계산해서 찾으면 안 된다 —
 * 월요일 아침이면 금요일이 직전 고시일이고, 연휴 뒤에는 나흘 전일 수도 있다.
 * 빈 줄({})은 고시가 없는 날이라 세지 않는다.
 */
export function lastTwoDays(series: EurSeries): [string, string] | null {
  const days = Object.keys(series ?? {})
    .filter((day) => Object.keys(series[day] ?? {}).length > 0)
    .sort()
  if (days.length < 2) return null
  return [days[days.length - 2], days[days.length - 1]]
}

/**
 * 시계열을 칩 한 벌로 접는다.
 *
 * 지원하지 않는 통화(VND·AED)는 그 칸만 빠지고 띠는 선다 —
 * 통화 하나 때문에 환율 전체를 버릴 이유는 없다(lib/weather.ts의 도시별 부분 실패와 같다).
 */
export function buildChips(series: EurSeries, codes: readonly string[]): FxStrip | null {
  if (codes.length === 0) return null

  const days = lastTwoDays(series)
  if (!days) return null
  const [comparedTo, asOf] = days

  const chips: FxChip[] = []
  for (const code of codes) {
    const before = crossRate(series[comparedTo], code)
    const now = crossRate(series[asOf], code)
    if (before === null || now === null) continue

    const deltaKrw = now - before
    chips.push({
      code,
      krw: now,
      deltaKrw,
      deltaPct: (deltaKrw / before) * 100,
      direction: deltaKrw > 0 ? 'up' : deltaKrw < 0 ? 'down' : 'flat',
    })
  }

  if (chips.length === 0) return null
  return { asOf, comparedTo, chips }
}

/**
 * 시계열 시작일. 열흘을 거슬러 잡는다 —
 * 주말 이틀로는 연말·설 연휴에 고시일 두 개를 못 채워 전일비가 빈다.
 */
function seriesStart(today: Date): string {
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 10)
  return start.toISOString().slice(0, 10)
}

/** frankfurter.app은 2024년에 .dev/v1로 옮겼다. .app을 부르면 301이 돌아온다. */
const FRANKFURTER = 'https://api.frankfurter.dev/v1'

/**
 * 띠에 필요한 것을 한 번의 왕복으로 받는다.
 *
 * **cache: 'force-cache'를 명시한다.** Next 16에서 캐시는 opt-in이라
 * next.revalidate만 두면 캐시가 붙지 않는다(node_modules/next/dist/docs의 fetch.md).
 * /ai는 쿠키를 읽어 동적 라우트라 그냥 두면 요청마다 ECB를 때린다.
 * 30분은 lib/weather.ts와 맞춘 값이다 — 고시는 하루 한 번이라 더 짧을 이유가 없다.
 */
export async function getFxStrip(now: Date = new Date()): Promise<FxStrip | null> {
  // EUR은 base라 symbols에 넣지 않는다. KRW는 교차의 분자라 반드시 넣는다.
  const symbols = ['KRW', ...FX_CODES.filter((code) => code !== 'EUR')].join(',')
  const url = `${FRANKFURTER}/${seriesStart(now)}..?base=EUR&symbols=${symbols}`

  try {
    const res = await fetch(url, { cache: 'force-cache', next: { revalidate: 1800 } })
    if (!res.ok) return null

    const json: unknown = await res.json()
    const series = (json as { rates?: EurSeries })?.rates
    if (!series || typeof series !== 'object') return null

    return buildChips(series, FX_CODES)
  } catch {
    // 네트워크 에러 · 타임아웃 · 레이트리밋 · JSON 파싱 실패 — 무엇이든 여기서 삼킨다.
    return null
  }
}

/** 화면 표기 규칙. 숫자는 전부 여기를 거쳐서 나간다. */

const EOK = 100_000_000

/**
 * 원 단위 금액을 억으로 줄여 쓴다. Chairman 화면의 기본 단위다.
 * 1000억을 넘어가면 소수점을 떼서 자리수 흔들림을 막는다.
 */
export function formatEok(value: number, digits?: number): string {
  const eok = value / EOK
  const d = digits ?? (Math.abs(eok) >= 1000 ? 0 : 1)
  return `${eok.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })}억`
}

/** 전기 대비 증감률. 부호를 항상 붙여 상승/하락을 글자만 보고도 알게 한다. */
export function formatDeltaPct(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '' : ''
  return `${sign}${pct.toFixed(1)}%`
}

export function formatPct(pct: number): string {
  return `${Math.round(pct)}%`
}

/** D-Day. 마감일은 저장하고 남은 일수는 항상 계산해서 쓴다(CH-014). */
export function dDay(deadline: string, today = new Date()): number {
  const end = new Date(`${deadline}T00:00:00`)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

export function formatDDay(deadline: string, today = new Date()): string {
  const d = dDay(deadline, today)
  if (d === 0) return 'D-DAY'
  return d > 0 ? `D-${d}` : `D+${-d}`
}

/** 로컬 기준 'YYYY-MM-DD'. toISOString은 UTC로 밀려 자정 근처에서 하루가 어긋난다. */
export function dayKey(date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/**
 * 감사 타임라인의 시각. 'M월 D일 HH:mm'.
 *
 * 초는 버린다 — 사람이 이력을 읽을 때 쓰는 정보가 아니다. 정밀한 값이 필요하면
 * audit_log의 occurred_at을 직접 본다. 연도는 올해가 아닐 때만 붙인다.
 *
 * 서버와 브라우저가 같은 문자열을 내야 하므로 시간대를 KST로 못 박는다.
 * 안 박으면 서버(UTC)와 브라우저(KST)가 다른 시각을 그려 하이드레이션이 어긋난다.
 */
export function formatDateTime(iso: string, today = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

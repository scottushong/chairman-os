'use client'

import { useRouter } from 'next/navigation'

/**
 * 조회 월. 값은 URL에 있다(HANDOVER ④) — 고른 달의 재무 화면을 링크 한 줄로 넘길 수 있어야 한다.
 * 가장 최근 달은 기본값이라 키를 뺀다(lib/query.ts withParams와 같은 규칙).
 */
export function MonthSelect({
  periods,
  value,
  hrefFor,
}: {
  /** 최신 순 */
  periods: { period: string; label: string }[]
  value: string
  /** 서버가 만든 주소표. 클라이언트가 URL 규칙을 따로 갖지 않는다 */
  hrefFor: Record<string, string>
}) {
  const router = useRouter()
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
      조회 월
      <select
        value={value}
        onChange={(e) => router.push(hrefFor[e.target.value])}
        className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
      >
        {periods.map((p) => (
          <option key={p.period} value={p.period}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  )
}

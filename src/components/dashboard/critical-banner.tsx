import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { businessName } from '@/lib/lookup'
import { linkedDecisionHref } from '@/lib/alert-link'
import type { Alert, Business, Decision } from '@/types'

/**
 * CH-018의 '즉시 상단 노출'.
 *
 * 왜 패널이 따로 있는데 이걸 또 두나
 *   02_기능명세 CH-018의 Acceptance는 'Critical rule 즉시 상단 노출'이다.
 *   AlertPanel은 아래 4열 그리드의 세 번째 칸에 있어서, 회장이 KPI 8타일과 12개월 차트를
 *   지나쳐 스크롤해야 빨강을 본다. 그건 '즉시'도 '상단'도 아니다.
 *
 *   그렇다고 패널을 위로 올리지는 않는다. 그 패널은 경고 건수와 '관련 결정으로 이동'까지
 *   들고 있어서 자리를 많이 먹고, Critical이 없는 날에는 화면 맨 위에 빈 상자가 선다.
 *   대신 Critical이 있을 때만 나타나는 한 줄을 맨 위에 둔다.
 *
 * Critical이 없으면 아무것도 그리지 않는다. 이 자리가 늘 차 있으면 빨강이 흔해지고,
 * 흔해진 빨강은 읽히지 않는다 — AlertPanel이 경고를 목록에 안 올리는 것과 같은 이유다.
 */
export function CriticalBanner({
  alerts,
  decisions,
  businesses,
}: {
  alerts: Alert[]
  decisions: Decision[]
  businesses: Business[]
}) {
  const critical = alerts.filter((a) => a.status !== 'Resolved' && a.severity === 'Critical')
  if (critical.length === 0) return null

  return (
    <section
      aria-label="긴급 알림"
      className="mt-4 space-y-1.5 rounded-xl border border-critical/50 bg-critical/10 p-2.5"
    >
      {critical.map((a) => {
        const href = linkedDecisionHref(a, decisions)
        const body = (
          <>
            <Icon name="bell" className="size-4 shrink-0 text-critical" filled />
            <span className="shrink-0 rounded bg-critical/20 px-1.5 py-0.5 text-[9px] font-bold text-critical">
              긴급
            </span>
            <span className="shrink-0 text-[11px] text-ink-muted">
              {businessName(businesses, a.business_id)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
              {a.message}
            </span>
          </>
        )

        // 갈 곳이 없으면 링크로 만들지 않는다. 눌러도 아무 일 없는 줄은 고장으로 읽힌다.
        return href ? (
          <Link
            key={a.alert_id}
            href={href}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-critical/10"
          >
            {body}
            <span className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-critical">
              결정하러 가기
              <Icon name="chevron-right" className="size-3" />
            </span>
          </Link>
        ) : (
          <div key={a.alert_id} className="flex items-center gap-2 px-1.5 py-1">
            {body}
          </div>
        )
      })}
    </section>
  )
}

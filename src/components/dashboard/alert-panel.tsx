import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { linkedDecisionHref, linkedDecisionTitle } from '@/lib/alert-link'
import { businessName } from '@/lib/lookup'
import { SEVERITY_LABEL_KO, type Alert, type Business, type Decision } from '@/types'

/**
 * CH-018 Red Alert.
 * Acceptance가 'Critical rule 즉시 상단 노출'이라, 패널 본문은 Critical만 받는다.
 * Warning을 같이 흘리면 빨강이 흔해져서 진짜 빨강을 못 읽는다 — 경고는 숫자로만 남긴다.
 *
 * '상단'은 이 패널이 혼자 만족시키지 못한다. 이 자리는 아래 4열 그리드의 세 번째 칸이라
 * KPI 8타일과 12개월 차트 뒤에 온다. 그래서 Critical이 있는 날에는 화면 맨 위에
 * CriticalBanner가 따로 선다 — 이 패널은 경고 건수와 관련 결정까지 펴 주는 자리다.
 */

/** 카테고리 → 아이콘. 목록을 훑을 때 글자보다 모양이 먼저 걸린다. */
const CATEGORY_ICON: Record<string, 'coin' | 'cart' | 'factory' | 'file-text' | 'users' | 'bell'> =
  {
    Cash: 'coin',
    AR: 'coin',
    EBITDA: 'coin',
    Margin: 'coin',
    Sales: 'cart',
    Customer: 'cart',
    Inventory: 'factory',
    Production: 'factory',
    Quality: 'factory',
    Contract: 'file-text',
    Compliance: 'file-text',
    HR: 'users',
  }

interface AlertPanelProps {
  alerts: Alert[]
  /** '관련 결정으로 이동'을 만들려면 열린 결정 목록이 필요하다. */
  decisions: Decision[]
  businesses: Business[]
}

export function AlertPanel({ alerts, decisions, businesses }: AlertPanelProps) {
  const open = alerts.filter((a) => a.status !== 'Resolved')
  const critical = open.filter((a) => a.severity === 'Critical')
  const warningCount = open.filter((a) => a.severity === 'Warning').length

  return (
    <section className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon
            name="bell"
            className={`size-4 ${critical.length > 0 ? 'text-critical' : 'text-ink-dim'}`}
          />
          알림 / 리스크
          <span className="text-[11px] font-normal text-ink-muted tnum">
            {critical.length}건
          </span>
        </h2>
        <span className="text-[9px] text-ink-muted tnum">CH-018</span>
      </div>
      {/* 경고는 패널에 올리지 않고 여기서 숫자로만 알린다. 열어 보는 건 다음 단계다. */}
      <p className="mt-0.5 text-[11px] text-ink-muted tnum">
        {SEVERITY_LABEL_KO.Warning} {warningCount}건은 목록에 올리지 않음
      </p>

      {critical.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[12px] text-ink-muted">
          긴급 알림이 없습니다.
        </p>
      ) : (
        <ul className="-mx-1.5 mt-2 flex-1 space-y-0.5 overflow-y-auto">
          {critical.map((a) => (
            <AlertItem key={a.alert_id} alert={a} decisions={decisions} businesses={businesses} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AlertItem({
  alert,
  decisions,
  businesses,
}: {
  alert: Alert
  decisions: Decision[]
  businesses: Business[]
}) {
  // 같은 회사에 열린 결정이 있으면 그 결정으로 보낸다. 알림만 보고 끝나면 아무 일도 안 일어난다.
  // 판단은 lib/alert-link에 있다 — 상단 배너(CriticalBanner)와 같은 곳으로 보내야 한다.
  const href = linkedDecisionHref(alert, decisions)
  const linkedTitle = linkedDecisionTitle(alert, decisions)

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <Icon name={CATEGORY_ICON[alert.category] ?? 'bell'} className="size-3.5 text-critical" />
        <span className="shrink-0 rounded bg-critical/15 px-1.5 py-0.5 text-[9px] font-semibold text-critical">
          {SEVERITY_LABEL_KO[alert.severity]}
        </span>
        <span className="truncate text-[11px] text-ink-muted">
          {businessName(businesses, alert.business_id)}
        </span>
        <span className="ml-auto shrink-0 text-[9px] text-ink-muted">{alert.source}</span>
      </div>

      <p className="mt-0.5 text-[12px] leading-snug font-semibold">{alert.message}</p>

      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-dim">
        <Icon name="chevron-right" className="size-3" />
        {linkedTitle ? `관련 결정: ${linkedTitle}` : '열린 결정이 없습니다'}
      </p>
    </>
  )

  const shell = 'block rounded-lg border-l-2 border-critical bg-critical/5 px-2 py-1.5'

  // 갈 곳이 없으면 링크로 만들지 않는다. 눌러도 아무 일 없는 줄은 고장으로 읽힌다.
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={`${shell} transition-colors hover:bg-critical/10`}
          aria-label={`${alert.message} — 관련 결정으로 이동`}
        >
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  )
}

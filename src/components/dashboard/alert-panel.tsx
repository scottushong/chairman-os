import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { alerts, businessName, decisions } from '@/data'
import { SEVERITY_LABEL_KO, type Alert } from '@/types'

/**
 * CH-018 Red Alert.
 * Acceptance가 'Critical rule 즉시 상단 노출'이라, 패널 본문은 Critical만 받는다.
 * Warning을 같이 흘리면 빨강이 흔해져서 진짜 빨강을 못 읽는다 — 경고는 숫자로만 남긴다.
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

export function AlertPanel() {
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
            <AlertItem key={a.alert_id} alert={a} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AlertItem({ alert }: { alert: Alert }) {
  // 같은 회사에 열린 결정이 있으면 그 결정으로 보낸다. 알림만 보고 끝나면 아무 일도 안 일어난다.
  const linked = decisions.find((d) => d.business_id === alert.business_id && d.status === 'Open')

  return (
    <li>
      {/* TODO(CH-018): 결정 상세 라우트가 생기면 href를 /decisions/{id}로 바꾼다. */}
      <Link
        href="#"
        className="block rounded-lg border-l-2 border-critical bg-critical/5 px-2 py-1.5 transition-colors hover:bg-critical/10"
        aria-label={`${alert.message} — 관련 결정으로 이동`}
      >
        <div className="flex items-center gap-1.5">
          <Icon name={CATEGORY_ICON[alert.category] ?? 'bell'} className="size-3.5 text-critical" />
          <span className="shrink-0 rounded bg-critical/15 px-1.5 py-0.5 text-[9px] font-semibold text-critical">
            {SEVERITY_LABEL_KO[alert.severity]}
          </span>
          <span className="truncate text-[11px] text-ink-muted">
            {businessName(alert.business_id)}
          </span>
          <span className="ml-auto shrink-0 text-[9px] text-ink-muted">{alert.source}</span>
        </div>

        <p className="mt-0.5 text-[12px] leading-snug font-semibold">{alert.message}</p>

        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-dim">
          <Icon name="chevron-right" className="size-3" />
          {linked ? `관련 결정: ${linked.title}` : '관련 결정으로 이동'}
        </p>
      </Link>
    </li>
  )
}

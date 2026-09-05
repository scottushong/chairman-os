import { Icon } from '@/components/ui/icon'
import { valueOf, businessProgress } from '@/lib/finance'
import { formatEok, formatPct } from '@/lib/format'
import { STATUS_LABEL_KO, type Business } from '@/types'

/**
 * CH-001 Business Card.
 * 매출(월) / EBITDA / 진행률 세 숫자만 올린다. 나머지는 상세로 내린다 —
 * 첫 화면에서 모든 회사를 보되 모든 상세를 볼 필요는 없다는 UX 원칙(요구사항서 2번).
 */

/** 회사 식별색. 배지·진행바·상세 링크가 같은 색을 공유해야 카드가 한 덩어리로 읽힌다. */
const TONE: Record<string, { badge: string; bar: string; track: string }> = {
  biz_dy: { badge: 'bg-biz-dy/20 text-biz-dy', bar: 'bg-biz-dy', track: 'bg-biz-dy/15' },
  biz_vana: { badge: 'bg-biz-vana/20 text-biz-vana', bar: 'bg-biz-vana', track: 'bg-biz-vana/15' },
  biz_sticky: {
    badge: 'bg-biz-sticky/20 text-biz-sticky',
    bar: 'bg-biz-sticky',
    track: 'bg-biz-sticky/15',
  },
  biz_hof: { badge: 'bg-biz-hof/20 text-biz-hof', bar: 'bg-biz-hof', track: 'bg-biz-hof/15' },
  biz_boram: {
    badge: 'bg-biz-boram/20 text-biz-boram',
    bar: 'bg-biz-boram',
    track: 'bg-biz-boram/15',
  },
}

const FALLBACK_TONE = { badge: 'bg-raised text-ink-dim', bar: 'bg-accent', track: 'bg-accent/15' }

interface BusinessCardProps {
  business: Business
  /** 카드 좌상단 이니셜. 표시 순서대로 A, B, C…를 붙인다. */
  letter: string
  onToggleVisible: (businessId: string) => void
}

export function BusinessCard({ business, letter, onToggleVisible }: BusinessCardProps) {
  const tone = TONE[business.business_id] ?? FALLBACK_TONE
  const revenue = valueOf(business.business_id, 'Revenue')
  const ebitda = valueOf(business.business_id, 'EBITDA')
  const progress = businessProgress(business.business_id)

  return (
    <article className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-start gap-2.5">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold ${tone.badge}`}
        >
          {letter}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] leading-tight font-semibold">{business.name}</h3>
          {/* 상태는 업종 옆에 붙인다. 줄을 하나 더 만들면 카드 다섯 장의 키가 어긋난다. */}
          <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="truncate">{business.industry}</span>
            {business.status !== 'Active' ? (
              <span className="shrink-0 rounded bg-raised px-1 py-px text-[9px] text-ink-dim">
                {STATUS_LABEL_KO[business.status]}
              </span>
            ) : null}
          </p>
        </div>

        {/* CH-003. 데이터 삭제가 아니라 표시 여부만 바꾼다는 걸 말로 붙여 둔다. */}
        <button
          type="button"
          onClick={() => onToggleVisible(business.business_id)}
          title="대시보드에서 숨김 (데이터는 삭제되지 않습니다)"
          aria-label={`${business.name} 숨기기`}
          className="rounded-md p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Icon name="eye" className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`${business.name} 메뉴`}
          className="rounded-md p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Icon name="more" className="size-4" />
        </button>
      </div>

      <dl className="mt-3.5 grid grid-cols-3 gap-2">
        <Metric label="매출 (월)" value={formatEok(revenue)} />
        {/* 적자는 빨강. 카드 다섯 장을 훑을 때 부호를 놓치면 안 된다. */}
        <Metric label="EBITDA" value={formatEok(ebitda)} negative={ebitda < 0} />
        <Metric label="진행률" value={formatPct(progress)} />
      </dl>

      <div className={`mt-3 h-1.5 w-full overflow-hidden rounded-full ${tone.track}`}>
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      <button
        type="button"
        className="mt-3.5 w-full rounded-lg border border-line py-1.5 text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
      >
        상세 보기
      </button>
    </article>
  )
}

function Metric({
  label,
  value,
  negative = false,
}: {
  label: string
  value: string
  negative?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-ink-muted">{label}</dt>
      <dd
        className={`mt-0.5 text-[15px] font-semibold ${negative ? 'text-critical' : 'text-ink'}`}
      >
        {value}
      </dd>
    </div>
  )
}

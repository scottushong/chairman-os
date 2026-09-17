import Link from 'next/link'

import { BasisTag } from '@/components/finance/figure'
import { Icon } from '@/components/ui/icon'
import { formatEok, formatPct } from '@/lib/format'
import { STATUS_LABEL_KO, type Business, type FigureBasis } from '@/types'

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

/**
 * 카드에 올릴 숫자. 카드가 원천 배열을 통째로 받지 않는 이유는,
 * 회사 수만큼 같은 배열을 다시 훑게 되기 때문이다. 집계는 부모가 한 번만 한다.
 */
export interface BusinessMetrics {
  revenue: number
  ebitda: number
  /** DEFERRED D-04 결정 C. 목표 대비가 아니라 프로젝트 진행률 평균이다. */
  progress: number
  /** 재무 원천이 아예 없는 회사인가. 0억으로 쓰면 적자 0원처럼 읽힌다. */
  hasFinance: boolean
  /** 매출·EBITDA의 출처 꼬리표(Phase 2-A). 원천이 없으면 null */
  revenueBasis: FigureBasis | null
  ebitdaBasis: FigureBasis | null
}

interface BusinessCardProps {
  business: Business
  metrics: BusinessMetrics
  /** 카드 좌상단 이니셜. 회사마다 고정이다 — 핀/숨김으로 순서가 바뀌어도 따라 움직이지 않는다. */
  letter: string
  /** CH-004. 시드 pinned가 아니라 사용자 설정 기준의 현재 상태. */
  pinned: boolean
  onToggleVisible: (businessId: string) => void
  onTogglePinned: (businessId: string) => void
}

export function BusinessCard({
  business,
  metrics,
  letter,
  pinned,
  onToggleVisible,
  onTogglePinned,
}: BusinessCardProps) {
  const tone = TONE[business.business_id] ?? FALLBACK_TONE
  const { revenue, ebitda, progress, hasFinance, revenueBasis, ebitdaBasis } = metrics

  return (
    // @container — 카드 폭은 줄에 올라간 회사 수가 정한다. 숫자 크기를 뷰포트가 아니라 카드 폭에 맞춘다.
    <article className="@container flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3">
      {/* 이니셜과 버튼 셋을 한 줄에, 회사명은 그 아래 줄에 따로 둔다.
          한 줄에 같이 두면 다섯 장이 한 줄에 설 때 명조 회사명이 두세 글자만 남는다. */}
      <div className="flex items-center gap-0.5">
        <span
          className={`mr-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold ${tone.badge}`}
        >
          {letter}
        </span>

        {/* CH-004. 핀은 정렬만 바꾼다 — 그룹 KPI 합계에는 영향이 없다. */}
        <button
          type="button"
          onClick={() => onTogglePinned(business.business_id)}
          title={pinned ? '상단 고정 해제' : '상단에 고정'}
          aria-label={`${business.name} ${pinned ? '고정 해제' : '고정'}`}
          aria-pressed={pinned}
          className={`rounded-md p-1 transition-colors hover:bg-raised ${
            pinned ? 'text-gold' : 'text-ink-muted hover:text-ink'
          }`}
        >
          <Icon name="pin" className="size-3.5" filled={pinned} />
        </button>

        {/* CH-003. 데이터 삭제가 아니라 표시 여부만 바꾼다는 걸 말로 붙여 둔다. */}
        <button
          type="button"
          onClick={() => onToggleVisible(business.business_id)}
          title="대시보드에서 숨김 (데이터는 삭제되지 않습니다)"
          aria-label={`${business.name} 숨기기`}
          className="rounded-md p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Icon name="eye" className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`${business.name} 메뉴`}
          className="rounded-md p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Icon name="more" className="size-3.5" />
        </button>
      </div>

      {/* 회사명은 자르지 않고 두 줄까지 접는다. 두 줄 높이를 늘 잡아 둬야 다섯 장의 숫자 줄이 맞는다. */}
      <h3
        title={business.name}
        className="mt-2 line-clamp-2 min-h-[2.5em] text-[13px] leading-[1.25] font-semibold break-keep"
      >
        {business.name}
      </h3>
      {/* 상태는 업종 옆에 붙인다. 줄을 하나 더 만들면 카드 다섯 장의 키가 어긋난다. */}
      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
        <span className="truncate">{business.industry}</span>
        {business.status !== 'Active' ? (
          <span className="shrink-0 rounded bg-raised px-1 py-px text-[9px] text-ink-dim">
            {STATUS_LABEL_KO[business.status]}
          </span>
        ) : null}
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-1.5">
        <Metric label="매출 (월)" value={hasFinance ? formatEok(revenue) : '—'} basis={revenueBasis} />
        {/* 적자는 빨강. 카드 다섯 장을 훑을 때 부호를 놓치면 안 된다. */}
        <Metric
          label="EBITDA"
          value={hasFinance ? formatEok(ebitda) : '—'}
          negative={hasFinance && ebitda < 0}
          basis={ebitdaBasis}
        />
        {/* DEFERRED D-04 결정 C. 목표 대비가 아니라 프로젝트 진행률 평균이라 이름을 그대로 쓴다. */}
        <Metric label="프로젝트 진행률" value={formatPct(progress)} />
      </dl>

      <div className={`mt-3 h-1.5 w-full overflow-hidden rounded-full ${tone.track}`}>
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      {/* CH-023~024. 카드가 숫자 셋만 올리는 건 나머지를 이 화면으로 내렸기 때문이다. */}
      <Link
        href={`/business/${encodeURIComponent(business.business_id)}`}
        className="mt-3 block w-full rounded-lg border border-line py-1.5 text-center text-[12px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
      >
        상세 보기
      </Link>
    </article>
  )
}

function Metric({
  label,
  value,
  negative = false,
  basis = null,
}: {
  label: string
  value: string
  negative?: boolean
  basis?: FigureBasis | null
}) {
  return (
    <div className="min-w-0">
      {/* 두 줄까지 접힐 수 있어 높이를 고정한다. 아니면 세 칸의 숫자 밑줄이 서로 어긋난다. */}
      <dt className="min-h-[24px] text-[10px] leading-tight text-ink-muted">{label}</dt>
      <dd
        className={`mt-0.5 text-[13px] font-semibold whitespace-nowrap @[200px]:text-[15px] ${
          negative ? 'text-critical' : 'text-ink'
        }`}
      >
        {value}
        {basis ? (
          <span className="ml-1 align-middle">
            <BasisTag basis={basis} compact />
          </span>
        ) : null}
      </dd>
    </div>
  )
}

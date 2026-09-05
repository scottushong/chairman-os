import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { businessName } from '@/lib/lookup'
import type { AiNightOutput, Business } from '@/types'

/**
 * CH-019 AI Did Last Night.
 * 야간 Agent가 실제로 만들어 낸 결과물 목록이다. 요약만 늘어놓으면 실패라는 게
 * 요구사항서 11번의 못이라, 각 줄은 반드시 결과물로 들어가는 링크를 갖는다.
 */

/** 0.7 미만은 사람이 한 번 더 봐야 하는 결과다. 같은 크기로 나란히 두지 않는다. */
const CONFIDENCE_FLOOR = 0.7

interface AiNightPanelProps {
  outputs: AiNightOutput[]
  businesses: Business[]
}

export function AiNightPanel({ outputs, businesses }: AiNightPanelProps) {
  // 최근 완료 순. 아침에 열면 마지막에 끝난 일이 맨 위에 있어야 한다.
  const items = [...outputs].sort((a, b) => b.completed_at.localeCompare(a.completed_at))
  const lastRun = items[0]?.completed_at

  return (
    <section className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="sparkles" className="size-4 text-gold" />
          AI Did Last Night
          <span className="text-[11px] font-normal text-ink-muted tnum">{items.length}건</span>
        </h2>
        <span className="text-[9px] text-ink-muted tnum">CH-019</span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-muted tnum">
        마지막 실행 {lastRun ? formatRunTime(lastRun) : '—'}
      </p>

      <ul className="-mx-1.5 mt-2 flex-1 space-y-0.5 overflow-y-auto">
        {items.map((item) => (
          <NightItem
            key={`${item.completed_at}-${item.business_id}`}
            item={item}
            businesses={businesses}
          />
        ))}
      </ul>
    </section>
  )
}

function NightItem({ item, businesses }: { item: AiNightOutput; businesses: Business[] }) {
  const pct = Math.round(item.confidence * 100)
  const low = item.confidence < CONFIDENCE_FLOOR

  return (
    <li>
      {/* TODO(CH-019): 결과물 상세 라우트가 생기면 artifact_link를 여기에 연결한다. */}
      <Link
        href="#"
        className="block rounded-lg px-1.5 py-1.5 transition-colors hover:bg-raised"
        aria-label={`${item.job_type} 결과 열기: ${item.result_summary}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[9px] font-semibold text-ink-dim">
            {item.job_type}
          </span>
          <span className="truncate text-[11px] text-ink-muted">
            {businessName(businesses, item.business_id)}
          </span>
          {item.status !== 'Done' ? (
            <span
              className={`shrink-0 text-[9px] ${item.status === 'Failed' ? 'text-critical' : 'text-warning'}`}
            >
              {item.status === 'Failed' ? '실패' : '진행 중'}
            </span>
          ) : null}
          <span
            title="AI 신뢰도"
            className={`ml-auto shrink-0 text-[11px] font-semibold tnum ${
              low ? 'text-ink-muted' : 'text-ink'
            }`}
          >
            {pct}%
          </span>
        </div>

        <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-dim">
          {item.result_summary}
        </p>

        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-muted tnum">
          {formatRunTime(item.completed_at)}
          <Icon name="file-text" className="size-3" />
          결과물 열기
        </p>
      </Link>
    </li>
  )
}

/** '2026-09-01T06:40' → '09-01 06:40'. 야간 작업은 날짜보다 시각이 먼저 읽힌다. */
function formatRunTime(iso: string): string {
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
}

import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import {
  CONFIDENCE_FLOOR,
  formatRunTime,
  latestNightOutputs,
  linkKind,
  outputName,
} from '@/lib/night-brief-view'
import type { AiNightOutput, Business } from '@/types'

/**
 * CH-019 AI Did Last Night.
 * 야간 Agent가 실제로 만들어 낸 결과물 목록이다. 요약만 늘어놓으면 실패라는 게
 * 요구사항서 11번의 못이라, 각 줄은 반드시 결과물로 들어가는 링크를 갖는다.
 *
 * Phase 3-A부터 결과물은 야간 브리핑(lib/ai/night-brief.ts)이고, 링크는 /ai 화면의 그 날짜·그 회사다.
 * 여기에는 가장 최근 실행 한 번만 올린다 — 밤마다 쌓이는 행을 다 올리면 '어젯밤'이 아니게 된다.
 */

interface AiNightPanelProps {
  outputs: AiNightOutput[]
  businesses: Business[]
}

export function AiNightPanel({ outputs, businesses }: AiNightPanelProps) {
  const items = latestNightOutputs(outputs, businesses)
  const lastRun = items.reduce<string | undefined>(
    (latest, o) => (!latest || o.completed_at > latest ? o.completed_at : latest),
    undefined,
  )

  return (
    <section className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="sparkles" className="size-4 text-gold" />
          AI Did Last Night
          <span className="text-[11px] font-normal text-ink-muted tnum">{items.length}건</span>
        </h2>
        <Link href="/ai" className="text-[10px] text-ink-muted transition-colors hover:text-ink">
          전문 보기
        </Link>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-muted tnum">
        마지막 실행 {lastRun ? formatRunTime(lastRun) : '—'}
      </p>

      <ul className="-mx-1.5 mt-2 flex-1 space-y-0.5 overflow-y-auto">
        {items.map((item) => (
          <NightItem
            key={item.output_id ?? `${item.completed_at}-${item.business_id}`}
            item={item}
            businesses={businesses}
          />
        ))}
      </ul>
    </section>
  )
}

function NightItem({ item, businesses }: { item: AiNightOutput; businesses: Business[] }) {
  const failed = item.status === 'Failed'
  const pct = Math.round(item.confidence * 100)
  const low = item.confidence < CONFIDENCE_FLOOR
  const isGroup = item.business_id === null

  /**
   * CH-019 Acceptance의 '결과 링크 제공'.
   *
   * artifact_link가 늘 열 수 있는 주소인 것은 아니다. 시드의 값은 artifact://dummy/001 처럼
   * 아직 실체가 없는 자리 표시라, 그걸 링크로 그리면 눌러도 아무 일이 없다.
   * 앱 안 경로와 http/https일 때만 링크로 만들고 아니면 경로를 글자로 보여 준다 —
   * '링크가 있는 척'과 '아직 없다'를 화면에서 구분할 수 있어야 한다.
   *
   * javascript: 같은 스킴을 걸러 내는 일도 겸한다. 야간 Job이 채우는 칸이라
   * 사람이 검토하지 않은 값이 그대로 회장 화면의 링크가 되는 자리다.
   */
  const kind = linkKind(item.artifact_link)

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
            isGroup ? 'bg-accent-soft text-gold' : 'bg-raised text-ink-dim'
          }`}
        >
          {item.job_type}
        </span>
        <span className="truncate text-[11px] text-ink-muted">
          {outputName(businesses, item.business_id)}
        </span>
        {item.status !== 'Done' ? (
          <span className={`shrink-0 text-[9px] ${failed ? 'text-critical' : 'text-warning'}`}>
            {failed ? '실패' : '진행 중'}
          </span>
        ) : null}
        {/* 실패한 줄에는 신뢰도가 없다. 0%로 쓰면 '틀린 요약'으로 읽힌다. */}
        {failed ? null : (
          <span
            title="AI 신뢰도"
            className={`ml-auto shrink-0 text-[11px] font-semibold tnum ${
              low ? 'text-ink-muted' : 'text-ink'
            }`}
          >
            {pct}%
          </span>
        )}
      </div>

      <p
        className={`mt-0.5 line-clamp-2 text-[12px] leading-snug ${
          failed ? 'text-ink-muted' : 'text-ink-dim'
        }`}
      >
        {item.result_summary}
      </p>

      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-muted tnum">
        {formatRunTime(item.completed_at)}
        <Icon name="file-text" className="size-3" />
        {kind !== 'none' ? '결과물 열기' : `결과물 경로 ${item.artifact_link || '없음'}`}
      </p>
    </>
  )

  const shell = 'block rounded-lg px-1.5 py-1.5'
  const label = `${item.job_type} 결과 열기: ${item.result_summary}`

  return (
    <li>
      {kind === 'internal' ? (
        <Link
          href={item.artifact_link}
          className={`${shell} transition-colors hover:bg-raised`}
          aria-label={label}
        >
          {body}
        </Link>
      ) : kind === 'external' ? (
        <a
          href={item.artifact_link}
          target="_blank"
          rel="noreferrer noopener"
          className={`${shell} transition-colors hover:bg-raised`}
          aria-label={label}
        >
          {body}
        </a>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  )
}

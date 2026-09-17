import Link from 'next/link'

import { RunNightBrief } from '@/components/ai/run-night-brief'
import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { currentUser } from '@/lib/auth/session'
import {
  CONFIDENCE_FLOOR,
  formatRunTime,
  groupRuns,
  outputName,
  type NightRun,
} from '@/lib/night-brief-view'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import type { AiBriefItem, AiNightOutput, Business } from '@/types'

/**
 * /ai — 야간 브리핑 전문 (Phase 3-A 블록 4, CH-019의 전체 화면).
 *
 * 대시보드 패널은 '어젯밤' 한 번만 두 줄씩 보여 준다. 이 화면은 날짜를 골라 그날의 그룹 브리핑 전문과
 * 회사별 요약을 펼쳐 본다. 패널의 '결과물 열기'가 /ai?date=…#회사 로 여기에 떨어진다.
 *
 * 날짜는 URL에 둔다(HANDOVER ④) — "9월 17일 브리핑 봐 달라"가 링크 한 줄이 된다.
 * 같은 날 여러 번 돌렸으면(수동 실행) 최신 실행이 위에 오고, 앵커(#biz_dy)는 최신 실행에만 붙는다.
 */
export default async function AiPage(props: PageProps<'/ai'>) {
  const params = await props.searchParams
  const repo = await getRepository()
  const [outputs, businesses, user] = await Promise.all([
    repo.listAiNightOutputs(),
    repo.listBusinesses(),
    currentUser(),
  ])

  const runs = groupRuns(outputs, businesses)
  const dates = [...new Set(runs.map((r) => r.date))].sort().reverse()
  const requested = firstParam(params.date)
  const date = requested && dates.includes(requested) ? requested : dates[0]
  const shown = runs.filter((r) => r.date === date)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="sparkles"
        title="AI 인사이트"
        code="CH-019 · CH-045~048"
        description="야간 AI Agent가 매일 23:00(KST)에 계열사 상태를 읽고 쓴 브리핑입니다. Agent는 제한 등급까지만 읽습니다."
      >
        {user?.role === 'Chairman' ? <RunNightBrief /> : null}
      </PageHeader>

      {dates.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line-soft bg-panel p-6 text-[12.5px] text-ink-muted">
          아직 브리핑이 없습니다. 첫 Cron은 오늘 23:00(KST)에 돕니다.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-12 gap-3.5 pb-6">
          <nav aria-label="브리핑 날짜" className="col-span-12 lg:col-span-2">
            <ul className="flex gap-1 overflow-x-auto lg:flex-col">
              {dates.map((d) => (
                <li key={d}>
                  <Link
                    href={`/ai?date=${d}`}
                    aria-current={d === date ? 'page' : undefined}
                    className={`block rounded-lg px-3 py-2 text-[12.5px] whitespace-nowrap tnum transition-colors ${
                      d === date
                        ? 'bg-panel font-semibold text-ink'
                        : 'text-ink-muted hover:bg-panel/60 hover:text-ink-dim'
                    }`}
                  >
                    {d}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="col-span-12 space-y-6 lg:col-span-10">
            {shown.map((run, i) => (
              <RunSection
                key={run.run_id ?? `legacy-${run.date}`}
                run={run}
                businesses={businesses}
                anchors={i === 0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RunSection({
  run,
  businesses,
  anchors,
}: {
  run: NightRun
  businesses: Business[]
  anchors: boolean
}) {
  const rows = [...(run.group ? [run.group] : []), ...run.companies]
  const failed = rows.filter((r) => r.status === 'Failed').length

  return (
    <section className="space-y-2.5">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted tnum">
        <span className="flex items-center gap-1">
          <Icon name="clock" className="size-3.5" />
          {formatRunTime(run.finished_at)} 완료
        </span>
        <span>
          {rows.length}건 · 실패 <span className={failed ? 'text-critical' : ''}>{failed}</span>
        </span>
        {run.model ? <span>{run.model}</span> : null}
        <span>{run.run_id ? `run ${run.run_id}` : '이전 형식(시드)'}</span>
      </p>

      {run.group ? (
        <article
          id={anchors ? 'group' : undefined}
          className="scroll-mt-4 rounded-xl border border-accent/30 bg-panel p-5"
        >
          <OutputHead output={run.group} name="그룹 브리핑" />
          <p
            className={`mt-3 text-[14px] leading-relaxed whitespace-pre-line ${
              run.group.status === 'Failed' ? 'text-ink-muted' : 'text-ink'
            }`}
          >
            {run.group.result_summary}
          </p>
          <Items items={run.group.items} />
        </article>
      ) : null}

      <div className="space-y-2">
        {run.companies.map((o) => (
          <details
            key={o.output_id ?? `${o.business_id}-${o.completed_at}`}
            id={anchors && o.business_id ? o.business_id : undefined}
            className="group scroll-mt-4 rounded-xl border border-line-soft bg-panel open:border-line"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <Icon
                name="chevron-right"
                className="size-3.5 shrink-0 text-ink-muted transition-transform group-open:rotate-90"
              />
              <div className="min-w-0 flex-1">
                <OutputHead output={o} name={outputName(businesses, o.business_id)} compact />
                <p className="mt-1 line-clamp-1 text-[12px] text-ink-dim group-open:hidden">
                  {o.result_summary}
                </p>
              </div>
            </summary>
            <div className="border-t border-line-soft px-4 pt-3 pb-4 pl-10">
              <p
                className={`text-[13px] leading-relaxed whitespace-pre-line ${
                  o.status === 'Failed' ? 'text-ink-muted' : 'text-ink'
                }`}
              >
                {o.result_summary}
              </p>
              <Items items={o.items} />
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function OutputHead({
  output,
  name,
  compact = false,
}: {
  output: AiNightOutput
  name: string
  compact?: boolean
}) {
  const failed = output.status === 'Failed'
  const low = output.confidence < CONFIDENCE_FLOOR
  return (
    <div className="flex items-center gap-2">
      <span className={`font-semibold ${compact ? 'text-[13px]' : 'text-[15px]'}`}>{name}</span>
      <span className="rounded bg-raised px-1.5 py-0.5 text-[9px] font-semibold text-ink-dim">
        {output.job_type}
      </span>
      {failed ? <span className="text-[10px] text-critical">실패</span> : null}
      {/* 실패한 줄에는 신뢰도가 없다. 0%로 쓰면 '틀린 요약'으로 읽힌다. */}
      {failed ? null : (
        <span
          title="AI 신뢰도"
          className={`ml-auto text-[12px] font-semibold tnum ${low ? 'text-ink-muted' : 'text-ink'}`}
        >
          신뢰도 {Math.round(output.confidence * 100)}%
        </span>
      )}
    </div>
  )
}

const SEVERITY_TONE: Record<AiBriefItem['severity'], { dot: string; label: string }> = {
  critical: { dot: 'bg-critical', label: '긴급' },
  warning: { dot: 'bg-warning', label: '주의' },
  info: { dot: 'bg-ink-muted', label: '참고' },
}

function Items({ items }: { items?: AiBriefItem[] }) {
  if (!items?.length) return null
  return (
    <ul className="mt-3 space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            title={SEVERITY_TONE[it.severity].label}
            className={`mt-[7px] size-1.5 shrink-0 rounded-full ${SEVERITY_TONE[it.severity].dot}`}
          />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-ink">{it.title}</p>
            <p className="text-[12px] leading-relaxed text-ink-dim">{it.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

import Link from 'next/link'

import { RunNightBrief } from '@/components/ai/run-night-brief'
import { Manifesto } from '@/components/chairman/manifesto'
import { ProjectCounters } from '@/components/chairman/project-counters'
import { TodayAndWeek } from '@/components/chairman/today-and-week'
import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { currentUser } from '@/lib/auth/session'
import { occursOn, shift } from '@/lib/calendar'
import { kstToday, orderProjects } from '@/lib/chairman-project'
import { initiativeClock, isStale } from '@/lib/initiative'
import {
  CONFIDENCE_FLOOR,
  formatRunTime,
  groupRuns,
  outputName,
  type NightRun,
} from '@/lib/night-brief-view'
import { firstParam } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import type { AiBriefItem, AiNightOutput, Business, ProjectNote } from '@/types'

/**
 * /ai — 회장의 아침 루틴 (Phase 3-B, 다듬기 3번에서 2단으로).
 *
 * 좌우 2단이다. 왼쪽은 **바뀌지 않는 것**(장기 프로젝트 D-day, 선언문)이고
 * 오른쪽은 **오늘 바뀐 것**(오늘·이번 주, 야간 브리핑)이다. 왼쪽은 스크롤해도 따라온다 —
 * 오른쪽의 브리핑을 읽는 내내 D-day와 선언문이 눈에 남아 있어야 우선순위가 그 기준으로 매겨진다.
 *
 * 1024px 이하에서는 한 줄로 쌓인다(min-[1025px]). 그때의 순서는 예전과 같다:
 * 카운터 → 선언문 → 오늘·이번 주 → 브리핑.
 *
 * 왼쪽(a·b)은 0014 RLS가 Chairman(과 AIAgent)에게만 내준다. 다른 역할에게는 빈 값이라
 * 오른쪽(오늘·이번 주 + 브리핑)만 보인다.
 *
 * 야간 브리핑 전문 (Phase 3-A 블록 4, CH-019의 전체 화면).
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
  const today = kstToday()
  const weekLater = shift(today, 7)
  const [outputs, businesses, user, chairmanProjects, manifesto, initiatives, calendarItems] =
    await Promise.all([
      repo.listAiNightOutputs(),
      repo.listBusinesses(),
      currentUser(),
      repo.listChairmanProjects(),
      repo.getChairmanManifesto(),
      repo.listInitiatives(),
      repo.listCalendarItems(today, weekLater),
    ])
  // 카운터는 진행 중인 것만. 끝났거나 접은 프로젝트는 아침에 셀 날이 아니다.
  const activeProjects = orderProjects(chairmanProjects).filter((p) => p.status === 'Active')
  const isChairman = user?.role === 'Chairman'

  // Task 9. "오늘·이번 주" — occursOn으로 오늘에 걸치는 항목만(여러 날 이벤트는 구간 포함이면 오늘로 친다).
  const todayItems = calendarItems.filter((it) => occursOn(it, today))
  // 7일 내(지난 것 포함) 다음 행동이 있는 Active 건. 정렬은 컴포넌트가 next_action_date로 한다.
  const upcomingInitiatives = initiatives.filter((i) => {
    if (i.status !== 'Active') return false
    const clock = initiativeClock(i, today)
    return clock !== null && clock.days <= 7
  })
  // 14일 이상 손 안 댄 Active 건.
  const staleInitiatives = initiatives.filter((i) => isStale(i, today))

  const runs = groupRuns(outputs, businesses)
  const dates = [...new Set(runs.map((r) => r.date))].sort().reverse()
  const requested = firstParam(params.date)
  const date = requested && dates.includes(requested) ? requested : dates[0]
  const shown = runs.filter((r) => r.date === date)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="sparkles"
        title="아침 루틴"
        code="Phase 3-B · CH-019 · CH-045~048"
        description="장기 프로젝트, 선언문, 그리고 야간 AI Agent가 매일 23:00(KST)에 쓴 브리핑입니다."
      >
        {isChairman ? (
          <Link
            href="/settings/chairman"
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            루틴 편집
          </Link>
        ) : null}
        {isChairman ? <RunNightBrief /> : null}
      </PageHeader>

      <div className="mt-4 grid gap-6 min-[1025px]:grid-cols-[minmax(0,380px)_minmax(0,1fr)] min-[1025px]:gap-8">
        {/* 왼쪽 — 바뀌지 않는 것. 스크롤해도 따라온다.
            max-h와 overflow를 같이 준다: 선언문 전문이 뷰포트보다 길면 sticky만으로는
            칸이 통째로 스크롤을 타 고정이 풀린다.
            실제 스크롤 컨테이너는 창(100vh)이 아니라 대시보드 셸의 <main>이다 — Header(h-14=3.5rem)와
            SystemBar(h-12=3rem)를 뺀 나머지만 <main>의 높이다. 3.5+3+2(여유)=8.5rem. Header나
            SystemBar의 높이 클래스가 바뀌면 이 8.5rem도 같이 바꿔야 한다 — 안 바꾸면 sticky 칸이
            <main>보다 커져서 스크롤 끝에서 고정이 풀리고 위로 밀려 올라간다. */}
        <div className="min-[1025px]:sticky min-[1025px]:top-4 min-[1025px]:max-h-[calc(100vh-8.5rem)] min-[1025px]:self-start min-[1025px]:overflow-y-auto min-[1025px]:pr-2">
          {activeProjects.length > 0 ? <ProjectCounters projects={activeProjects} today={today} /> : null}

          {manifesto.body ? (
            <div className={activeProjects.length > 0 ? 'mt-6' : ''}>
              <Manifesto body={manifesto.body} />
            </div>
          ) : null}

          {isChairman && activeProjects.length === 0 && !manifesto.body ? (
            <p className="rounded-xl border border-dashed border-line bg-panel p-4 text-[12px] text-ink-muted">
              아직 장기 프로젝트와 선언문이 없습니다.{' '}
              <Link href="/settings/chairman" className="text-accent underline-offset-2 hover:underline">
                회장 루틴 설정
              </Link>
              에서 넣으면 이 칸 맨 위에 올라옵니다.
            </p>
          ) : null}
        </div>

        {/* 오른쪽 — 오늘 바뀐 것 */}
        <div className="min-w-0">
          <TodayAndWeek
            todayItems={todayItems}
            upcoming={upcomingInitiatives}
            stale={staleInitiatives}
            today={today}
          />

          <h2 className="mt-8 flex items-center gap-1.5 text-[13px] font-semibold">
            <Icon name="sparkles" className="size-4 text-ink-dim" />
            AI 브리핑
          </h2>

          {dates.length === 0 ? (
            <p className="mt-6 rounded-xl border border-line-soft bg-panel p-6 text-[12.5px] text-ink-muted">
              아직 브리핑이 없습니다. 첫 Cron은 오늘 23:00(KST)에 돕니다.
            </p>
          ) : (
            <div className="mt-2.5 pb-6">
              {/* 2단 안에서는 날짜 목록을 세로로 세울 폭이 없다. 가로 한 줄로 둔다. */}
              <nav aria-label="브리핑 날짜" className="mb-3">
                <ul className="flex gap-1 overflow-x-auto">
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

              <div className="space-y-6">
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
      </div>
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
          <ProjectNotes notes={run.group.project_notes} />
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

/** 그룹 브리핑 끝의 '장기 프로젝트별 이번 주 행동'(daily-brief.md). 0014 이전 실행에는 없다. */
function ProjectNotes({ notes }: { notes?: ProjectNote[] }) {
  if (!notes?.length) return null
  return (
    <div className="mt-4 border-t border-line-soft pt-3">
      <p className="text-[11px] font-semibold text-ink-dim">장기 프로젝트 · 이번 주 행동</p>
      <ul className="mt-1.5 space-y-1">
        {notes.map((n, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed">
            <span className="font-semibold text-ink">{n.project_title}</span>
            <span className="text-ink-muted"> — </span>
            <span className="text-ink-dim">{n.action}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

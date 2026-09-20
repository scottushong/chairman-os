import Link from 'next/link'

import { RunNightBrief } from '@/components/ai/run-night-brief'
import { Manifesto } from '@/components/chairman/manifesto'
import { ProjectCounters } from '@/components/chairman/project-counters'
import { TodayAndWeek } from '@/components/chairman/today-and-week'
import { CheckinPanel } from '@/components/morning/checkin-panel'
import { FxStrip } from '@/components/morning/fx-strip'
import { GreetingClock } from '@/components/morning/greeting-clock'
import { WeatherPanel } from '@/components/morning/weather-panel'
import { GlassCard } from '@/components/ui/glass-card'
import { Icon } from '@/components/ui/icon'
import { currentUser } from '@/lib/auth/session'
import { occursOn, shift } from '@/lib/calendar'
import { kstToday, orderProjects } from '@/lib/chairman-project'
import { getFxStrip } from '@/lib/fx'
import { resolveLocation } from '@/lib/geo'
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
import { getBusinessCitiesWeather, getCurrentLocationWeather } from '@/lib/weather'
import type { AiBriefItem, AiNightOutput, Business, ProjectNote } from '@/types'

/**
 * /ai — 회장의 아침 루틴. P5-5c에서 (morning) 다크 셸로 옮겼다(URL은 /ai 그대로다).
 *
 * 화면은 두 층이다.
 *   위 3칸  지금 이 순간 — 인사와 시각, 날씨(지금 있는 곳 + 관심 도시 6곳), 오늘 체크인.
 *   아래 2단 좌는 **바뀌지 않는 것**(장기 프로젝트 D-day, 선언문 전문),
 *            우는 **오늘 바뀐 것**(오늘·이번 주, 야간 브리핑).
 *
 * 왼쪽은 스크롤해도 따라온다 — 오른쪽의 브리핑을 읽는 내내 D-day와 선언문이 눈에 남아 있어야
 * 브리핑이 매긴 우선순위를 그 기준으로 판단할 수 있다. 그게 이 화면이 2단인 이유다.
 *
 * 1024px 이하에서는 전부 한 줄로 쌓인다(min-[1025px]). 그때 읽는 순서는
 * 인사 → 날씨 → 체크인 → 카운터 → 선언문 → 오늘·이번 주 → 브리핑이다.
 *
 * 왼쪽(카운터·선언문)은 0014 RLS가 Chairman(과 AIAgent)에게만 내준다. 다른 역할에게는
 * 빈 값이라 오른쪽만 보인다. 체크인 칸은 0019가 Chairman에게만 내주고, 화면도 아예 안 그린다.
 *
 * 날짜는 URL에 둔다(HANDOVER ④) — "9월 17일 브리핑 봐 달라"가 링크 한 줄이 된다.
 * 같은 날 여러 번 돌렸으면(수동 실행) 최신 실행이 위에 오고, 앵커(#biz_dy)는 최신 실행에만 붙는다.
 * 대시보드 패널의 '결과물 열기'가 /ai?date=…#회사 로 여기에 떨어진다 —
 * 회사별 칸을 탭으로 바꾸지 않고 details로 둔 이유가 그 앵커다.
 */
export default async function AiPage(props: PageProps<'/ai'>) {
  const params = await props.searchParams
  const repo = await getRepository()
  const today = kstToday()
  const weekLater = shift(today, 7)

  /**
   * 세션을 먼저 읽는다. 체크인은 Chairman일 때만 **묻는다** — RLS가 어차피 null을 주지만,
   * 아닌 사람 화면을 그리며 그 테이블을 건드릴 이유가 없다.
   * currentUser()는 요청 단위로 캐시되므로 레이아웃이 이미 읽은 값을 그대로 받는다.
   */
  const user = await currentUser()
  const isChairman = user?.role === 'Chairman'

  // 위치는 헤더를 읽는 서버 함수다(P5-5b). 날씨가 이 결과에 걸려 있어 먼저 기다린다 —
  // 외부 왕복이 아니라 요청 헤더 조회라 여기서 늘어나는 시간은 없다.
  const location = await resolveLocation()

  const [
    outputs,
    businesses,
    chairmanProjects,
    manifesto,
    initiatives,
    calendarItems,
    weather,
    cityWeather,
    fx,
    checkin,
  ] = await Promise.all([
    repo.listAiNightOutputs(),
    repo.listBusinesses(),
    repo.listChairmanProjects(),
    repo.getChairmanManifesto(),
    repo.listInitiatives(),
    repo.listCalendarItems(today, weekLater),
    // 실패해도 null로만 온다. 아침 화면이 외부 API 때문에 비지 않는다(weather.ts 머리 주석).
    getCurrentLocationWeather(location),
    // 관심 도시 6곳(요구사항의 '현재 위치 + 관심 도시'). 좌표 6개를 한 요청으로 묶어 부르고
    // 30분 캐시를 탄다 — 현재 위치 호출과 URL이 달라 캐시 항목이 둘이지만, 아침에 몇 번을
    // 새로고침해도 Open-Meteo에는 30분마다 두 번만 나간다. 실패는 도시별 null로만 온다.
    getBusinessCitiesWeather(),
    // 환율도 같은 계약이다 — 실패는 null이고 띠가 통째로 빠질 뿐 화면은 선다.
    // 날씨 두 건과 함께 묶어 두면 세 외부 왕복이 병렬로 돌아 이 페이지의 대기 시간이
    // 셋의 합이 아니라 가장 느린 하나가 된다.
    getFxStrip(),
    isChairman ? repo.getCheckin(today) : Promise.resolve(null),
  ])

  // 카운터는 진행 중인 것만. 끝났거나 접은 프로젝트는 아침에 셀 날이 아니다.
  const activeProjects = orderProjects(chairmanProjects).filter((p) => p.status === 'Active')

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

  /**
   * 날짜는 서버에서 KST로 찍어 문자열로 내려 준다. 시각과 달리 초 단위로 움직이지 않아
   * 서버와 클라이언트가 같은 문자열을 그리고, 그래서 하이드레이션과 무관하다.
   * timeZone을 명시하지 않으면 서버(UTC)에서 09:00 KST 전에 하루 밀린 날짜가 나간다.
   */
  const dateLabel = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date())

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      {/* 상단 3칸. 체크인이 없는 역할에게는 2칸이다 — 빈 칸을 남겨 두면 '여기 뭔가 있다'가
          그대로 보이고, 그건 체크인을 숨긴 이유를 되돌리는 것이다. */}
      <div
        className={`grid gap-4 ${isChairman ? 'min-[1025px]:grid-cols-3' : 'min-[1025px]:grid-cols-2'}`}
      >
        <GreetingClock name={user?.name ?? null} dateLabel={dateLabel} />
        <WeatherPanel
          city={location.city}
          source={location.source}
          initial={weather}
          cities={cityWeather}
        />
        {isChairman ? <CheckinPanel date={today} initial={checkin} /> : null}
      </div>

      {/* 환율 띠. 상단 3칸 아래 가로로 눕는다 — 옆에 끼우면 사이드바를 펼쳤을 때
          상단 네 칸이 전부 좁아진다(fx-strip.tsx 머리 주석). 실패하면 아무것도 안 그린다. */}
      <FxStrip data={fx} />

      <div className="mt-5 grid gap-6 min-[1025px]:grid-cols-[minmax(0,560px)_minmax(0,1fr)] min-[1025px]:gap-8">
        {/* 왼쪽 — 바뀌지 않는 것. 스크롤해도 따라온다.
            sticky에는 다섯이 다 필요하다: sticky + top-* + self-start + max-h-* + overflow-y-auto.
            max-h 없이 sticky만 주면 선언문 전문이 길어 칸이 스크롤 컨테이너보다 커지고,
            그때 고정이 조용히 풀려 칸이 통째로 위로 밀려 올라간다.

            **max-h는 이 셸의 높이에서 나온 숫자다.** 스크롤 컨테이너는 창(window)이 아니라
            (morning)/layout.tsx의 <main>이다. 그 셸에는 헤더도 시스템바도 없어
            <main>의 높이가 100vh 그대로고, 여기에 top-4(1rem)와 아래 여백 1rem을 빼
            calc(100vh - 2rem)이 된다.
            (dashboard) 셸의 8.5rem을 베끼면 안 된다 — 그 숫자는 Header h-14(3.5rem) +
            SystemBar h-12(3rem) + 여백 2rem이라 이 셸에 없는 높이를 빼는 값이다.
            **이 셸에 바를 하나라도 붙이면 그 높이만큼 여기 2rem도 같이 늘려야 한다.** */}
        <div className="min-[1025px]:sticky min-[1025px]:top-4 min-[1025px]:max-h-[calc(100vh-2rem)] min-[1025px]:self-start min-[1025px]:overflow-y-auto min-[1025px]:pr-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Icon name="target" className="size-4 text-ink-dim" />
              장기 프로젝트 · 선언문
            </h2>
            {isChairman ? (
              <Link
                href="/settings/chairman"
                className="rounded-md border border-line bg-panel px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
              >
                루틴 편집
              </Link>
            ) : null}
          </div>

          {activeProjects.length > 0 ? (
            <div className="mt-3">
              <ProjectCounters projects={activeProjects} today={today} />
            </div>
          ) : null}

          {manifesto.body ? (
            /* 유리 한 장 위에 올린다. 선언문 자체가 aria-label을 갖고 있어(Manifesto)
               여기서 또 이름을 붙이면 같은 영역에 이름이 두 개 생긴다 — 카드는 면만 낸다. */
            <GlassCard className="mt-4">
              <Manifesto body={manifesto.body} />
            </GlassCard>
          ) : null}

          {isChairman && activeProjects.length === 0 && !manifesto.body ? (
            <p className="mt-3 rounded-xl border border-dashed border-line bg-panel p-4 text-[12px] text-ink-muted">
              아직 장기 프로젝트와 선언문이 없습니다.{' '}
              <Link href="/settings/chairman" className="text-accent underline-offset-2 hover:underline">
                회장 루틴 설정
              </Link>
              에서 넣으면 이 칸 맨 위에 올라옵니다.
            </p>
          ) : null}
        </div>

        {/* 오른쪽 — 오늘 바뀐 것. 두 덩어리를 각각 유리 위에 올린다:
            여기 글자에는 ink-muted와 상태색(지난 D-day)이 섞여 있어 맨 배경 위에 두면 안 된다
            (globals.css '유리 없이 글자를 놓지 마라'). 다크 라디얼 위에서도 같은 원칙이다. */}
        <div className="min-w-0 space-y-5 pb-6">
          {todayItems.length > 0 || upcomingInitiatives.length > 0 || staleInitiatives.length > 0 ? (
            <GlassCard as="section">
              <TodayAndWeek
                todayItems={todayItems}
                upcoming={upcomingInitiatives}
                stale={staleInitiatives}
                today={today}
              />
            </GlassCard>
          ) : null}

          <GlassCard as="section" aria-labelledby="ai-brief-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="ai-brief-heading"
                className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"
              >
                <Icon name="sparkles" className="size-4 text-ink-dim" />
                AI 브리핑
              </h2>
              {isChairman ? <RunNightBrief /> : null}
            </div>

            {dates.length === 0 ? (
              <p className="mt-4 text-[12.5px] text-ink-muted">
                아직 브리핑이 없습니다. 첫 Cron은 오늘 23:00(KST)에 돕니다.
              </p>
            ) : (
              <div className="mt-3">
                {/* 2단 안에서는 날짜 목록을 세울 폭이 없다. 가로 한 줄로 둔다. */}
                <nav aria-label="브리핑 날짜" className="mb-3">
                  <ul className="flex gap-1 overflow-x-auto">
                    {dates.map((d) => (
                      <li key={d}>
                        <Link
                          href={`/ai?date=${d}`}
                          aria-current={d === date ? 'page' : undefined}
                          className={`block rounded-lg px-3 py-2 text-[12.5px] whitespace-nowrap tnum transition-colors ${
                            d === date
                              ? 'bg-raised font-semibold text-ink'
                              : 'text-ink-muted hover:bg-raised/60 hover:text-ink-dim'
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
          </GlassCard>
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

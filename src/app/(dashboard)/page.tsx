import { CityStrip } from '@/components/city/city-strip'
import { AiNightPanel } from '@/components/dashboard/ai-night-panel'
import { AlertPanel } from '@/components/dashboard/alert-panel'
import { AttentionCard } from '@/components/dashboard/attention-card'
import { ClockWeatherCard } from '@/components/dashboard/clock-weather-card'
import { CriticalBanner } from '@/components/dashboard/critical-banner'
import { DashboardBoard } from '@/components/dashboard/dashboard-board'
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs'
import { DdayHero } from '@/components/dashboard/dday-hero'
import { DecisionPanel } from '@/components/dashboard/decision-panel'
import { InitiativeStat } from '@/components/dashboard/initiative-stat'
import { StrategicCoordinates } from '@/components/dashboard/strategic-coordinates'
import { WaitingOnMe } from '@/components/dashboard/waiting-on-me'
import { Icon } from '@/components/ui/icon'
import { recordScreenRead } from '@/lib/activity-record'
import { summarizeAttention } from '@/lib/attention/screen'
import { currentUser } from '@/lib/auth/session'
import { kstToday } from '@/lib/chairman-project'
import { buildCityItems } from '@/lib/city'
import { cityPhase } from '@/lib/city-phase'
import { summarizeDependency } from '@/lib/dependency'
import { orderInitiatives } from '@/lib/initiative'
import { resolveLocation } from '@/lib/geo'
import { getRepository, loadDashboard } from '@/lib/repository'
import { getCurrentLocationWeather } from '@/lib/weather'

/**
 * 메인 대시보드. CH-001~019가 모두 올라와 있다.
 *
 * 데이터를 읽는 유일한 자리다. 서버에서 한 번에 다 읽어 아래 컴포넌트로 내려 준다.
 * 패널마다 각자 읽게 두면 live 모드에서 한 화면에 왕복이 열 번 넘게 생기고,
 * 화면 조각마다 다른 시점의 숫자를 보여 주게 된다.
 *
 * 어느 어댑터로 붙는지(시드냐 Supabase냐)는 getRepository()만 안다 —
 * 이 파일도, 아래 컴포넌트도 그걸 알 필요가 없다.
 */

export default async function DashboardPage() {
  // 블록 7. 페이지 진입. 회장이 하루에 가장 자주 여는 화면이라 5분 억제가 실제로
  // 일하는 자리이기도 하다 — 없으면 이 한 줄이 기록의 절반을 차지한다.
  await recordScreenRead({ path: '/', kind: 'page' })

  const repo = await getRepository()
  // 위치는 요청 헤더 조회라 왕복이 없다. 날씨·프로세스차트는 나머지와 나란히 기다린다.
  const location = await resolveLocation()
  const [data, user, chairmanProjects, initiatives, weather, processCharts] = await Promise.all([
    loadDashboard(repo),
    currentUser(),
    repo.listChairmanProjects(),
    repo.listInitiatives(),
    // 실패해도 null로만 온다. 카드가 그 칸만 비우고 시계는 그대로 선다.
    getCurrentLocationWeather(location),
    repo.listProcessCharts(),
  ])

  const today = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date())
  const todayIso = kstToday()

  // item B: 대시보드 좌측에 올리는 이니셔티브는 요약이지 전체 그리드가 아니다. 기준은
  // '진행 중, 다음 행동이 급한 순'(orderInitiatives와 같은 정렬) 상위 6건 — 3열 그리드
  // 두 줄이다. 목록 화면(/initiatives)의 전체 카드를 그대로 복제하지 않는다.
  const activeInitiatives = initiatives.filter((i) => i.status === 'Active')
  const initiativeSummary = orderInitiatives(activeInitiatives).slice(0, 6)
  const initiativeLogoUrls = await repo.signInitiativeLogos(
    [...new Set(initiativeSummary.map((i) => i.logo_url).filter((p): p is string => p !== null))],
  )

  /**
   * 회사 카드의 진행률(0028 company_progress).
   *
   * 프로젝트 목록에서 평균을 내지 않는다. 0027이 projects에 subtree 겹을 얹은 뒤로 그
   * 목록은 보는 사람마다 잘려서, 같은 회사 카드가 사람마다 다른 숫자를 말하게 된다.
   * 진행률은 회사의 사실이라 definer 집계가 회사 전체에서 평균 하나만 내준다.
   */
  const companyProgress = await repo.listCompanyProgress(
    data.businesses.map((b) => b.business_id),
  )

  /**
   * 블록 A. 의존도 카드가 쓰는 한 줄. **여기서 한 번만 접는다** — /dependency도 같은
   * summarizeDependency()를 쓰고, 두 화면이 각자 접으면 같은 회사가 두 숫자를 갖는다.
   *
   * 개입 건수는 회장 세션에서만 나온다(0033 10절: audit_log의 FORCE RLS). 그래서
   * 0건을 '0'으로 그리면 안 되는 사람이 있고, 그 판정을 화면에 내려 준다.
   */
  const [dependencyRows, interventionRows, dependencyAreas, autonomyRows, absenceRows] =
    await Promise.all([
      repo.listFounderDependency(),
      repo.listInterventions(),
      repo.listDependencyAreas(),
      repo.listAutonomyAssessments(),
      repo.listAbsenceTests(),
    ])
  const dependency = summarizeDependency({
    businessIds: data.businesses.map((b) => b.business_id),
    dependency: dependencyRows,
    interventions: interventionRows,
    areas: dependencyAreas,
    autonomy: autonomyRows,
    tests: absenceRows,
  })

  /**
   * 블록 B. 최상단 CHAIRMAN ATTENTION 카드(§4). **여기서 한 번만 접는다** — /attention도 같은
   * `summarizeAttention()`을 쓰고, 두 화면이 각자 접으면 같은 회사가 한 화면에서는 «정상»이고
   * 다른 화면에서는 «재지 못함»이 된다.
   *
   * 원장을 같이 읽는 이유: «재지 못한 회사»의 판정에 `cash_runway`가 들어가고 그 규칙은
   * 원장이 낸 런웨이로만 잰다(`readRunway`). 원장 없이 접으면 모든 회사가 «재지 못함»으로
   * 떨어지고, 그 M은 회사의 사실이 아니라 이 화면이 덜 읽은 결과다.
   *
   * 예외가 0행인 것과 «못 보는 것»을 카드가 가를 수 있도록 역할을 같이 내려 준다 —
   * 그 값으로 목록을 거르지 않는다(거르는 것은 RLS다).
   */
  /**
   * Phase 8 G-1. 회사 줄 자리의 도시 띠. 의존 요약과 재무 원천은 위에서 이미 읽었다 —
   * 배치 줄만 더 읽어 /group과 같은 buildCityItems()로 접는다(같은 회사가 두 화면에서 같은 %).
   */
  // 공지 띠는 Phase 6-2에서 직원 홈(/me)으로 옮겼다. 공지 전체는 /groupware에 있다.
  const [cityLayout, phase] = await Promise.all([repo.listCityLayout(), cityPhase()])
  const cityItems = buildCityItems({
    layout: cityLayout,
    businesses: data.businesses,
    initiatives,
    dependency,
    kpis: data.financeKpis,
  })

  const [exceptionRows, exceptionRules, attentionScores, ledger] = await Promise.all([
    repo.listExceptions(),
    repo.listExceptionRules(),
    repo.listAttentionScores(),
    repo.loadFinanceLedger(),
  ])
  const attention = summarizeAttention({
    businesses: data.businesses.filter((b) => b.visible),
    exceptions: exceptionRows,
    rules: exceptionRules,
    scores: attentionScores,
    financeKpis: data.financeKpis,
    ledger,
    role: user?.role,
  })

  return (
    <div id="dash-top" className="mx-auto max-w-[1600px] px-6 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight">
              {/* 이름은 user_profiles.display_name. 세션이 없는 dummy 개발에서만 역할명으로 부른다. */}
              안녕하세요, {user?.name ?? 'Chairman'}님
              <Icon name="crown" className="size-5 text-gold" filled />
            </h1>
            {/* 표시 개수는 카드 줄 머리에서 말한다. 여기서 또 세면 숨김 후 두 숫자가 어긋난다. */}
            <p className="mt-1 text-[12px] text-ink-dim">오늘도 성공적인 하루 되세요.</p>
          </div>
          {/* Task 9. P5-2 리뷰 1라운드로 ChairmanDdayCard(장기 프로젝트 D-day 알약)를 이 줄에서 뺐다 —
              같은 프로젝트가 바로 아래 DdayHero에 히어로 크기로 다시 뜨는데, 인사말 두 줄 아래에
              같은 숫자가 알약으로 또 있으면 회장이 맨 처음 여는 화면에 중복만 남는다.
              InitiativeStat은 남긴다 — 이건 '이니셔티브 센 수'로 DdayHero와 다른 내용이다. */}
          <InitiativeStat initiatives={initiatives} today={todayIso} />
        </div>
        {/* '월간 ▾' 알약을 뺐다 (Phase 5-E 1절). 기간을 고르는 버튼이었는데 고를 대상이
            없었다 — 이 화면의 숫자는 전부 당월 고정이고(KpiStrip period), 기간 선택은
            CH-027이 붙을 때 오는 것이다. 누르면 아무 일도 없는 드롭다운 표식은
            '이 화면은 눌러도 안 된다'를 매일 가르친다. */}
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ink-dim tnum">{today}</span>
        </div>
      </div>

      {/* 상단 탭. 앵커로 스크롤하거나 /ai로 간다 — 자리 안내지 화면 전환이 아니다.
          목록과 동작은 components/dashboard/dashboard-tabs.tsx 한 곳에 있다. */}
      <DashboardTabs />

      {/*
       * Phase 7 블록 B. §4의 최상단 CHAIRMAN ATTENTION. **기존 경보 배너·패널보다 위**이고
       * 그 둘을 지우지 않는다 — Phase 7은 기존 화면을 삭제하지 않고, `alerts`와 `exceptions`를
       * 합치는 것은 블록 E가 HOME을 다시 지을 때의 판단이다(0035 머리 주석과 같은 말).
       * 그래서 오늘 이 화면에는 «위험을 말하는 자리»가 둘이다. 그 사실은 DEFERRED에 적었다.
       */}
      <AttentionCard
        view={attention}
        canTriage={user?.role === 'Chairman' || user?.role === 'BusinessCEO'}
      />

      {/* CH-018 Acceptance는 'Critical rule 즉시 상단 노출'이다. 아래 결정·대기·알림 3장은
          히어로·KPI 8타일·12개월 차트를 지나야 나와 스크롤해야 보인다 —
          Critical이 있는 날에만 이 한 줄이 맨 위에 선다(P5-2에서 순서가 바뀌어도 그대로 유효). */}
      <CriticalBanner
        alerts={data.alerts}
        decisions={data.decisions}
        businesses={data.businesses}
      />

      {/*
       * 1줄 (Phase 5-D 배치). AI 브리핑 2/4 · D-day 1/4 · 날씨+세계시간 1/4.
       *
       * 브리핑 카드에만 data-theme="dark"를 건다 — 안쪽(AiNightPanel)은 한 줄도 고치지 않는다.
       * 이 div가 다크 그라데이션을 직접 칠하므로 카드와 같은 곡률로 잘라 내야 한다.
       * radius가 없으면 그 칠이 네 모서리를 직각으로 채워 밝은 화면에 어두운 사각이 남는다.
       *
       * 시간·날씨는 헤더 칩에서 이 줄의 카드로 옮겼다. 헤더에서는 11px 한 줄이라 훑기 어려웠고,
       * 검색창이 가장 넓은 자리를 써야 하는 바에서 자리만 다투고 있었다.
       */}
      <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-4">
        <div data-theme="dark" className="h-[268px] overflow-hidden rounded-glass lg:col-span-2">
          <AiNightPanel outputs={data.aiNightOutputs} businesses={data.businesses} />
        </div>
        <div className="h-[268px]">
          <DdayHero projects={chairmanProjects} />
        </div>
        <div className="h-[268px]">
          <ClockWeatherCard city={location.city} weather={weather} />
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {/* 이니셔티브 카드 위다. 좌표(어디로·뭘·뭐가 막고·언제)를 먼저 읽고
            그 아래에서 실제로 굴러가는 이니셔티브를 본다 — 순서가 뒤집히면
            목록을 다 읽고 나서야 '왜 이걸 하고 있나'가 나온다. */}
        <StrategicCoordinates
          topGoals={data.topGoals}
          monthlyPriorities={data.monthlyPriorities}
          criticalRisks={data.criticalRisks}
          nextMilestones={data.nextMilestones}
          businesses={data.businesses}
          today={todayIso}
        />
        <DashboardBoard
          businesses={data.businesses}
          financeKpis={data.financeKpis}
          settings={data.userSettings}
          companyProgress={companyProgress}
          processCharts={processCharts}
          initiativeSummary={initiativeSummary}
          initiativeLogoUrls={initiativeLogoUrls}
          initiativeCount={activeInitiatives.length}
          dependency={dependency}
          canSeeInterventions={
            user?.role === 'Chairman' || user?.role === 'GroupCFO' || user?.role === 'BusinessCEO'
          }
          today={todayIso}
          city={<CityStrip phase={phase} items={cityItems} />}
        />
      </div>

      {/*
       * 3줄 아래 (Phase 5-D). 결정·대기·알림 — 오늘 훑는 순서 그대로.
       * 야간 AI 브리핑은 1줄 맨 위로 올라갔다(회장이 아침에 가장 먼저 보는 것이라).
       */}
      <div className="mt-5 grid grid-cols-1 gap-3.5 pb-6 sm:grid-cols-3">
        <div className="h-[268px]">
          <DecisionPanel
            decisions={data.decisions}
            businesses={data.businesses}
            audit={data.decisionAudit}
          />
        </div>

        <div className="h-[268px]">
          <WaitingOnMe tasks={data.tasks} projects={data.projects} businesses={data.businesses} />
        </div>

        {/* 상단 탭 '리스크'가 내려오는 자리. scroll-mt는 스크롤 컨테이너(<main>)의
            위쪽 여백이다 — 없으면 카드 머리가 화면 맨 끝에 딱 붙어 잘린 것처럼 보인다. */}
        <div id="alert-panel" className="h-[268px] scroll-mt-4">
          <AlertPanel
            alerts={data.alerts}
            decisions={data.decisions}
            businesses={data.businesses}
          />
        </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CoordinatesPanel } from '@/components/business/coordinates-panel'
import { FinanceTrend } from '@/components/dashboard/finance-trend'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { PageHeader } from '@/components/layout/page-header'
import { Icon } from '@/components/ui/icon'
import { currentUser } from '@/lib/auth/session'
import { canEditStrategy } from '@/lib/auth/roles'
import { dDay, formatDDay, formatPct } from '@/lib/format'
import { getRepository } from '@/lib/repository'
import {
  DECISION_STATUS_LABEL_KO,
  SEVERITY_LABEL_KO,
  STATUS_LABEL_KO,
  TASK_STATUS_LABEL_KO,
  WORK_PRIORITY_LABEL_KO,
  type Alert,
  type Decision,
  type Project,
  type Severity,
  type Task,
} from '@/types'

/**
 * CH-023 회사 상세 + CH-024 전략 좌표.
 *
 * 대시보드 카드의 '상세 보기'가 여기로 온다. 카드가 숫자 셋만 올리는 이유가
 * 나머지를 이 화면으로 내리기로 했기 때문이다(business-card.tsx 머리 주석).
 *
 * 화면 순서는 '얼마인가 → 어디로 가는가 → 지금 무엇이 도는가'다.
 *   위    회사 KPI 8개 + 12개월 추이   (CH-023)
 *   중간  Mission / 목표 / Gap / Bottleneck (CH-024) — 승인권자는 칸별로 고칠 수 있다(D-13)
 *   아래  이 회사의 프로젝트 · 업무 · 결정 · 알림
 *
 * 없는 회사와 볼 수 없는 회사를 화면에서 구분하지 않는다. businesses_read(0002)가
 * 권한 밖의 회사를 아예 내주지 않으므로 둘 다 목록에 없고, 둘 다 404다 —
 * '있지만 권한이 없다'고 말해 주는 것 자체가 그 회사의 존재를 알려 주는 일이다.
 */
export default async function BusinessDetailPage(props: PageProps<'/business/[id]'>) {
  const { id } = await props.params

  const repo = await getRepository()
  const [businesses, financeKpis, projects, tasks, decisions, alerts, strategies, user] =
    await Promise.all([
      repo.listBusinesses(),
      repo.listFinanceKpis(),
      repo.listProjects(),
      repo.listTasks(),
      repo.listDecisions(),
      repo.listAlerts(),
      repo.listBusinessStrategy(),
      currentUser(),
    ])

  const business = businesses.find((b) => b.business_id === id)
  if (!business) notFound()

  const strategy = strategies.find((s) => s.business_id === id) ?? null

  const ownProjects = projects.filter((p) => p.business_id === id)
  const projectIds = new Set(ownProjects.map((p) => p.project_id))
  // Task는 회사를 직접 들고 있지 않다. project를 거쳐야 회사가 나온다.
  const ownTasks = tasks.filter((t) => projectIds.has(t.project_id))
  const ownDecisions = decisions.filter((d) => d.business_id === id)
  const ownAlerts = alerts.filter((a) => a.business_id === id)

  const projectName = new Map(ownProjects.map((p) => [p.project_id, p.name]))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5">
      <PageHeader
        icon="building"
        title={business.name}
        code="CH-023~024"
        description={`${business.industry} · ${STATUS_LABEL_KO[business.status]} · ${business.business_id}`}
      >
        <Link
          href="/"
          className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          대시보드로
        </Link>
      </PageHeader>

      <div className="mt-4 space-y-3.5">
        {/* 그룹 화면과 같은 8타일·같은 색 규칙을 쓴다. 범위만 이 회사 하나다. */}
        <KpiStrip
          kpis={financeKpis}
          businessIds={[id]}
          title="회사 KPI (당월)"
          scopeNote={`${business.name} 단독`}
        />
        <FinanceTrend
          kpis={financeKpis}
          businessIds={[id]}
          title="재무 추이"
          scopeNote={`${business.name} 단독`}
        />
        {/* 연필을 보여 줄지만 정한다. 실제 판정은 0008의 business_strategy_write다(D-13). */}
        <CoordinatesPanel
          strategy={strategy}
          businessId={id}
          canEdit={canEditStrategy(user)}
        />
      </div>

      <div className="mt-3.5 grid grid-cols-12 gap-3.5 pb-6">
        <Card
          className="col-span-12 xl:col-span-6"
          icon="folder"
          title="프로젝트"
          count={ownProjects.length}
          empty="이 회사에 등록된 프로젝트가 없습니다."
        >
          {ownProjects.map((p) => (
            <ProjectItem key={p.project_id} project={p} />
          ))}
        </Card>

        <Card
          className="col-span-12 xl:col-span-6"
          icon="clipboard"
          title="업무"
          count={ownTasks.length}
          empty="이 회사에 등록된 업무가 없습니다."
          more={{ href: `/tasks?business=${encodeURIComponent(id)}`, label: 'CH-040에서 보기' }}
        >
          {ownTasks.map((t) => (
            <TaskItem
              key={t.task_id}
              task={t}
              projectName={projectName.get(t.project_id) ?? t.project_id}
            />
          ))}
        </Card>

        <Card
          className="col-span-12 xl:col-span-6"
          icon="stamp"
          title="결정"
          count={ownDecisions.length}
          empty="이 회사에 올라온 결정이 없습니다."
          more={{
            href: `/approvals?business=${encodeURIComponent(id)}`,
            label: 'CH-041에서 처리',
          }}
        >
          {ownDecisions.map((d) => (
            <DecisionItem key={d.decision_id} decision={d} />
          ))}
        </Card>

        <Card
          className="col-span-12 xl:col-span-6"
          icon="bell"
          title="알림"
          count={ownAlerts.length}
          empty="열려 있는 알림이 없습니다."
        >
          {ownAlerts.map((a) => (
            <AlertItem key={a.alert_id} alert={a} />
          ))}
        </Card>
      </div>
    </div>
  )
}

function Card({
  className,
  icon,
  title,
  count,
  empty,
  more,
  children,
}: {
  className: string
  icon: 'folder' | 'clipboard' | 'stamp' | 'bell'
  title: string
  count: number
  empty: string
  /** 같은 데이터를 다루는 전용 화면으로 넘기는 자리. 여기서는 보기만 하고 고치지 않는다. */
  more?: { href: string; label: string }
  children: React.ReactNode
}) {
  return (
    <section className={`${className} rounded-xl border border-line-soft bg-panel p-3.5`}>
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name={icon} className="size-4 text-ink-dim" />
          {title}
          <span className="text-[11px] font-normal text-ink-muted tnum">{count}건</span>
        </h2>
        {more ? (
          <Link
            href={more.href}
            className="text-[11px] text-ink-muted transition-colors hover:text-ink"
          >
            {more.label}
          </Link>
        ) : null}
      </div>

      {count === 0 ? (
        <p className="py-6 text-center text-[12px] text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1">{children}</ul>
      )}
    </section>
  )
}

function ProjectItem({ project }: { project: Project }) {
  const overdue = dDay(project.deadline) < 0 && project.status !== 'Done'
  return (
    <li className="rounded-lg px-1.5 py-1.5 transition-colors hover:bg-raised/60">
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{project.name}</p>
        <span
          className={`shrink-0 text-[11px] font-semibold tnum ${
            overdue ? 'text-critical' : 'text-ink-dim'
          }`}
        >
          {formatDDay(project.deadline)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-accent" style={{ width: `${project.progress_pct}%` }} />
        </div>
        <span className="shrink-0 text-[10.5px] text-ink-muted tnum">
          {formatPct(project.progress_pct)}
        </span>
        <span className="shrink-0 text-[10.5px] text-ink-muted">{project.owner}</span>
      </div>
    </li>
  )
}

function TaskItem({ task, projectName }: { task: Task; projectName: string }) {
  return (
    <li className="rounded-lg px-1.5 py-1.5 transition-colors hover:bg-raised/60">
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{task.title}</p>
        {/* CH-017로 올라가 있는 업무는 표식을 준다. 회장 화면에 이미 떠 있다는 뜻이다. */}
        {task.chairman_needed && task.status !== 'Done' ? (
          <Icon name="crown" className="size-3.5 shrink-0 text-gold" filled />
        ) : null}
        <span
          className={`shrink-0 rounded bg-raised px-1.5 py-0.5 text-[10px] ${
            task.status === 'Blocked' ? 'text-critical' : 'text-ink-muted'
          }`}
        >
          {TASK_STATUS_LABEL_KO[task.status]}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[10.5px] text-ink-muted">
        {projectName} · {task.owner} · {formatDDay(task.deadline)}
      </p>
    </li>
  )
}

function DecisionItem({ decision }: { decision: Decision }) {
  const open = decision.status === 'Open'
  return (
    <li className="rounded-lg px-1.5 py-1.5 transition-colors hover:bg-raised/60">
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{decision.title}</p>
        <span
          className={`shrink-0 text-[11px] font-semibold ${
            open && dDay(decision.deadline) < 0 ? 'text-critical' : 'text-ink-dim'
          }`}
        >
          {open ? formatDDay(decision.deadline) : DECISION_STATUS_LABEL_KO[decision.status]}
        </span>
      </div>
      <p className="mt-0.5 text-[10.5px] text-ink-muted">
        {WORK_PRIORITY_LABEL_KO[decision.impact]} · {decision.ai_recommendation || '추천 없음'}
      </p>
    </li>
  )
}

/** Critical만 색을 준다. 색은 위험에만 쓴다(요구사항서 2번). */
const SEVERITY_TONE: Record<Severity, string> = {
  Critical: 'text-critical',
  Warning: 'text-warning',
  Info: 'text-ink-muted',
}

function AlertItem({ alert }: { alert: Alert }) {
  return (
    <li className="rounded-lg px-1.5 py-1.5 transition-colors hover:bg-raised/60">
      <div className="flex items-center gap-1.5">
        <span className={`shrink-0 text-[10px] font-semibold ${SEVERITY_TONE[alert.severity]}`}>
          {SEVERITY_LABEL_KO[alert.severity]}
        </span>
        <p className="min-w-0 flex-1 truncate text-[12.5px]">{alert.message}</p>
      </div>
      <p className="mt-0.5 text-[10.5px] text-ink-muted">
        {alert.category} · {alert.source === 'AI' ? 'AI 탐지' : '룰 탐지'}
      </p>
    </li>
  )
}

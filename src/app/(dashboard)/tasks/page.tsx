import { compareDeadlines } from '@/lib/format'
import { currentUser } from '@/lib/auth/session'
import { boss } from '@/lib/boss'
import { PageHeader } from '@/components/layout/page-header'
import { TaskTable, type TaskListItem } from '@/components/tasks/task-table'
import { FilterChips, type FilterOption } from '@/components/ui/filter-chips'
import { businessName } from '@/lib/lookup'
import { firstParam, oneOf, withParams } from '@/lib/query'
import { getRepository } from '@/lib/repository'
import { TASK_STATUS, TASK_STATUS_LABEL_KO, type Task } from '@/types'

/**
 * CH-040 업무(Task) 화면.
 *
 * 대시보드의 Waiting on Me(CH-017)가 '내 승인 때문에 멈춘 것'만 보여 준다면 여기는 전부다.
 * 그래서 이 화면의 기본 정렬은 '오래 서 있던 것'이 위다 — 목록을 여는 이유가 그거다.
 *
 * 필터는 URL에 있다(lib/query.ts). 회사별로 걸어 둔 화면을 링크로 그대로 넘길 수 있어야 한다.
 *
 * 권한 필터는 앱에 없다. tasks_read(0002)가 자기 회사 프로젝트의 업무만 내주므로,
 * 여기서 다시 거르면 판정이 두 곳으로 갈라진다.
 */

const BASE = '/tasks'

export default async function TasksPage(props: PageProps<'/tasks'>) {
  const params = await props.searchParams
  const businessFilter = firstParam(params.business)
  const statusFilter = oneOf(firstParam(params.status), TASK_STATUS)
  /** CH-017에서 넘어온 화면. 대시보드 Waiting on Me의 '전체 보기'가 이 값을 달고 온다. */
  const needMine = firstParam(params.needed) === '1' ? '1' : undefined

  const repo = await getRepository()
  const [tasks, projects, businesses, user] = await Promise.all([
    repo.listTasks(),
    repo.listProjects(),
    repo.listBusinesses(),
    currentUser(),
  ])
  // 호칭은 보는 사람에 맞춘다 — 직원 화면 용어 원칙(CLAUDE.md).
  const viewerRole = user?.role ?? null

  // Task는 회사를 직접 들고 있지 않다. project를 거쳐야 회사가 나온다.
  const projectOf = new Map(projects.map((p) => [p.project_id, p]))
  const scopeOf = (t: Task) => projectOf.get(t.project_id)?.business_id ?? ''

  /** CH-017과 같은 조건이어야 한다. 완료된 업무는 회장 확인 플래그가 남아 있어도 기다리는 게 아니다. */
  const waitsOnChairman = (t: Task) => t.chairman_needed && t.status !== 'Done'

  const scoped = needMine ? tasks.filter(waitsOnChairman) : tasks
  const byBusiness = businessFilter
    ? scoped.filter((t) => scopeOf(t) === businessFilter)
    : scoped
  const byStatus = statusFilter ? scoped.filter((t) => t.status === statusFilter) : scoped

  /**
   * 각 필터의 개수는 '나머지 필터가 걸린 상태'에서 센다.
   * 전체에서 세면 회사를 고른 뒤에도 상태 탭이 전사 숫자를 들고 있어, 눌러 보면 빈 화면이 나온다.
   */
  const scopeOptions: FilterOption[] = [
    {
      label: '전체 업무',
      href: withParams(BASE, { business: businessFilter, status: statusFilter }),
      active: !needMine,
      count: tasks.length,
    },
    {
      label: `${boss(viewerRole)} 확인 대기`,
      href: withParams(BASE, { business: businessFilter, status: statusFilter, needed: '1' }),
      active: Boolean(needMine),
      count: tasks.filter(waitsOnChairman).length,
    },
  ]

  const statusOptions: FilterOption[] = [
    {
      label: '전체',
      href: withParams(BASE, { business: businessFilter, needed: needMine }),
      active: !statusFilter,
      count: byBusiness.length,
    },
    ...TASK_STATUS.map((s) => ({
      label: TASK_STATUS_LABEL_KO[s],
      href: withParams(BASE, { business: businessFilter, status: s, needed: needMine }),
      active: statusFilter === s,
      count: byBusiness.filter((t) => t.status === s).length,
    })),
  ]

  const businessOptions: FilterOption[] = [
    {
      label: '전체',
      href: withParams(BASE, { status: statusFilter, needed: needMine }),
      active: !businessFilter,
      count: byStatus.length,
    },
    ...businesses.map((b) => ({
      label: b.name,
      href: withParams(BASE, { business: b.business_id, status: statusFilter, needed: needMine }),
      active: businessFilter === b.business_id,
      count: byStatus.filter((t) => scopeOf(t) === b.business_id).length,
    })),
  ]

  const shown = byBusiness.filter((t) => !statusFilter || t.status === statusFilter)

  /**
   * 완료는 뒤로, 나머지는 지금 상태로 들어간 지 오래된 순.
   * blocked_since가 이른 날짜일수록 오래 서 있었다는 뜻이라 문자열 비교가 그대로 순서가 된다.
   */
  const items: TaskListItem[] = [...shown]
    .sort(
      (a, b) =>
        Number(a.status === 'Done') - Number(b.status === 'Done') ||
        a.blocked_since.localeCompare(b.blocked_since) ||
        compareDeadlines(a.deadline, b.deadline),
    )
    .map((task) => ({
      task,
      // 프로젝트가 안 보이면 회사도 알 수 없다 — 업무는 회사를 직접 들고 있지 않다(0002 tasks_read).
      // 빈 문자열을 그대로 두면 줄 머리가 ' · 볼 수 없는 프로젝트'로 시작한다.
      businessName: scopeOf(task) ? businessName(businesses, scopeOf(task)) : '소속 미상',
      /*
       * 프로젝트가 안 보이면 id를 그대로 뿌리지 않는다.
       *
       * 0027이 projects에 subtree 겹을 얹은 뒤로 이 자리는 흔해졌다 — 팀장이 만든
       * 프로젝트 안의 **내 업무**는 보이지만 그 프로젝트 자체는 안 보인다(그게 설계다).
       * 그때 'prj_dy_sales' 같은 내부 키가 화면에 뜨면 사람은 그것을 프로젝트 이름으로
       * 읽고, 더 나쁘게는 아무 의미 없는 문자열을 이름 자리에서 보게 된다.
       * 담당자 이름을 못 찾을 때 '미지정'으로 쓰는 것과 같은 판단이다(DEFERRED D-09 결정 B).
       */
      projectName: projectOf.get(task.project_id)?.name ?? '볼 수 없는 프로젝트',
    }))

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <PageHeader
        icon="clipboard"
        title="업무 관리"
        code="CH-040"
        description={`회사·상태로 걸러 보고, 상태와 ${boss(viewerRole)} 확인 여부를 여기서 바꾼다. 변경은 감사 기록에 남는다.`}
      />

      <div className="mt-4 space-y-2 rounded-xl border border-line-soft bg-panel px-3.5 py-3">
        <FilterChips label="범위" options={scopeOptions} />
        <FilterChips label="상태" options={statusOptions} />
        <FilterChips label="회사" options={businessOptions} />
      </div>

      <TaskTable items={items} viewerRole={viewerRole} />

      <p className="mt-3 pb-6 text-t11 text-ink-dim">
        {items.length}건 표시 중. 보이는 범위는 권한(RLS)이 정한다 — 자기 회사 밖의 업무는 목록에
        아예 오지 않는다.
      </p>
    </div>
  )
}

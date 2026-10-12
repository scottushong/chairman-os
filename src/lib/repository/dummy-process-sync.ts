/**
 * 0071 프로세스 차트 동기화 — dummy(DB 흉내). live에서는 한 줄도 돌지 않는다.
 *
 * 0071의 process_chart_sync_apply · process_chart_visible_to · 업무(tasks) 넣기를 메모리에서 옮겨 적었다.
 * 규칙이 둘로 갈라지지 않게 판정 순서 · 문장 낱말(process_sync_too_soon …)을 SQL과 같게 둔다.
 * npm run check:process-sync가 이 파일과 parse.ts를 함께 잰다(새 줄 · 바뀐 줄 · 사라진 줄 · 두 번 넣기).
 *
 * 저장소는 globalThis에 둔다 — webpack dev는 Server Action 층과 화면 층이 이 모듈을 따로 읽는다(2026-10-07 함정).
 */
import type {
  CalendarItem,
  IsoDate,
  ProcessChartItem,
  ProcessChartSync,
  ProcessSyncWarning,
  Task,
  TaskStatus,
  UserAccount,
} from '@/types'

import type { ProcessSyncApplyInput, ProcessSyncResult, ProcessSyncTrigger, ProcessSyncWriter } from '@/lib/process-sync/run'

import { DUMMY_PEOPLE, DUMMY_TEAMS, DUMMY_UID, dummyHasBusiness } from './dummy-org'

/** dummy 직원 이메일(시트의 «담당자 이메일»이 찾는 값). live는 auth.users.email이다. */
export const DUMMY_STAFF_EMAIL: Readonly<Record<string, string>> = {
  'sales.lead@dy.example': DUMMY_UID.salesLead,
  'sales.staff@dy.example': DUMMY_UID.salesStaff,
  'sales.staff2@dy.example': DUMMY_UID.salesStaff2,
  'support.lead@dy.example': DUMMY_UID.supportLead,
  'support.staff@dy.example': DUMMY_UID.supportStaff,
  'exec@dy.example': DUMMY_UID.exec,
}

interface ChartRef {
  id: number
  business_id: string
  team_name: string
  sheet_id?: string | null
}

interface DummyProcessTask {
  task: Task
  business_id: string
  team_name: string
  owner_user_id: string | null
}

interface Store {
  items: ProcessChartItem[]
  syncs: ProcessChartSync[]
  tasks: Map<string, DummyProcessTask>
  itemSeq: number
  syncSeq: number
}

const holder = globalThis as unknown as { __chairmanDummyProcessSync?: Store }

export function dummyProcessStore(): Store {
  return (holder.__chairmanDummyProcessSync ??= { items: [], syncs: [], tasks: new Map(), itemSeq: 0, syncSeq: 0 })
}

/** 시험(check:process-sync)이 처음 상태로 돌린다. */
export function resetDummyProcessStore(): void {
  holder.__chairmanDummyProcessSync = { items: [], syncs: [], tasks: new Map(), itemSeq: 0, syncSeq: 0 }
}

/** 0071 process_charts.team_id — 같은 회사 · 같은 이름의 팀. */
function teamIdOf(businessId: string, teamName: string): string | null {
  return DUMMY_TEAMS.find((t) => t.business_id === businessId && t.name === teamName.trim())?.team_id ?? null
}

/** 0071 process_chart_visible_to(user, biz, team). */
export function dummyProcessVisible(person: UserAccount | undefined, businessId: string, teamName: string): boolean {
  if (!person || person.revoked_at) return false
  if (person.role === 'Chairman' || person.role === 'GroupCFO') return true
  if (!dummyHasBusiness(person, businessId)) return false
  if (person.role === 'BusinessCEO' || person.role === 'Executive') return true
  if (person.role === 'TeamLead' || person.role === 'Member') {
    const teamId = teamIdOf(businessId, teamName)
    return teamId !== null && person.team_id === teamId
  }
  return false
}

const personOf = (id: string | null) => (id ? DUMMY_PEOPLE.find((p) => p.user_id === id) : undefined)

const STATUS_TO_TASK: Record<ProcessChartItem['status'], TaskStatus> = { 예정: 'Todo', 진행: 'Doing', 완료: 'Done', 보류: 'Blocked' }

/** 0071 process_chart_sync_apply · _fail. chartById는 RLS 없이 탭을 찾는다(정의자 흉내). now는 시험이 시계를 돌리려고 받는다. */
export function dummyProcessSyncWriter(opts: {
  chartById: (id: number) => ChartRef | undefined
  now?: () => number
}): ProcessSyncWriter {
  const now = opts.now ?? (() => Date.now())

  const gate = (chartId: number, trigger: ProcessSyncTrigger, requestedBy: string | null): ChartRef => {
    if ((trigger === 'cron') !== (requestedBy === null)) throw new Error('process_sync_invalid: requested_by')
    const chart = opts.chartById(chartId)
    if (!chart) throw new Error('process_sync_not_found')
    if (!chart.sheet_id) throw new Error('process_sync_not_connected')
    if (requestedBy !== null && !dummyProcessVisible(personOf(requestedBy), chart.business_id, chart.team_name)) {
      throw new Error('process_sync_not_found')
    }
    const store = dummyProcessStore()
    const recent = store.syncs.some(
      (s) => s.business_id === chart.business_id && s.team_name === chart.team_name && Date.parse(s.synced_at) > now() - 60_000,
    )
    if (recent) throw new Error('process_sync_too_soon')
    return chart
  }

  const log = (chart: ChartRef, trigger: ProcessSyncTrigger, requestedBy: string | null, fields: Partial<ProcessChartSync>) => {
    const store = dummyProcessStore()
    store.syncs.unshift({
      id: ++store.syncSeq,
      business_id: chart.business_id,
      team_name: chart.team_name,
      chart_id: chart.id,
      synced_at: new Date(now()).toISOString(),
      actor_user_id: requestedBy,
      trigger,
      ok: true,
      error: null,
      read_count: 0,
      new_count: 0,
      changed_count: 0,
      gone_count: 0,
      skipped_count: 0,
      warnings: [],
      ...fields,
    })
  }

  return {
    async apply(input: ProcessSyncApplyInput): Promise<ProcessSyncResult> {
      const chart = gate(input.chartId, input.trigger, input.requestedBy)
      if (input.rows.length === 0) throw new Error('process_sync_empty')
      const store = dummyProcessStore()
      const at = new Date(now()).toISOString()
      const label = `프로세스 차트 · ${chart.team_name}`
      const projectId = `pc_${chart.business_id}_${chart.team_name}`
      const warnings: ProcessSyncWarning[] = [...input.warnings]
      const ids = new Set<string>()
      let created = 0
      let changed = 0

      for (const row of input.rows) {
        if (!row.id || !row.title || ids.has(row.id)) throw new Error('process_sync_invalid: id/title')
        ids.add(row.id)
        const email = row.email.trim().toLowerCase() || null
        const ownerId = email ? DUMMY_STAFF_EMAIL[email] ?? null : null
        const owner = personOf(ownerId)
        const owner_user_id = owner && !owner.revoked_at && dummyHasBusiness(owner, chart.business_id) ? owner.user_id : null
        if (!owner_user_id) {
          warnings.push({
            id: row.id,
            message: email
              ? `담당자 이메일(${email})을 직원에서 찾지 못해 «담당 미정»으로 넣었습니다.`
              : '담당자 이메일이 비어 «담당 미정»으로 넣었습니다.',
          })
        }
        const next = {
          stage: row.stage || null,
          title: row.title,
          assignee_email: email,
          owner_user_id,
          start_on: (row.start as IsoDate | null) ?? null,
          due_on: (row.due as IsoDate | null) ?? null,
          status: row.status,
          note: row.note || null,
        }
        let item = store.items.find(
          (i) => i.business_id === chart.business_id && i.team_name === chart.team_name && i.sheet_row_id === row.id,
        )
        if (!item) {
          const id = ++store.itemSeq
          item = {
            id,
            business_id: chart.business_id,
            team_name: chart.team_name,
            chart_id: chart.id,
            sheet_row_id: row.id,
            ...next,
            task_id: `pc_${id}`,
            gone_at: null,
            last_synced_at: at,
          }
          store.items.push(item)
          created++
        } else {
          const differs =
            item.gone_at !== null ||
            (Object.keys(next) as (keyof typeof next)[]).some((k) => item![k] !== next[k]) ||
            item.chart_id !== chart.id
          if (differs) changed++
          Object.assign(item, next, { chart_id: chart.id, gone_at: null, last_synced_at: at })
        }
        const prev = store.tasks.get(item.task_id!)
        const status = STATUS_TO_TASK[row.status]
        store.tasks.set(item.task_id!, {
          business_id: chart.business_id,
          team_name: chart.team_name,
          owner_user_id,
          task: {
            task_id: item.task_id!,
            project_id: projectId,
            title: row.title,
            owner: owner?.display_name ?? '담당 미정',
            priority: 'Medium',
            status,
            blocked_since: prev && prev.task.status === status ? prev.task.blocked_since : (at.slice(0, 10) as IsoDate),
            deadline: next.due_on,
            chairman_needed: false,
            source_label: label,
            source_gone_at: null,
          },
        })
      }

      let gone = 0
      for (const item of store.items) {
        if (item.business_id !== chart.business_id || item.team_name !== chart.team_name) continue
        if (item.gone_at !== null || ids.has(item.sheet_row_id)) continue
        item.gone_at = at
        const t = item.task_id ? store.tasks.get(item.task_id) : undefined
        if (t) t.task.source_gone_at = at
        gone++
      }

      log(chart, input.trigger, input.requestedBy, {
        read_count: input.read,
        new_count: created,
        changed_count: changed,
        gone_count: gone,
        skipped_count: input.skipped,
        warnings,
      })
      return { read: input.read, new: created, changed, gone, skipped: input.skipped, warnings: warnings.length }
    },

    async fail({ chartId, trigger, requestedBy, error }) {
      const chart = gate(chartId, trigger, requestedBy)
      log(chart, trigger, requestedBy, { ok: false, error: error.slice(0, 500) })
    },
  }
}

/** 0071 process_chart_items_read — 이 사람이 보는 탭의 줄. */
export function dummyListProcessChartItems(viewer: UserAccount): ProcessChartItem[] {
  return dummyProcessStore()
    .items.filter((i) => dummyProcessVisible(viewer, i.business_id, i.team_name))
    .map((i) => ({ ...i }))
}

/** 0071 process_chart_syncs_read — 최근 것부터. */
export function dummyListProcessChartSyncs(viewer: UserAccount): ProcessChartSync[] {
  return dummyProcessStore()
    .syncs.filter((s) => dummyProcessVisible(viewer, s.business_id, s.team_name))
    .map((s) => ({ ...s, warnings: [...s.warnings] }))
}

/**
 * 0071 tasks_external_scope(리뷰 B) — 시트 업무는 담당자 본인 또는 그 탭을 보는 사람만. AI Agent는 0.
 * dummy listTasks가 0026 식(canSeeRow)과 **함께**(AND) 건다.
 */
export function dummyProcessTaskVisible(viewer: UserAccount, t: DummyProcessTask): boolean {
  if (viewer.role === 'AIAgent') return false
  return t.owner_user_id === viewer.user_id || dummyProcessVisible(viewer, t.business_id, t.team_name)
}

/** dummy listTasks가 덧붙이는 시트 업무(가시성은 호출자가 0026 식 + dummyProcessTaskVisible로 거른다). */
export function dummyProcessTasks(): DummyProcessTask[] {
  return [...dummyProcessStore().tasks.values()]
}

/** 0071 calendar_items 'process' 갈래 — 탭을 보고 업무도 보는 줄 중 날짜가 있는 것. */
export function dummyProcessCalendarItems(viewer: UserAccount, visibleTaskIds: ReadonlySet<string>): CalendarItem[] {
  return dummyListProcessChartItems(viewer)
    .filter((i) => i.gone_at === null && i.task_id && visibleTaskIds.has(i.task_id) && (i.start_on || i.due_on))
    .map((i) => ({
      kind: 'process' as const,
      source_id: i.task_id!,
      title: i.stage ? `${i.stage} · ${i.title}` : i.title,
      on_date: (i.start_on ?? i.due_on)!,
      ends_on: i.start_on && i.due_on && i.due_on > i.start_on ? i.due_on : null,
      business_id: i.business_id,
      initiative_id: null,
      href: `/tasks/${i.task_id}`,
    }))
}

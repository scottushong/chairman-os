import 'server-only'

import { kstToday } from '@/lib/chairman-project'
import { loadCity } from '@/lib/city-load'
import { buildCityLive, type CityLive, type CityLiveSources, type CitySnapshot } from '@/lib/city-live'
import { isDummyData } from '@/lib/env'
import type { ChairmanRepository } from '@/lib/repository'
import { dummyCityLiveSources } from '@/lib/repository/dummy-city-live'
import type { CityLayout, Initiative, Role } from '@/types'

/**
 * 살아 있는 도시 한 장(Phase 8 G-3). /api/city/live가 1분마다 부르고, /group · HOME은 첫 그림을
 * 위해 서버에서 한 번 부른다 — 두 길이 같은 함수를 지나야 첫 그림과 1분 뒤 그림이 같은 규칙이다.
 *
 * **장식이 화면을 넘어뜨리지 않는다.** 원천 하나하나를 따로 읽고, 실패한 것(역할이 못 읽는 표 ·
 * 아직 없는 표)은 빈 것으로 둔다. 건물(loadCity)만은 실패를 그대로 던진다 — 그것은 이 화면의 본문이다.
 *
 * 누가 무엇을 보는지는 RLS가 이미 정했다. 접속 기록(0031 activity_events)은 **회장이 아니면 0건**이라
 * 회장이 아닌 사람의 도시에는 접속한 사람이 서지 않는다 — 여기서 역할로 다시 거르지 않는다.
 */
export async function loadCitySnapshot(
  repo: ChairmanRepository,
  viewerRole: Role | null,
  now = new Date(),
): Promise<CitySnapshot> {
  const city = await loadCity(repo)
  return { items: city.items, live: await loadCityLive(repo, viewerRole, city.layout, city.initiatives, now) }
}

/**
 * 사람 · 서류 · 차량만. HOME은 건물을 이미 읽었으므로(page.tsx buildCityItems) 이것만 더 부른다 —
 * loadCitySnapshot을 부르면 같은 원천을 한 요청에 두 번 읽는다.
 */
export async function loadCityLive(
  repo: ChairmanRepository,
  viewerRole: Role | null,
  layout: CityLayout[],
  initiatives: Initiative[],
  now = new Date(),
): Promise<CityLive> {
  const sources = isDummyData
    ? dummyCityLiveSources({ now, today: kstToday(now), viewerRole, layout, initiatives })
    : await liveSources(repo, viewerRole, layout, now)
  return buildCityLive(sources)
}

async function safe<T>(label: string, read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read()
  } catch (e) {
    console.warn(`[city-live] ${label}: ${e instanceof Error ? e.message : String(e)}`)
    return empty
  }
}

async function liveSources(
  repo: ChairmanRepository,
  viewerRole: Role | null,
  layout: CityLayout[],
  now: Date,
): Promise<CityLiveSources> {
  const today = kstToday(now)
  const [accounts, teams, events, tasks, projects, decisions, initiatives, outputs] = await Promise.all([
    safe('accounts', () => repo.listUserAccounts(), []),
    safe('teams', () => repo.listTeams(), []),
    // 0031은 날 단위로 자른다. 하루치를 받아 5분을 여기서 자른다(buildCityLive).
    safe('activity', () => repo.listActivityEvents(1), []),
    safe('tasks', () => repo.listTasks(), []),
    safe('projects', () => repo.listProjects(), []),
    safe('decisions', () => repo.listDecisions(), []),
    safe('initiatives', () => repo.listInitiatives(), []),
    safe('ai', () => repo.listAiNightOutputs(), []),
  ])
  const leads = new Set(teams.map((t) => t.lead_user_id).filter((v): v is string => v !== null))
  const projectBusiness = new Map(projects.map((p) => [p.project_id, p.business_id]))

  return {
    now,
    today,
    viewerRole,
    layout,
    people: accounts
      .filter((a) => a.revoked_at === null)
      .map((a) => ({
        user_id: a.user_id,
        role: a.role,
        name: a.display_name,
        business_id: a.business_ids[0] ?? null,
        is_lead: leads.has(a.user_id),
      })),
    // 실패한 로그인은 «들어왔다»가 아니다.
    activity: events
      .filter((e) => e.actor_user_id !== null && e.ok !== false)
      .map((e) => ({ user_id: e.actor_user_id as string, at: e.occurred_at, kind: 'in' as const })),
    tasks: tasks.map((t) => ({
      task_id: t.task_id,
      owner: t.owner,
      business_id: projectBusiness.get(t.project_id) ?? null,
      status: t.status,
      since: t.blocked_since ?? null,
      deadline: t.deadline,
    })),
    requests: decisions.flatMap((d): CityLiveSources['requests'] => {
      if (d.status !== 'Open') return []
      if (d.lead_status === 'pending') {
        return [{ id: d.decision_id, business_id: d.business_id, created_by: d.created_by ?? null, stage: 'to_lead' as const }]
      }
      // 팀장이 회장에게 올린 것 — 팀장 확인 요청(escalated)이거나, 팀장 단계를 지나 규칙이 회장까지 올린 것.
      const passedLead = d.lead_status === 'approved' || d.lead_status === 'skipped'
      if (d.escalated || (passedLead && d.chairman_required)) {
        return [{ id: d.decision_id, business_id: d.business_id, created_by: d.created_by ?? null, stage: 'to_chairman' as const }]
      }
      return []
    }),
    initiatives: initiatives
      .filter((i) => i.status === 'Active')
      .map((i) => ({
        initiative_id: i.initiative_id,
        title: i.title,
        business_id: i.business_id,
        next_action_date: i.next_action_date,
      })),
    // 오늘 돌기 시작한 Job만 — 어제 멈춘 'Running' 줄이 로봇을 영원히 걷게 하지 않는다.
    aiRunning: outputs.some((o) => o.status === 'Running' && (o.run_date ?? o.completed_at?.slice(0, 10)) === today),
    briefDoneToday: outputs.some((o) => o.business_id === null && o.status === 'Done' && o.run_date === today),
  }
}

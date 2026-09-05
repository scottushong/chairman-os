import type {
  AiNightOutput,
  Alert,
  BomRecord,
  Business,
  CriticalRisk,
  Decision,
  FinanceKpi,
  MesRecord,
  MonthlyPriority,
  NextMilestone,
  Project,
  RndRecord,
  Task,
  TopGoal,
} from '@/types'

import aiNightOutputJson from './ai-night-output.json'
import alertsJson from './alerts.json'
import bomJson from './bom.json'
import businessesJson from './businesses.json'
import decisionsJson from './decisions.json'
import financeKpiJson from './finance-kpi.json'
import mesJson from './mes.json'
import projectsJson from './projects.json'
import rndJson from './rnd.json'
import strategyJson from './strategy.json'
import tasksJson from './tasks.json'

/**
 * 06_Dummy_Data 시드. JSON은 구조만 있고 문자열 리터럴 타입이 없어
 * 여기서 한 번만 도메인 타입으로 좁혀 내보낸다. 화면 코드는 이 파일만 본다.
 */

export const businesses = businessesJson as Business[]
export const financeKpis = financeKpiJson as FinanceKpi[]
export const projects = projectsJson as Project[]
export const tasks = tasksJson as Task[]
export const decisions = decisionsJson as Decision[]
export const alerts = alertsJson as Alert[]
export const mesRecords = mesJson as MesRecord[]
export const rndRecords = rndJson as RndRecord[]
export const bomRecords = bomJson as BomRecord[]
export const aiNightOutputs = aiNightOutputJson as AiNightOutput[]

export const topGoals = strategyJson.top_goals as TopGoal[]
export const monthlyPriorities = strategyJson.monthly_priorities as MonthlyPriority[]
export const criticalRisks = strategyJson.critical_risks as CriticalRisk[]
export const nextMilestones = strategyJson.next_milestones as NextMilestone[]

/** 시드가 담고 있는 마지막 마감 기간. 대시보드 기본 조회 월이다. */
export const LATEST_PERIOD = '2026-08'

/** 화면에 노출할 회사만, Pin 우선 · sort_order 순으로. CH-003/004/005. */
export function visibleBusinesses(): Business[] {
  return businesses
    .filter((b) => b.visible)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sort_order - b.sort_order)
}

export function businessName(businessId: string): string {
  return businesses.find((b) => b.business_id === businessId)?.name ?? businessId
}

/** Task는 회사를 직접 들고 있지 않다. project를 거쳐야 회사가 나온다(CH-017 그룹핑). */
export function businessOfProject(projectId: string): string {
  return projects.find((p) => p.project_id === projectId)?.business_id ?? 'unknown'
}

import type {
  AiNightOutput,
  Alert,
  BomRecord,
  Business,
  BusinessStrategy,
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
/** CH-024. live에서는 0008 business_strategy가 같은 값을 갖는다. */
export const businessCoordinates = strategyJson.business_coordinates as BusinessStrategy[]

/**
 * 여기 있던 조회·정렬 헬퍼(LATEST_PERIOD / visibleBusinesses / businessName / businessOfProject)는
 * lib/finance.ts와 lib/lookup.ts로 옮겼다. 그 함수들이 시드를 직접 읽는 한
 * live 모드 화면에도 시드 값이 섞여 나오기 때문이다. 이 파일은 이제 시드를 내보내기만 한다.
 */

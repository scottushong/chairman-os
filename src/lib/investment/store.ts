/**
 * Investment Intelligence 저장소 손잡이(0094~) — ChairmanRepository가 펼쳐 넣는다(live: repository/supabase-investment.ts ·
 * dummy: repository/dummy-investment.ts). 대표 · 지정자 세션으로 읽고, 손 입력은 대표만(RLS inv_admin).
 * 0094 전 DB면 'investment_unavailable'(앱이 DB보다 먼저 나갈 수 있다).
 */
import type {
  ChangeStatus,
  InvChange,
  InvCorporateAction,
  InvDisclosure,
  InvEtfHolding,
  InvFact,
  InvManager,
  InvMetric,
  InvPosition,
  InvPrice,
  InvRun,
  InvSecurity,
  InvSettings,
  InvSource,
  ManagerId,
} from './types'

export interface InvChangeQuery {
  toDisclosures?: readonly string[]
  securityId?: string
  statuses?: readonly ChangeStatus[]
  limit?: number
}

export interface InvPositionQuery {
  disclosureIds: readonly string[]
  /** 평가액 큰 순 앞에서 몇 줄 — 없으면 전부 */
  limit?: number
}

export interface ManualDisclosureInput {
  manager_id: ManagerId
  source_id: 'fundsmith:factsheet' | 'pershing:site' | 'manual'
  data_as_of: string
  source_published_at: string | null
  source_url: string
  coverage: string
  rows: { issuer_name: string; ticker: string | null; shares: number | null; weight_pct: number | null; value: number | null }[]
}

export interface InvestmentMethods {
  invManagers(): Promise<InvManager[]>
  invSources(): Promise<InvSource[]>
  invSettings(): Promise<InvSettings>
  invRuns(limit: number): Promise<InvRun[]>
  invDisclosures(): Promise<InvDisclosure[]>
  invChanges(q: InvChangeQuery): Promise<InvChange[]>
  /** 판정 개수만(목록이 큰 NBIM 전체 목록용) */
  invChangeCounts(toDisclosure: string): Promise<Record<ChangeStatus, number>>
  invPositions(q: InvPositionQuery): Promise<InvPosition[]>
  /** 이 종목의 보유 줄 전부(기관 · 기준일별) */
  invSecurityPositions(securityId: string): Promise<InvPosition[]>
  invSecurities(opts?: { watch?: boolean; ids?: readonly string[] }): Promise<InvSecurity[]>
  invSecurity(id: string): Promise<InvSecurity | null>
  invPrices(securityId: string): Promise<InvPrice[]>
  invActions(securityId: string): Promise<InvCorporateAction[]>
  invFacts(securityId: string): Promise<InvFact[]>
  invMetrics(securityId: string): Promise<InvMetric[]>
  invEtfHoldings(securityId: string): Promise<InvEtfHolding[]>

  // ── 대표 손 입력(출처 · 기준일 필수 · 감사 한 줄) ──
  invSaveSettings(patch: Partial<Omit<InvSettings, 'updated_at'>>): Promise<void>
  invManualDisclosure(input: ManualDisclosureInput): Promise<string>
  invAddAction(a: Omit<InvCorporateAction, 'action_id' | 'source'>): Promise<void>
  invAddMetric(m: Omit<InvMetric, 'source_type'> & { source_type: 'manual_official' | 'factsheet' }): Promise<void>
  invSetWatch(securityId: string, watch: boolean, reason: string): Promise<void>
  invAudit(action: string, entity: string, entityId: string | null, detail: Record<string, unknown>): Promise<void>
}

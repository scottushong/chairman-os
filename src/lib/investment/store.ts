/**
 * Investment Intelligence 저장소 손잡이(0094~) — ChairmanRepository가 펼쳐 넣는다(live: repository/supabase-investment.ts ·
 * dummy: repository/dummy-investment.ts). 대표 · 지정자 세션으로 읽고, 손 입력은 대표만(RLS inv_admin).
 * 0094 전 DB면 'investment_unavailable'(앱이 DB보다 먼저 나갈 수 있다).
 */
import type {
  ChangeStatus,
  InvAccount,
  InvApproval,
  InvCorpTx,
  InvOutcome,
  InvPaperPortfolio,
  InvPaperTx,
  InvAiUsage,
  InvAlert,
  InvBrief,
  InvEvidence,
  InvForecast,
  InvMarket,
  InvMarketSource,
  InvPhilosophy,
  InvRecommendation,
  InvScenario,
  InvScoreRow,
  InvThesis,
  InvValuationRow,
  InvValueChain,
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

  // ── 0095 산업 · 점수 · 가설 · 시나리오 · 추천 · 알림 · 브리핑 ──
  invMarkets(): Promise<InvMarket[]>
  invMarketSources(): Promise<InvMarketSource[]>
  invForecasts(): Promise<InvForecast[]>
  invValueChains(): Promise<InvValueChain[]>
  invScores(subjectType?: 'market' | 'company', subjectId?: string): Promise<InvScoreRow[]>
  invPhilosophy(): Promise<InvPhilosophy[]>
  invTheses(securityId?: string): Promise<InvThesis[]>
  invEvidence(thesisIds: readonly string[]): Promise<InvEvidence[]>
  invScenarios(securityId?: string): Promise<InvScenario[]>
  invValuations(securityId: string): Promise<InvValuationRow[]>
  /** latestOnly면 종목마다 최신 버전 한 줄 */
  invRecommendations(opts?: { securityId?: string; latestOnly?: boolean }): Promise<InvRecommendation[]>
  invAlerts(limit: number): Promise<InvAlert[]>
  invBriefs(limit: number): Promise<InvBrief[]>
  /** 대표만(RLS) — 지정자 · AI는 null */
  invAiUsage(): Promise<InvAiUsage | null>

  // 대표 손 입력(사람) — 산업 자료는 출처 필수
  invAddMarketSource(s: Omit<InvMarketSource, 'source_id'>): Promise<string>
  invAddForecast(f: Omit<InvForecast, 'forecast_id'>): Promise<void>
  invAddValueChain(c: Omit<InvValueChain, 'chain_id'>): Promise<void>
  invSetSecurityMarket(securityId: string, marketId: string | null): Promise<void>
  invMarkAlertRead(alertId: number): Promise<void>
  invSaveWeights(w: import('./scores').Weights): Promise<void>

  // 분석 이력 — INSERT만(사람 · AI · system 공통, created_kind로 구분). 고치기 · 지우기 없음.
  invAddScore(r: Omit<InvScoreRow, 'score_id' | 'created_at'>): Promise<void>
  invAddThesis(t: Omit<InvThesis, 'thesis_id' | 'created_at'>, evidence: Omit<InvEvidence, 'evidence_id' | 'thesis_id'>[]): Promise<string>
  invAddScenario(s: Omit<InvScenario, 'scenario_row_id' | 'created_at'>): Promise<number>
  invAddValuation(v: Omit<InvValuationRow, 'valuation_id' | 'created_at'>): Promise<void>
  invAddRecommendation(r: Omit<InvRecommendation, 'rec_id' | 'created_at'>): Promise<string>
  invAddAlerts(a: readonly Omit<InvAlert, 'alert_id' | 'created_at' | 'read_at'>[]): Promise<number>
  invAddBrief(b: Omit<InvBrief, 'brief_id' | 'created_at'>): Promise<void>

  // ── 0096 DY Portfolio · Performance ──
  invAccounts(): Promise<InvAccount[]>
  /** 결재 상태(investment_approval_states)를 붙여서 */
  invApprovals(): Promise<InvApproval[]>
  invCorpTxs(): Promise<InvCorpTx[]>
  invPaperPortfolios(): Promise<InvPaperPortfolio[]>
  invPaperTxs(): Promise<InvPaperTx[]>
  invOutcomes(): Promise<InvOutcome[]>
  invAddAccount(a: Omit<InvAccount, 'account_id' | 'owner_entity'>): Promise<string>
  invAddApproval(a: Omit<InvApproval, 'approval_id' | 'created_at' | 'status' | 'decided_at' | 'doc_no' | 'approver_name'>): Promise<string>
  /** 매수 · 매도는 승인 완료 결재가 있어야(DB 트리거가 판정 · 승인자/시각을 옮겨 적음) */
  invAddCorpTx(t: Omit<InvCorpTx, 'tx_id' | 'approved_by_name' | 'approved_at' | 'entered_at'>): Promise<void>
  invAddPaperTx(t: Omit<InvPaperTx, 'tx_id' | 'created_at'>): Promise<void>
  invAddOutcome(o: Omit<InvOutcome, 'outcome_id' | 'created_at'>): Promise<void>
  invSavePlan(equity: string | null, bond: string | null): Promise<void>
}

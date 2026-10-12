import type { Role } from '@/types'

/**
 * 기능 스위치(0073 · «빼기 쉬운 구조» PHASE 1) — 새 기능마다 한 줄. 대표 결정 2026-10-12:
 * «대표 허락 없이 끝까지 만든다. 대표가 나중에 뺀다.» 그래서 새 기능은 전부 여기 이름이 있고, 끄는 곳은 /settings/features 한 곳이다.
 *
 * 이 파일은 순수하다(서버 · DB를 모른다) — 목록과 판정 규칙만. DB를 읽는 featureOn은 features-server.ts.
 * 판정: 회사 줄 → 그룹 줄 → (줄이 없으면 · 0073 전 DB면) 아래 기본값. enabled가 false면 **아무에게도** 안 열린다(대표 포함).
 * DB 쪽 같은 규칙은 0073 feature_on() — 기본 줄을 0073이 넣는다(키 · 기본값이 여기와 같아야 한다 — check:features가 대조).
 * 빼는 법(반영에서 브랜치 · 마이그레이션 빼기)은 docs/onboarding/feature-removal.md.
 */

/** chairman 대표만 · exec 임원 이상(대표 · CFO · 회사 대표 · 임원) · all 전원. */
export type FeatureAudience = 'chairman' | 'exec' | 'all'

export const FEATURE_AUDIENCES: readonly FeatureAudience[] = ['chairman', 'exec', 'all']

export const AUDIENCE_LABEL: Record<FeatureAudience, string> = {
  chairman: '대표만',
  exec: '임원 이상',
  all: '전원',
}

export interface FeatureDef {
  key: string
  label: string
  description: string
  defaultAudience: FeatureAudience
  /** 어디서 왔나 — 단계 · 브랜치 · 마이그레이션(빼기 안내서와 같은 말). */
  from: string
}

export const FEATURES = [
  {
    key: 'ai_assist',
    label: 'AI 어시스턴트 보강',
    description: 'AI 답마다 «보완 의견 남기기»와 시스템 보완함(/settings/feedback). 어시스턴트 자체는 끄지 않는다.',
    defaultAudience: 'all',
    from: 'release/ai-assist · 0069',
  },
  {
    key: 'finance_upload',
    label: '자료 올리기',
    description: '회계 · 재무 자료 올리기 화면(/finance/<회사>/upload)과 넣기 · 되돌리기 · 평가금액 · 같은 거래 묶음.',
    defaultAudience: 'all',
    from: 'release/finance-upload-v2 · 0070 · 0072',
  },
  {
    key: 'process_charts',
    label: '프로세스 차트',
    description: '팀별 업무 시트 화면(/process-charts) · 메뉴 · 업무 관리 동기화.',
    defaultAudience: 'all',
    from: 'pchart · 0071',
  },
  {
    key: 'intake',
    label: '자료 받는 입구',
    description: '회사 화면의 «자료 받는 입구»(AI 분류). 꺼지면 예전 «첨부» 칸으로 돌아간다.',
    defaultAudience: 'chairman',
    from: 'intake · 0058',
  },
  {
    key: 'finance_docs',
    label: 'PDF · 사진 읽기',
    description: '자료 올리기에서 PDF · 사진(jpg · png)을 읽는 길. 엑셀은 그대로.',
    defaultAudience: 'chairman',
    from: 'C단계(마이그레이션 없음 — 0072 위)',
  },
  {
    key: 'monthly_pl',
    label: '월별 손익 재고 반영',
    description: '월별 간이 손익 화면(/finance/<회사>/monthly) 아래 «월별 손익 — 재고 반영»: 재고 반영 매출원가 · 원료별 월 가중평균 · 손익과 현금 분리 · 재고 조정 · 내부 마감 · 다시 열기. 꺼지면 화면이 예전 그대로.',
    defaultAudience: 'chairman',
    from: 'feat/monthly-pl · 0075',
  },
  {
    key: 'sales_margins',
    label: '판매 실적 · 마진 화면',
    description: '판매 실적(/sales/<회사>/deals — 영업 본인 · 팀의 판매가 · kg · 등급만)과 견적 마진 vs 실제 마진(/costs/<회사>/margins — 대표 · 원가 관리, 하루 20번 · 부를 때마다 기록). 꺼지면 두 화면이 사라지고 RPC(sales_deals · sales_margins)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/sales-margins · 0077',
  },
  {
    key: 'cost_candidates',
    label: '원가 후보 승인',
    description: '자료 올리기의 ② 입고 · ⑦ OFFER SHEET · ① 판매현황 줄을 원가 후보로 보여 주고 «LOT로 넣기 · 무시 · 나중에»(이유 필수 · 감사) — /costs/<회사>/candidates. 대표 · 원가 관리 쓰기만. 꺼지면 화면이 사라지고 RPC(cost_fin_candidates · cost_fin_candidate_decide)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/cost-candidates · 0078',
  },
  {
    key: 'ledger_post',
    label: '원장 → 장부 반영',
    description: '자료 올리기의 ⑤ 계정별 원장 줄을 «반영 대기 → 반영» 2단계로 장부 전표에 넣기(/finance/<회사>/ledger-post) · 같은 거래 묶음은 한 번만 · 마감 달은 대표 · CFO · 되돌리기는 무효 처리(역분개). 꺼지면 화면이 사라지고 RPC(ledger_post_*)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/ledger-post · 0079',
  },
  {
    key: 'chairman_dashboard',
    label: '대표 대시보드',
    description: '대표 홈의 손익 · 매출 · 현금 추이(월 · 분기 · 년, 월별 손익 값만 · 잠정/확정) · 14가지 자료 받은 것/없는 것 달력.',
    defaultAudience: 'chairman',
    from: 'feat/chair-dashboard',
  },
] as const satisfies readonly FeatureDef[]

export type FeatureKey = (typeof FEATURES)[number]['key']

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key)

export const isFeatureKey = (v: unknown): v is FeatureKey => typeof v === 'string' && (FEATURE_KEYS as readonly string[]).includes(v)

export const featureDef = (key: FeatureKey): FeatureDef => FEATURES.find((f) => f.key === key)!

/** DB 줄 한 개(0073 feature_switches). business_id null = 그룹 기본. */
export interface FeatureSwitchRow {
  business_id: string | null
  feature_key: string
  enabled: boolean
  audience: FeatureAudience
  reason: string
  updated_by: string | null
  updated_at: string
}

const EXEC_ROLES: readonly Role[] = ['Chairman', 'GroupCFO', 'BusinessCEO', 'Executive']

/** 0073 feature_audience_ok와 같은 규칙. 'all' = 역할이 있는 사람 전원. */
export function inAudience(role: Role | null | undefined, audience: FeatureAudience): boolean {
  if (!role) return false
  if (audience === 'all') return true
  if (audience === 'exec') return EXEC_ROLES.includes(role)
  return role === 'Chairman'
}

/** 이 기능의 지금 줄(회사 → 그룹). 없으면 null(→ 기본값). */
export function switchFor(rows: readonly FeatureSwitchRow[] | null, key: FeatureKey, businessId?: string | null): FeatureSwitchRow | null {
  if (!rows) return null
  return (
    (businessId ? rows.find((r) => r.feature_key === key && r.business_id === businessId) : undefined) ??
    rows.find((r) => r.feature_key === key && r.business_id === null) ??
    null
  )
}

/**
 * 판정(순수). rows가 null이면(0073 전 DB — 표 없음) 기본값. 그 밖 읽기 실패는 features-server가 closedFeatureRows(전부 꺼짐)를 넘긴다 — 켜짐 + 기본 범위.
 * 0073이 있는데 그룹 줄이 없는 키는 0073 feature_on처럼 꺼짐이 아니라 기본값으로 둔다 — 앱이 DB보다 먼저 나가도 화면이 사라지지 않게.
 */
export function featureOnFor(rows: readonly FeatureSwitchRow[] | null, key: FeatureKey, role: Role | null | undefined, businessId?: string | null): boolean {
  const row = switchFor(rows, key, businessId)
  if (!row) return inAudience(role, featureDef(key).defaultAudience)
  return row.enabled && inAudience(role, row.audience)
}

/** dummy 모드 · 시험용 기본 줄 — 0073 3절과 같다. */
export function defaultFeatureRows(): FeatureSwitchRow[] {
  return FEATURES.map((f) => ({
    business_id: null,
    feature_key: f.key,
    enabled: true,
    audience: f.defaultAudience,
    reason: '기본값(0073)',
    updated_by: null,
    updated_at: '2026-10-12T00:00:00.000Z',
  }))
}

/** 스위치를 못 읽었을 때(표는 있는데 오류) — 모든 기능 꺼짐(features-server.ts · 0073 리뷰 I4). */
export function closedFeatureRows(): FeatureSwitchRow[] {
  return defaultFeatureRows().map((r) => ({ ...r, enabled: false, reason: '스위치를 못 읽음 — 꺼짐' }))
}

/** 기능 → 그 기능이 세우는 메뉴 키(lib/nav.ts). 꺼진 기능의 메뉴는 navFor가 뺀다. */
export const FEATURE_NAV: Partial<Record<FeatureKey, string>> = {
  process_charts: 'nav_process_charts',
}

/** 이 사람에게 숨길 메뉴 키 — 그룹 줄 기준(메뉴는 회사를 모른다). */
export function hiddenNavKeys(rows: readonly FeatureSwitchRow[] | null, role: Role | null | undefined): string[] {
  return (Object.entries(FEATURE_NAV) as [FeatureKey, string][]).filter(([key]) => !featureOnFor(rows, key, role)).map(([, nav]) => nav)
}

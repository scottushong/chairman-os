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
    description: '재무 현황 «손익계산서» 탭(/finance?tab=pl) 아래 «내부 마감 · 재고 조정 · 설정»: 재고 반영 손익의 잠정 저장 · 내부 마감 확정 · 다시 열기 · 재고 조정 제안 · 승인 · 평가방법 · 허용오차(2026-10-20 — 예전 /finance/<회사>/monthly 화면 아래에서 옮김). 꺼지면 그 칸이 사라지고 RPC(fin_pl_*)도 거부.',
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
  {
    key: 'cost_forecast',
    label: 'Forecast 원가',
    description: '원료 다음 달 시장 전망 넣기와 제품별 Forecast 원료비 · 총원가(최근 구매가 × 오늘 환율과 시장 전망을 섞음). 월별 손익에는 들어가지 않는다. 꺼지면 RPC(cost_outlook_* · cost_forecast_*)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/blueprint-skeleton · 0081',
  },
  {
    key: 'purchase_performance',
    label: '구매 성과',
    description: 'LOT · 원료 · 공급처 · 월별 구매가 vs 그날 시장가 · 절감액 · 환율 효과. 월별 손익에 구매이익을 따로 더하지 않는다. 꺼지면 RPC(purchase_performance)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/blueprint-skeleton · 0081',
  },
  {
    key: 'customer_profit',
    label: '고객별 수익성',
    description: '고객별 매출 · 매출원가 · GM · 등급(판매 한 줄 실제 원가)과 «매출 큰데 마진 낮은» 고객 · 제품. 영업은 본인 판매의 매출 · 등급만. 꺼지면 RPC(customer_profit · customer_profit_watch)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/blueprint-skeleton · 0081',
  },
  {
    key: 'margin_bridge',
    label: '마진 변동 분해',
    description: '두 기간 GM 원/kg 변화를 판매가 · 원료 · 제조 · 물류 · 기타 효과로 나눈다(합 = 전체). 꺼지면 RPC(margin_bridge)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/blueprint-skeleton · 0081',
  },
  {
    key: 'competitor_price',
    label: '경쟁사 가정',
    description: '경쟁사 제조 · 물류 · 마진 가정과 경쟁사 예상 최소가 · 우리 목표가 · 그 가격에서의 우리 마진. 영업은 결과만. 꺼지면 RPC(competitor_*)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/blueprint-skeleton · 0081',
  },
  {
    key: 'work_orders',
    label: '작업지시',
    description: '오더별 탱크 · 순서 · 담당 · 원료 이름 가림. 생산 직원은 본인 담당 오더만(원료 코드 · 배치 kg · 투입). 꺼지면 RPC(work_order_*)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/blueprint-skeleton · 0081',
  },
  {
    key: 'product_diagnosis',
    label: '제품 진단',
    description: '제품 한 장의 진단 카드(Actual · 총원가 · 경쟁사 · 최소 판매가 · 상위 고객 · 마진 하락 이유 등 — 역할별)와 기간별 추이. 꺼지면 RPC(product_diagnosis · product_trend)도 거부.',
    defaultAudience: 'chairman',
    from: 'feat/blueprint-skeleton · 0081',
  },
  {
    key: 'purchase_price_report',
    label: '가격 리포트(구매)',
    description: '구매 메뉴의 «가격 리포트»(/purchasing/<회사>/price-report — 오피넷 정산가 · 나프타 · 장중가 · 사건 메모 · 크랙, 하루 2번 자동 + «지금 업데이트») · 구매 개요 요약 카드 · 시장가 화면 참고 한 줄. 범위 «전원»이어도 DB가 구매 줄 · 대표 · 임원 이상으로 거른다. 꺼지면 화면이 사라지고 버튼 RPC도 거부.',
    defaultAudience: 'all',
    from: 'feat/purchase-price-report · 0084',
  },
  {
    key: 'finance_overview',
    label: '재무 현황(한 화면)',
    description: '«회계 · 재무»(/finance) 첫 화면 — 요약 · 일별 자금보고 · 현금흐름 달력 · 손익계산서 · 12가지 지표, 자료 올리기의 «놓으면 저장»(미리보기 없음 · 같은 달은 바꾸기 · 경고 꼬리표) · 다시 계산 큐. 꺼지면 /finance가 예전 «그룹 재무»로 돌아간다(저장 방식은 그대로).',
    defaultAudience: 'all',
    from: 'feat/finance-overview · 0085',
  },
  {
    key: 'finance_upload_ai',
    label: '엑셀 열 맞추기 AI',
    description: '자료 올리기에서 ECOUNT 엑셀의 열 이름이 우리 낱말 · 비슷한 이름 표로 맞지 않을 때만 AI를 한 번 부른다(기존 파일당 · 하루 한도 안). 맞춘 결과는 회사 · 종류마다 저장해 다음부터 AI 없이 읽는다. 꺼지면 비슷한 이름 · 저장된 맞춤 · «이 열은 무엇입니까?»로만(PDF · 사진은 «PDF · 사진 읽기» 스위치가 따로).',
    defaultAudience: 'all',
    from: 'release/2026-10-20 · 0089',
  },
  {
    key: 'finance_legacy_import',
    label: '예전 자료 가져오기',
    description: '자료 올리기(/finance/<회사>/upload)의 «예전 자료 가져오기» 단추 — 예전 방식(0082 수신함에 남은 파일 · «확인 필요» 대기 · 공식 결산 증빙 PDF · 월별 입력)을 지금 저장 방식으로 한 번에 옮긴다(AI 없음 · 두 번 눌러도 다시 넣지 않음). 범위와 관계없이 대표만 누른다(서버 · DB가 대표만 받는다). 꺼지면 단추가 사라지고 수신함 정리는 예전대로.',
    defaultAudience: 'chairman',
    from: 'release/2026-10-20 · 0089',
  },
  {
    key: 'approvals',
    label: '전자결재',
    description: '«전자결재»(/e-approval) — 결재할 문서 · 결재 예정 · 내가 올린 문서 · 임시저장 · 내 처리 이력 · 참조 · 공유 · 후속 처리, 양식 여섯 · 합의 · 대결 · 회수 · 재상신. 꺼지면 메뉴 · 화면이 사라지고 RPC(ea_*)도 거부. 예전 «결재»(/approvals · 결재 대장)는 그대로.',
    defaultAudience: 'chairman',
    from: 'feat/approvals-0087 · 0087',
  },
  {
    key: 'home_widgets',
    label: '내 홈(위젯)',
    description: '«내 홈»(/home) — 직원마다 위젯(내 업무 · 전자결재 · 일정 · 요청한 업무 · 공지 · 최근 문서 · 즐겨찾기 등)의 종류 · 순서 · 크기 · 표시 범위를 고르고 서버에 저장(본인만 · 다른 탭 덮어쓰기 막음). 위젯 내용은 각 기능의 기존 권한 그대로. 꺼지면 메뉴 · 화면이 사라지고 저장 RPC(home_layout_save)도 거부. 예전 직원 홈(/me)은 그대로.',
    defaultAudience: 'chairman',
    from: 'release/2026-10-20 · 0086',
  },
  {
    key: 'memory_engine',
    label: '기억 엔진',
    description: '모든 화면의 «빠른 기록» 단추 · /memory(기록 · 검색 · 약속 · 검토함) · 회사/프로젝트 화면의 «관련 기억» · 주의 화면 «기억에서 나온 주의» · 어시스턴트 «기억 검색» 도구. 기록은 쓴 사람 본인만 본다(직원용을 열어도 개인 기록은 공유되지 않음). 꺼지면 화면 · 단추 · 도구가 사라지고 표 · RPC도 0행 · 거부.',
    defaultAudience: 'chairman',
    from: 'feat/memory-engine · 0088',
  },
  {
    key: 'owner_inputs',
    label: '받을 것',
    description: '설정(/settings)의 «받을 것» 카드 넷 — 진짜 BOM(R2 엑셀 · 기존 BOM 넣기 화면으로) · 세무사 재고평가방법(총평균 · 이동평균 · 선입선출 + 메모 — 월별 손익 설정과 다르면 경고) · 구글 서비스 계정(JSON → Vault, 화면에는 이메일 · 프로젝트만) · 원가 관리 권한자(원가 권한을 준다). 범위와 관계없이 대표만(서버 · DB가 대표만 받는다). 꺼지면 카드가 사라지고 RPC(owner_input_*)도 거부.',
    defaultAudience: 'chairman',
    from: 'release/2026-10-20 · 0089',
  },
  {
    key: 'finance_auto',
    label: '재무 자동 판단',
    description: '재무 현황(/finance)이 자료를 보고 스스로 정한다 — 재공품 · 완제품 평가(파일 → 제조지시 · 출하로 추정 → 앞 달 이월), 귀속월(«N월분» · 기간 · 연납 N등분), 중복(같은 금액 · ±3일 · 같은 거래처면 법인카드 쪽 제외), 원금/이자 출처(대출현황 열 → 원장 이자비용). 위에 «자동으로 정한 것 N건 ›» 한 줄, 틀리면 그 목록에서 고친다(원장 원본은 그대로). 꺼지면 0089까지의 계산 그대로.',
    defaultAudience: 'all',
    from: 'feat/finance-auto-0091 · 0091',
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

/** 판정과 그 근거 — 어느 줄(회사 → 그룹 → 기본값)이 정했고, 켜짐 · 범위가 무엇인가(화면 안내용 · 판정은 featureOnFor와 같다). */
export interface FeatureWhy {
  on: boolean
  where: 'company' | 'group' | 'default'
  enabled: boolean
  audience: FeatureAudience
}

export const FEATURE_WHERE_LABEL: Record<FeatureWhy['where'], string> = { company: '이 회사 줄', group: '그룹 기본 줄', default: '기본값' }

export function featureWhyFor(rows: readonly FeatureSwitchRow[] | null, key: FeatureKey, role: Role | null | undefined, businessId?: string | null): FeatureWhy {
  const row = switchFor(rows, key, businessId)
  if (!row) return { on: inAudience(role, featureDef(key).defaultAudience), where: 'default', enabled: true, audience: featureDef(key).defaultAudience }
  return { on: row.enabled && inAudience(role, row.audience), where: row.business_id ? 'company' : 'group', enabled: row.enabled, audience: row.audience }
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
  approvals: 'nav_eapproval',
  home_widgets: 'nav_home',
  memory_engine: 'nav_memory',
}

/**
 * 이 사람에게 숨길 메뉴 키 — 그룹 줄 기준. businessIds를 주면 그 회사들 중 하나라도 켜져 있으면 보인다
 * (0087 전자결재: «대표가 회사 줄에서 켜면 그 회사 전원» — 그룹 줄은 대표만이어도 그 회사 직원에게 메뉴가 선다).
 */
export function hiddenNavKeys(rows: readonly FeatureSwitchRow[] | null, role: Role | null | undefined, businessIds: readonly string[] = []): string[] {
  return (Object.entries(FEATURE_NAV) as [FeatureKey, string][])
    .filter(([key]) => !featureOnFor(rows, key, role) && !businessIds.some((b) => featureOnFor(rows, key, role, b)))
    .map(([, nav]) => nav)
}

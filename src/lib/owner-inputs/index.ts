/**
 * «받을 것»(0089 5절 owner_inputs) — 순수 조각(서버 · DB를 모른다). 결정: docs/decisions/2026-10-20-intake-items.md
 *
 * 사람이 줘야 하는 것 넷의 받는 자리. 이 파일은 목록 · 낱말 · 모양 검사만 둔다.
 *   real_bom         진짜 BOM(R2 엑셀) — 받는 길은 기존 BOM 넣기(/costs/<회사>/bom/import · 0068 · 0063 암호문 · AI 없음). 여기는 «받음»만.
 *   inventory_method 세무사 재고평가방법(총평균 · 이동평균 · 선입선출 + 메모) — 0075 월별 손익 설정과 나란히 두는 «세무사 확인값».
 *   google_sa        구글 서비스 계정 JSON — Vault 'google_sheets_sa'에만. 화면 · 응답 · 오류에는 이메일 · 프로젝트 id만.
 *   cost_manager     원가 관리 권한자 — 기존 원가 권한('/costing/<회사>' 쓰기 · 0061 회사마다 셋까지)을 주고 «받음»을 적는다.
 *
 * **AI 금지** — 이 폴더 · 액션 · 카드는 어떤 AI 함수도 부르지 않는다(check:intake-items가 import를 잰다).
 */

export const OWNER_INPUT_KEYS = ['real_bom', 'inventory_method', 'google_sa', 'cost_manager'] as const
export type OwnerInputKey = (typeof OWNER_INPUT_KEYS)[number]

export const OWNER_INPUT_LABEL: Record<OwnerInputKey, string> = {
  real_bom: '진짜 BOM (R2)',
  inventory_method: '세무사 재고평가방법',
  google_sa: '구글 서비스 계정',
  cost_manager: '원가 관리 권한자',
}

export const INVENTORY_METHODS = ['total_avg', 'moving_avg', 'fifo'] as const
export type InventoryMethod = (typeof INVENTORY_METHODS)[number]

export const INVENTORY_METHOD_LABEL: Record<InventoryMethod, string> = {
  total_avg: '총평균법',
  moving_avg: '이동평균법',
  fifo: '선입선출법',
}

export const isInventoryMethod = (v: unknown): v is InventoryMethod => typeof v === 'string' && (INVENTORY_METHODS as readonly string[]).includes(v)

/** owner_inputs 한 줄. summary는 항목마다 모양이 다르다(0089 5절 머리). 키 · 파일 본문은 없다. */
export interface OwnerInputRow {
  item_key: OwnerInputKey
  /** 'group' 또는 회사 id. */
  scope: string
  summary: Record<string, unknown>
  received_by: string | null
  received_at: string
}

/** 메모 최대 길이(0089 owner_input_mark와 같다). */
export const MEMO_MAX = 500
/** 서비스 계정 JSON 파일 크기 천장(바이트) — 구글 키 파일은 2~3KB다. */
export const SA_MAX_BYTES = 20_000

/** 0089 owner_input_google_sa_save와 같은 모양 검사. 실패 낱말만 돌려준다 — 본문 조각을 싣지 않는다. */
export type SaShapeError = 'sa_json' | 'sa_type' | 'sa_key' | 'sa_email' | 'sa_project' | 'sa_size'

export interface SaSummary {
  client_email: string
  project_id: string
}

const SA_EMAIL = /^[a-z0-9._-]{1,100}@[a-z0-9.-]{1,100}\.gserviceaccount\.com$/
const SA_PROJECT = /^[a-z0-9-]{1,64}$/

export function checkServiceAccount(text: string): { ok: true; summary: SaSummary } | { ok: false; error: SaShapeError } {
  if (text.length < 50 || text.length > SA_MAX_BYTES) return { ok: false, error: 'sa_size' }
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return { ok: false, error: 'sa_json' }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'sa_json' }
  const o = v as Record<string, unknown>
  if (o.type !== 'service_account') return { ok: false, error: 'sa_type' }
  if (typeof o.private_key !== 'string' || o.private_key.length < 20) return { ok: false, error: 'sa_key' }
  if (typeof o.client_email !== 'string' || !SA_EMAIL.test(o.client_email)) return { ok: false, error: 'sa_email' }
  if (typeof o.project_id !== 'string' || !SA_PROJECT.test(o.project_id)) return { ok: false, error: 'sa_project' }
  return { ok: true, summary: { client_email: o.client_email, project_id: o.project_id } }
}

/** 화면 문장 — 실패 낱말(앱 · DB) → 사람 말. 본문 · DB 원문을 싣지 않는다. */
export const OWNER_INPUT_ERROR: Record<string, string> = {
  owner_input_denied: '대표만 할 수 있습니다.',
  owner_input_shape: '값의 모양이 맞지 않습니다.',
  owner_input_no_grant: '원가 권한을 먼저 주지 못했습니다 — 다시 시도하세요.',
  owner_input_vault_missing: '비밀 저장소(Vault)에 넣지 못했습니다 — Supabase Vault가 켜져 있는지 확인하세요.',
  owner_input_unavailable: '«받을 것» 저장소가 아직 없습니다(DB 0089 전).',
  owner_input_sa_shape: '서비스 계정 키 파일(JSON)의 모양이 아닙니다.',
  sa_size: '서비스 계정 키 파일(JSON) 하나를 고르세요(20KB까지).',
  sa_json: 'JSON 파일이 아닙니다 — 구글 클라우드에서 내려받은 키 파일 그대로 올리세요.',
  sa_type: '서비스 계정 키가 아닙니다(type이 service_account가 아님).',
  sa_key: '키 파일에 private_key가 없습니다.',
  sa_email: '서비스 계정 이메일(…gserviceaccount.com)이 없습니다.',
  sa_project: '프로젝트 id(project_id)가 없습니다.',
  cost_costing_cap: '이 회사의 원가 관리 권한자는 셋까지입니다 — 한 사람을 먼저 빼세요(/settings/users).',
}

export function ownerInputMessage(e: unknown, fallback = '저장하지 못했습니다. 잠시 후 다시 시도하세요.'): string {
  const m = e instanceof Error ? e.message : String(e ?? '')
  const word = /owner_input_[a-z_]+|cost_costing_cap|sa_[a-z]+/.exec(m)?.[0]
  return (word && OWNER_INPUT_ERROR[word]) || fallback
}

/** 오류 → 로그에 남길 낱말 하나(본문 · DB 원문 없음). */
export function ownerInputLogWord(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '')
  return /owner_input_[a-z_]+|cost_costing_cap|sa_[a-z]+/.exec(m)?.[0] ?? 'failed'
}

/**
 * 세무사 방법 vs 0075 월별 손익 설정(method). 'statement'(재고금액명세서 금액 그대로)는 세무사가 고른 방법의 결과를 그대로 쓰므로 같다로 본다.
 * 'monthly_wa'(원료별 월 가중평균)는 총평균과 같은 계열(월 총평균) — 이동평균 · 선입선출이면 다르다(경고).
 */
export function methodAgreement(tax: InventoryMethod, pl: string | null | undefined): 'same' | 'differs' | 'unknown' {
  if (pl === 'statement') return 'same'
  if (pl === 'monthly_wa') return tax === 'total_avg' ? 'same' : 'differs'
  return 'unknown'
}

export const PL_METHOD_LABEL: Record<string, string> = {
  monthly_wa: '원료별 월 가중평균(관리용 잠정)',
  statement: '재고금액명세서 금액 그대로',
}

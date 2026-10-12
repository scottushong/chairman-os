import type { FinInventoryRollRow, ValueState } from '@/types'

/**
 * 0072 화면 · 액션 공통 문구(서버 · 브라우저 양쪽에서 읽는다 — node 모듈을 들이지 않는다).
 * 직원 화면에도 선다: «회장»이 아니라 «대표»로 쓴다.
 */

/** 값 상태 표기 — «확인된 0 / 값 있음 / 미입력». */
export const STATE_KO: Record<ValueState, string> = { confirmed_zero: '확인된 0', value: '값 있음', missing: '미입력' }

/** 입력 칸 글 → 금액 · 상태. 빈칸 → 미입력(null) · 0 → 확인된 0 · 그 밖 숫자 → 값. 숫자가 아니면 'bad'. 빈칸을 0으로 만들지 않는다. */
export function parseValue(v: unknown): { amount: number | null; state: ValueState } | 'bad' {
  const t = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.replace(/[,\s원₩]/g, '') : ''
  if (t === '') return { amount: null, state: 'missing' }
  const n = Number(t)
  if (!Number.isFinite(n)) return 'bad'
  return { amount: n, state: n === 0 ? 'confirmed_zero' : 'value' }
}

export const won = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`)

export const CATEGORY_KO: Record<string, string> = { raw: '원재료', wip: '재공품', finished: '완제품' }
export const SCOPE_KO: Record<string, string> = { material_only: '재료비만', material_labor_overhead: '재료비 + 노무비 + 경비' }
export const STATUS_KO: Record<string, string> = { entering: '입력 중', provisional: '잠정', final: '확정' }
export const OPENING_SOURCE_KO: Record<FinInventoryRollRow['opening_source'], string> = {
  prev_close: '전월 확정 기말',
  manual: '직접 입력',
  statement: '재고금액명세서',
  unlinked: '미연결',
}
export const ISSUE_CHOICE_KO: Record<string, string> = {
  production: '생산 투입',
  sample: '비생산 · 샘플',
  scrap: '비생산 · 폐기',
  return: '비생산 · 반품',
  transfer: '비생산 · 이동',
  adjust: '비생산 · 조정',
}
export const WITHHELD_KO: Record<string, string> = {
  needs_review_open: '«확인 필요» 줄이 남아 있어 합계를 보이지 않습니다 — 줄 하나를 정할 때마다 합계가 그 줄만큼 움직여 원료 하나의 양이 드러나기 때문입니다. 아래에서 모두 정하면 보입니다.',
  too_few_materials: '생산 투입 원료가 세 가지보다 적어 합계를 보이지 않습니다 — 합계에서 원료 하나의 양이 바로 나오기 때문입니다.',
}
export const RECLOSE_CAUSE_KO: Record<string, string> = { upload: '자료 넣기 · 결정', revert: '되돌리기', valuation: '평가금액', opening: '기초재고' }

const ERR: Record<string, string> = {
  fin_valuation_self_confirm: '입력한 사람은 확정할 수 없습니다 — 다른 장부 담당이 확정합니다.',
  fin_valuation_missing: '«미입력» 평가금액은 확정할 수 없습니다 — 금액(또는 확인된 0)을 먼저 저장하세요.',
  fin_valuation_reason: '이유를 2자 이상 적어 주세요(확정된 값을 바꾸거나 무효로 할 때 필수).',
  fin_valuation_status: '상태를 확인하세요(입력 중 · 잠정).',
  fin_valuation_final_exists: '그 구분의 확정된 평가금액이 이미 있습니다 — 이유를 적고 바꾸세요.',
  fin_opening_reason: '출처와 이유(2자 이상)를 적어 주세요.',
  fin_issue_reason: '이유를 2자 이상 적어 주세요.',
  fin_issue_class: '구분을 확인하세요.',
  fin_tx_reason: '이유를 2자 이상 적어 주세요.',
  fin_tx_status: '결정을 확인하세요.',
  fin_tx_member_taken: '이미 다른 묶음에 든 줄입니다.',
  fin_value_state: '빈칸 · 0 표시가 금액과 맞지 않습니다(빈칸은 0이 아닙니다).',
  fin_upload_closed: '마감된 달입니다 — 대표 · CFO가 이유를 적어야 합니다.',
  fin_replace_restricted: '원료 출고 · 재고 자료의 «바꾸기»는 대표 · CFO만 합니다.',
  fin_upload_denied: '이 회사의 재무를 넣을 권한이 없습니다.',
  fin_upload_period: '월(YYYY-MM)을 확인하세요.',
  fin_upload_unavailable: '아직 준비 중입니다(0072 반영 전).',
}

export function finV21Error(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const k = Object.keys(ERR).find((x) => m.includes(x))
  if (k) return ERR[k]
  console.error('[finance-v21]', m)
  return '처리하지 못했습니다.'
}

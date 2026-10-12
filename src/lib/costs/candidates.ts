import type { CandidateKind } from '@/types'

import { costEngineError } from './errors'

/** 0078 후보 종류 → 화면 말. 출처는 «자료 올리기». */
export const CANDIDATE_KIND_KO: Record<CandidateKind, string> = {
  purchase_lot: '② 입고 → 구매 LOT',
  landed: '⑦ OFFER SHEET → Landed 부대비',
  sale: '① 판매현황 → 판매 실적',
}

/** 0078 거부 → 사람의 말. 나머지는 원가 엔진 말(costEngineError). */
export function candidateError(e: unknown, chairman = false): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/feature_off/.test(m)) return '지금은 쓸 수 없는 기능입니다.'
  if (/cost_candidates_unavailable/.test(m)) return '원가 후보 승인은 준비 중입니다.'
  if (/cost_candidate_reason/.test(m)) return '이유를 적어 주세요(300자 안).'
  if (/cost_candidate_done/.test(m)) return '이미 넣었거나 무시한 후보입니다.'
  if (/cost_candidate_invalid/.test(m)) return '칸을 확인하세요 — 입고는 원료 · 공급처, OFFER는 부대비를 더할 LOT, 판매는 제품이 필요합니다(수량 · 금액이 0보다 커야 합니다).'
  if (/sale_not_found/.test(m)) return '판매 실적을 넣으려면 영업 입력 권한도 필요합니다.'
  if (/sale_invalid/.test(m)) return '판매 칸이 규칙에 맞지 않습니다 — 출고일(오늘 이전 400일 안) · 거래처를 확인하세요.'
  return costEngineError(e, chairman, '결정을 저장하지 못했습니다.')
}

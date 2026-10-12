import type { MonthlyPlView, PlAdjustmentKind } from '@/types'

/**
 * 0075 월별 손익 화면 · 액션의 문장. 직원 화면에도 선다 — «회장»이 아니라 «대표». «ECOUNT 올리기»라는 말은 쓰지 않는다.
 */

export const VIEW_STATUS_KO: Record<MonthlyPlView['view_status'], string> = {
  entering: '입력 중',
  provisional: '잠정',
  final: '내부 마감 확정',
}

export const ADJ_KIND_KO: Record<PlAdjustmentKind, string> = {
  shrinkage: '재고 감모',
  scrap: '폐기',
  valuation_loss: '평가손실',
  other: '기타 재고 조정',
}

export const ADJ_STATUS_KO: Record<'proposed' | 'approved' | 'voided', string> = { proposed: '승인 전', approved: '승인됨', voided: '무효' }

export const REVENUE_SOURCE_KO: Record<'books' | 'sales_upload', string> = { books: '장부(전표 · 결산)', sales_upload: '올린 판매현황' }

/** 원. null은 «미입력»(0이 아니다). */
export function wonOrMissing(n: number | null | undefined): string {
  return n === null || n === undefined ? '미입력' : `${n.toLocaleString('ko-KR')}원`
}

const ERR: Record<string, string> = {
  feature_off: '지금은 쓸 수 없는 기능입니다.',
  fin_pl_denied: '이 일을 할 권한이 없습니다.',
  fin_pl_final: '내부 마감 확정된 달입니다 — 대표 · 그룹 CFO가 «다시 열기»를 한 뒤에 바꿀 수 있습니다.',
  fin_pl_not_final: '내부 마감 확정된 달이 아닙니다.',
  fin_pl_entering: '아직 입력 중입니다 — 영업이익까지 계산할 자료가 모자랍니다(아래 «막는 까닭»).',
  fin_pl_blocked: '마감 조건을 지나지 못했습니다 — 아래 «막는 까닭»을 먼저 해결하세요. 잠정으로 남습니다.',
  fin_pl_reason: '이유를 2자 이상 적어 주세요.',
  fin_pl_self_approve: '제안한 사람은 승인할 수 없습니다 — 다른 마감 권한자가 승인합니다.',
  fin_pl_adjust_value: '조정 종류와 금액(원 단위, 0이 아님)을 확인하세요.',
  fin_pl_setting_value: '설정 값을 확인하세요(허용오차는 0 이상의 원 단위, 항목 규칙은 1~20개).',
  fin_pl_period: '달을 YYYY-MM으로 고르세요.',
  fin_pl_unavailable: '이 기능의 DB가 아직 준비되지 않았습니다(0075 반영 전).',
}

export function plError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const k = Object.keys(ERR).find((x) => m.includes(x))
  if (k) return ERR[k]
  console.error('[monthly-pl]', m)
  return '처리하지 못했습니다.'
}

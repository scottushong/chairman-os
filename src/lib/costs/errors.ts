/**
 * 원가 엔진 생산 · 원가 관리 · 대표 BOM 화면의 DB 거부 → 사람의 말(0063 · 0064 · 0065 이유 코드). 호칭은 «대표»(직원 화면).
 * chairman = 대표 화면인가 — BOM 키 없음은 대표에게만 문서 경로까지 알려 주고, 직원에게는 «대표에게 문의»로만.
 */
export function costEngineError(e: unknown, chairman = false, fallback = '저장하지 못했습니다. 잠시 후 다시 시도하세요.'): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (/cost_bom_key_missing/.test(m)) {
    return chairman
      ? 'BOM 암호 키가 없습니다 — docs/onboarding/bom-key-setup.md 순서로 키를 먼저 만드세요'
      : '지금은 원가를 계산할 수 없습니다 — 대표에게 문의하세요.'
  }
  if (/cost_bom_unreadable/.test(m)) {
    return chairman ? 'BOM을 읽을 수 없습니다 — 키가 바뀌었거나 저장된 값이 깨졌습니다' : '지금은 원가를 계산할 수 없습니다 — 대표에게 문의하세요.'
  }
  if (/cost_bom_real_locked/.test(m)) return '«진짜 BOM 받기»가 꺼져 있습니다 — 가짜 판으로만 저장할 수 있습니다.'
  if (/cost_bom_invalid/.test(m)) return 'BOM 칸을 확인하세요 — 시작일 · 수율(0 초과 100 이하) · 원료 1~200줄(중복 없음) · kg/kg(0 초과 100 이하, 소수 8자리까지).'
  if (/cost_bom_missing/.test(m)) return '그 날짜에 쓰는 BOM 판이 없습니다 — BOM을 먼저 넣으세요.'
  if (/cost_lot_short/.test(m)) return 'LOT 잔량보다 많습니다.'
  if (/cost_lot_in_use/.test(m)) return '이 LOT를 쓴 투입 · 조정을 먼저 무효로 하세요.'
  if (/cost_order_closed/.test(m)) return '열려 있는 작업지시가 아닙니다 — 이미 완료 · 취소된 오더입니다.'
  if (/cost_order_invalid/.test(m)) return '계획일과 계획 kg(0보다 크게)을 적으세요.'
  if (/cost_lot_invalid/.test(m)) return '구매 LOT를 다시 고르세요 — 이 회사의 살아 있는 LOT가 아니거나 입고일보다 앞선 날짜입니다.'
  if (/cost_prod_lot_invalid/.test(m)) return '생산 LOT를 다시 고르세요 — 무효가 아닌 이 회사의 생산 LOT이고, 생산일이 구매 LOT 입고일 이후여야 합니다.'
  if (/cost_date_future/.test(m)) return '내일보다 먼 날짜는 넣을 수 없습니다.'
  if (/cost_alloc_invalid/.test(m)) return '배부 기준을 확인하세요 — 기간 7~365일, 계획 기준이면 월 계획 생산량(kg)이 필요합니다.'
  if (/cost_void_reason/.test(m)) return '무효 이유를 적으세요.'
  if (/cost_already_voided/.test(m)) return '이미 무효로 한 줄입니다.'
  if (/cost_role_conflict/.test(m)) return '구매 입력 권한과 원가 관리는 같이 볼 수 없습니다 — 대표에게 권한 정리를 요청하세요.'
  if (/cost_rate_limited/.test(m)) return '오늘 조회 한도에 걸렸습니다 — 대표에게 문의하세요.'
  if (/cost_not_found|P0002/.test(m)) return '찾을 수 없거나 권한이 없습니다.'
  if (/row-level security|42501|permission denied/.test(m)) return '권한이 없습니다. (입력 권한이 있는 사람만 넣고 고칠 수 있습니다)'
  if (/23503|foreign key/.test(m)) return '고른 항목이 이 회사의 것이 아닙니다 — 다시 고르세요.'
  if (/23514|check constraint/.test(m)) return '입력값이 규칙에 맞지 않습니다. 칸을 다시 확인하세요.'
  return fallback
}

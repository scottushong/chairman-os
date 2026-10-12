/** 0079 거부 → 사람의 말(직원 화면 — «대표»). */
export function ledgerPostError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/feature_off/.test(m)) return '지금은 쓸 수 없는 기능입니다.'
  if (/ledger_post_unavailable/.test(m)) return '원장 → 장부 반영은 준비 중입니다.'
  if (/ledger_forbidden/.test(m)) return '이 회사의 장부를 쓸 권한이 없습니다.'
  if (/ledger_dedupe_suspect/.test(m)) return '중복 의심 묶음에 든 줄입니다 — 자료 올리기의 «같은 거래»에서 먼저 정하세요.'
  if (/ledger_already_staged/.test(m)) return '이미 반영 대기 · 반영된 줄이 있습니다.'
  if (/ledger_books_has_ecount/.test(m)) return '이 달 장부에는 ECOUNT 전표가 이미 있습니다 — 두 번 들어가지 않게 막았습니다.'
  if (/ledger_unbalanced/.test(m)) return '차변과 대변이 맞지 않습니다 — 상대 계정을 적으세요.'
  if (/ledger_closed_month/.test(m)) return '마감된 달입니다 — 대표 · 그룹 CFO만, 이유를 적어야 합니다.'
  if (/closed_period/.test(m)) return '마감된 달의 날짜로는 넣을 수 없습니다 — 전표 날짜를 열린 달(당월)로 고르세요.'
  if (/inactive_account/.test(m)) return '장부에 없거나 쓰지 않는 계정입니다 — 계정과목을 먼저 확인하세요.'
  if (/ledger_one_period/.test(m)) return '한 번에 한 달의 줄만 고르세요.'
  if (/ledger_line_shape/.test(m)) return '계정이 없거나 차변 · 대변이 둘 다 있는(또는 0인) 줄입니다.'
  if (/ledger_source_changed/.test(m)) return '대기 뒤 원장 줄이 되돌려졌습니다 — 무효 처리 후 다시 고르세요.'
  if (/ledger_not_pending/.test(m)) return '반영 대기 상태가 아닙니다.'
  if (/ledger_void_reason/.test(m)) return '무효 이유를 적으세요.'
  if (/ledger_not_found|ledger_invalid/.test(m)) return '줄을 찾을 수 없습니다 — 다시 고르세요.'
  if (/already_corrected/.test(m)) return '이미 무효 처리(역분개)된 전표입니다.'
  return '처리하지 못했습니다. 잠시 후 다시 시도하세요.'
}

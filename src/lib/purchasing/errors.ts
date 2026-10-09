/**
 * 구매 화면의 DB 거부 → 사람의 말. 0061이 던지는 이유 코드(raise exception '<code>')와 제약 이름을 본다.
 * 화면에 «회장»을 쓰지 않는다 — 여기 문구에는 호칭이 없다.
 */
export function purchasingError(e: unknown, fallback = '저장하지 못했습니다. 잠시 후 다시 시도하세요.'): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (/cost_not_found|P0002/.test(m)) return '찾을 수 없거나 권한이 없습니다.'
  // 0061 수정(98ace1d) — 대표가 아닌 사람의 시장가 · LOT landed가 그 원료 90일 중앙값의 0.2배~5배 밖. 대표에게는 오지 않는 오류라 호칭은 «대표».
  if (/cost_price_outlier/.test(m)) return '최근 90일 값과 너무 다릅니다(5배 초과 · 1/5 미만) — 숫자를 확인하세요. 진짜 급등락이면 대표에게 올려 주세요.'
  if (/cost_date_future/.test(m)) return '내일보다 먼 날짜는 넣을 수 없습니다.'
  if (/cost_price_too_many/.test(m)) return '같은 원료 같은 날 시세는 출처 셋까지입니다.'
  if (/cost_fx_missing/.test(m)) return '그 날짜의 환율이 없습니다 — 환율을 직접 넣으세요.'
  if (/cost_void_reason/.test(m)) return '무효 이유를 적으세요.'
  if (/cost_already_voided/.test(m)) return '이미 무효로 한 줄입니다.'
  if (/cost_lot_in_use/.test(m)) return '이 LOT를 쓴 투입 · 조정을 먼저 무효로 하세요.'
  if (/cost_candidate_invalid/.test(m)) return '승인된 구매 결재가 아닙니다 — 결재 후보에서 다시 고르세요.'
  if (/cost_purchase_lots_one_per_approval/.test(m)) return '이 결재는 이미 LOT로 들어갔습니다.'
  if (/cost_market_prices_one_a_day/.test(m)) return '같은 날 같은 출처의 시장가가 이미 있습니다 — 틀렸다면 그 줄을 무효로 하고 다시 넣으세요.'
  if (/cost_materials_business_id_name_norm_key/.test(m)) return '같은 이름의 원료가 이미 있습니다.'
  if (/cost_suppliers_business_id_name_norm_key/.test(m)) return '같은 이름의 공급처가 이미 있습니다.'
  if (/row-level security|42501|permission denied/.test(m)) return '권한이 없습니다. (구매 입력 권한이 있는 사람만 넣고 고칠 수 있습니다)'
  if (/23503|foreign key/.test(m)) return '원료 · 공급처를 다시 고르세요(이 회사의 것이 아닙니다).'
  if (/23514|check constraint/.test(m)) return '입력값이 규칙에 맞지 않습니다. 칸을 다시 확인하세요.'
  return fallback
}

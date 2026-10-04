/**
 * ECOUNT 엑셀 업로드 등록의 거부 낱말 → 화면 문장. **live(0051 RPC)와 dummy가 같은 낱말을 던진다** —
 * 그래야 dummy에서 본 거부 문장이 live에서도 같다(화면을 dummy로 검증하는 뜻).
 *
 * 낱말은 0051 finance_import_claim · ecount_accounts_import · official_statement_import_ecount의 message다.
 * 직원 화면이다 — «회장»이 아니라 «대표»(CLAUDE.md 직원 화면 용어 원칙).
 */

export const NO_BOOKS_MESSAGE =
  '이 회사의 재무를 넣을 권한이 없습니다. (대표 · 그룹 CFO · 해당 회사 대표이사 · 대표가 재무 입력 권한을 준 사람)'

/** 같은 해 결산을 다른 사람이 방금 등록했다(활성 unique 23505 · 이미 밀려난 행을 또 밀기). 0051 리뷰 m-3. */
export const SAME_YEAR_RACE_MESSAGE = '다른 사람이 같은 해 결산을 방금 등록했습니다. 새로 고친 뒤 다시 확인해 주세요.'

/** 순서가 뜻이다 — 앞의 낱말이 먼저 맞는다(not_owner도 42501이라 일반 권한 거부보다 앞에 둔다). */
export const ECOUNT_IMPORT_ERRORS: readonly (readonly [code: string, message: string])[] = [
  ['finance_import_not_owner', '올린 사람만 이 업로드를 이어 가거나 취소할 수 있습니다.'],
  ['finance_import_not_found', '업로드를 찾지 못했습니다.'],
  ['finance_import_closed', '이미 등록되었거나 취소된 업로드입니다. 다시 올리려면 새로 시작하세요.'],
  ['finance_import_hash_immutable', '미리보기 때와 다른 파일입니다. 취소하고 새로 올리세요.'],
  ['finance_import_hash_mismatch', '미리보기 때와 다른 파일입니다. 취소하고 새로 올리세요.'],
  ['finance_import_kind', '업로드 종류가 맞지 않습니다. 화면을 새로 고친 뒤 다시 하세요.'],
  ['finance_import_period', '몇 년도 자료인지 정하지 않았습니다. 열 지정에서 해를 고른 뒤 미리보기를 다시 하세요.'],
  ['import_changed', '미리보기 뒤에 업로드의 해가 바뀌었습니다. 미리보기를 다시 한 뒤 등록하세요.'],
  ['official_statements_one_active', SAME_YEAR_RACE_MESSAGE],
  ['official_statement_immutable', SAME_YEAR_RACE_MESSAGE],
  ['ecount_business_only', 'ECOUNT 업로드는 ECOUNT를 쓰는 회사만 합니다.'],
  ['ecount_plan_invalid', '등록할 내용을 읽지 못했습니다. 미리보기를 다시 한 뒤 등록하세요.'],
  ['account_exists', '그 사이에 같은 계정코드가 장부에 생겼습니다. 미리보기를 다시 하세요.'],
  ['account_changed', '그 사이에 계정 이름이 바뀌었거나 계정이 없어졌습니다. 미리보기를 다시 하세요.'],
  ['official_confirmed', '이 해는 세무사 확정 결산이 이미 있습니다 — ECOUNT 연간은 받지 않습니다.'],
  ['statement_unbalanced', '재무상태표가 닫히지 않습니다. 미리보기의 차액을 확인하세요.'],
  ['statement_unknown_account', '장부에 없는 계정이 있습니다. 계정과목을 먼저 올린 뒤 미리보기를 다시 하세요.'],
  ['statement_empty', '실을 금액 줄이 없습니다. 열 지정(과목명 · 금액)을 확인하세요.'],
  ['books_forbidden', NO_BOOKS_MESSAGE],
]

/** 오류 글에서 거부 낱말을 찾아 화면 문장으로. 모르는 오류면 null(부르는 쪽이 일반 문장을 고른다). */
export function ecountImportErrorMessage(raw: string): string | null {
  for (const [code, message] of ECOUNT_IMPORT_ERRORS) if (raw.includes(code)) return message
  if (/23505/.test(raw)) return SAME_YEAR_RACE_MESSAGE
  if (/42501|row-level security|permission denied/.test(raw)) return NO_BOOKS_MESSAGE
  // 0050 · 0051 적용 전 DB — 표(PGRST205 · 42P01)나 함수(PGRST202 · 42883)가 없다.
  if (/PGRST205|42P01|PGRST202|42883/.test(raw)) return 'ECOUNT 업로드 준비가 아직 끝나지 않았습니다(DB 반영 전). 잠시 후 다시 시도하세요.'
  return null
}

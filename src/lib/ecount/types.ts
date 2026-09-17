/**
 * ECOUNT 원장 행의 모양 (Phase 2-A → 2-B).
 *
 * 2-B에서 ECOUNT OpenAPI 연동을 걷어냈다. 공개 OAPI에 전표·계정과목·마감 **조회**가 없었다(DEFERRED D-19 해소).
 * 회계 원천은 자체 장부고, ECOUNT는 DY 엑셀 업로드로만 들어온다. 이 파일에 남은 것은 두 가지다.
 *   - 원장 행 모양(대문자 약어, 문자열 금액, YYYYMMDD) — 업로드 파서가 엑셀을 이 모양으로 바꾸면
 *     map.ts → ingest.ts를 그대로 지난다. dummy mock 원장(mock.ts)도 같은 모양을 낸다.
 *   - EcountLedgerSource — 원장을 내주는 입구. 지금은 mock 하나, 업로드가 두 번째가 된다.
 */

/** 원장을 가진 회사 하나. 업로드도 회사 단위다. */
export interface EcountCompany {
  business_id: string
}

/** [제안] 계정과목 한 줄. 분류(대분류·구분·현금흐름)는 ECOUNT가 주지 않는다 — account-map.ts가 붙인다. */
export interface EcountAccountRow {
  ACCT_CODE: string
  ACCT_NAME: string
}

/** [제안] 전표 라인. 한 라인은 차변이나 대변 중 한쪽만 금액을 갖는다. */
export interface EcountSlipLineRow {
  /** YYYYMMDD */
  IO_DATE: string
  /** 전표번호. 같은 번호의 라인이 한 전표다 */
  SLIP_NO: string
  /** 전표 안의 순번 */
  SER_NO: string
  ACCT_CODE: string
  DR_AMT: string
  CR_AMT: string
  REMARKS: string
}

/** [제안] 월 마감 한 칸. 금액은 차변 − 대변. */
export interface EcountClosingRow {
  /** YYYYMM */
  YYMM: string
  ACCT_CODE: string
  BAL_AMT: string
  /** YYYYMMDD */
  CLOSE_DATE: string
  /** Y = 확정 마감, N = 가마감 */
  CLOSE_YN: 'Y' | 'N'
}

/**
 * 원장을 읽어 오는 입구. mock과 업로드가 같은 모양을 낸다.
 *
 * 기간 인자는 ECOUNT 표기(YYYYMMDD / YYYYMM)로 받는다. 우리 쪽 표기('YYYY-MM')로 바꾸는 일은
 * map.ts의 몫이다 — 두 표기가 이 경계를 넘어 섞이면 어느 쪽 날짜인지 코드가 알 수 없다.
 */
export interface EcountLedgerSource {
  readonly mode: 'mock' | 'upload'
  listAccounts(company: EcountCompany): Promise<EcountAccountRow[]>
  listSlipLines(company: EcountCompany, fromDate: string, toDate: string): Promise<EcountSlipLineRow[]>
  /** from ~ to (YYYYMM) 사이의 마감 칸 전부 */
  listClosings(company: EcountCompany, fromYymm: string, toYymm: string): Promise<EcountClosingRow[]>
}

/** 원천 행이 약속한 모양이 아닐 때(날짜·금액 형식, 차대 동시 기재). */
export class EcountApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

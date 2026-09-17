/**
 * ECOUNT OAPI V2의 모양 (Phase 2-A).
 *
 * 무엇이 확인된 사실이고 무엇이 아닌가 — 이 구분이 이 파일의 요점이다.
 * (2026-09-17 조사. 공식 매뉴얼 oapi.ecount.com/ECERP/OAPI/OAPIView는 로그인 후에만 열린다.
 *  아래 '확인'은 테스트 서버 실호출과 공개 자료 기준이다.)
 *
 *   확인   Zone   POST https://sboapi.ecount.com/OAPI/V2/Zone          { COM_CODE }
 *   확인   Login  POST https://{sboapi|oapi}{ZONE}.ecount.com/OAPI/V2/OAPILogin
 *                 { COM_CODE, USER_ID, ZONE, API_CERT_KEY, LAN_TYPE }
 *                 테스트 키는 sboapi, 운영 키는 oapi 호스트다.
 *   확인   이후 호출은 ?SESSION_ID=… 쿼리로 세션을 싣는다.
 *   확인   Status가 문자열("500")일 때도 숫자(200)일 때도 있다.
 *   확인   로그인 실패도 Status 200으로 온다. 실패는 Data.Code / Data.Message에만 있다.
 *   확인   숫자 칸은 문자열로 온다.
 *
 *   미확인 성공 응답의 Data.ZONE, Data.Datas.SESSION_ID 칸 이름(2차 자료만 있다).
 *   미확인 호출 한도. 자료마다 다르다(시간당 6,000 / List 10분 1회 등). 그래서 동기화는 하루 1회로 둔다.
 *
 *   **없음** 공개된 '제공 API' 표의 회계 항목은 '매출/매입 입력' 하나다(쓰기).
 *          전표·계정과목·원장·시산표·월마감을 **읽는** API가 목록에 없다 → DEFERRED D-19.
 *
 * 그래서 아래 원장 행(EcountAccountRow / EcountSlipLineRow / EcountClosingRow)은
 * ECOUNT의 필드 표기 관례(대문자 약어, 문자열 금액, YYYYMMDD)를 따른 **제안 모양**이다.
 * 실제 조회 경로(API 추가 확인 또는 엑셀 내보내기)가 정해지면 map.ts 한 곳만 고친다.
 */

/** 모든 응답의 겉봉. */
export interface EcountEnvelope<T> {
  Status: string | number
  Data?: T
  Error?: { Code: number | string; Message: string; MessageDetail?: string } | null
  Errors?: { Code: string; Message: string; ProgramId?: string; Name?: string }[] | null
  Timestamp?: string | null
  RequestKey?: string | null
}

export interface EcountZoneData {
  /** 미확인 — 성공 응답의 칸 이름 */
  ZONE?: string
  /** 확인 — 없는 회사코드면 true */
  EMPTY_ZONE?: boolean
}

export interface EcountLoginData {
  /** '00'이 아니면 실패로 본다. 확인된 실패 값: '10'(회사코드/아이디/키 불일치) */
  Code: string
  Message?: string
  Datas?: { SESSION_ID?: string }
}

/** 회사 하나의 연결 정보. ECOUNT는 회사코드(COM_CODE) 단위라 계열사마다 따로다. */
export interface EcountCompany {
  business_id: string
  com_code: string
  user_id: string
  api_cert_key: string
  /** 비우면 Zone API로 찾는다 */
  zone?: string
  /** true면 sboapi(테스트 서버) */
  test?: boolean
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
 * 원장을 읽어 오는 입구. mock과 real이 같은 모양을 낸다.
 *
 * 기간 인자는 ECOUNT 표기(YYYYMMDD / YYYYMM)로 받는다. 우리 쪽 표기('YYYY-MM')로 바꾸는 일은
 * map.ts의 몫이다 — 두 표기가 이 경계를 넘어 섞이면 어느 쪽 날짜인지 코드가 알 수 없다.
 */
export interface EcountLedgerSource {
  readonly mode: 'mock' | 'real'
  listAccounts(company: EcountCompany): Promise<EcountAccountRow[]>
  listSlipLines(company: EcountCompany, fromDate: string, toDate: string): Promise<EcountSlipLineRow[]>
  /** from ~ to (YYYYMM) 사이의 마감 칸 전부 */
  listClosings(company: EcountCompany, fromYymm: string, toYymm: string): Promise<EcountClosingRow[]>
}

/** 응답 겉봉이 실패를 말하거나, 성공 모양이 아닐 때. */
export class EcountApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

/** 공개 OAPI에 해당 조회 API가 없어서 real 모드가 할 수 없는 일(DEFERRED D-19). */
export class EcountUnsupportedError extends Error {}

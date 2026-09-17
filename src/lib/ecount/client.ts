import {
  EcountApiError,
  EcountUnsupportedError,
  type EcountCompany,
  type EcountEnvelope,
  type EcountLedgerSource,
  type EcountLoginData,
  type EcountZoneData,
} from './types'

/**
 * ECOUNT OAPI V2 실제 클라이언트.
 *
 * 되는 것: Zone 조회와 로그인. 키가 오면 '이 키가 맞는가'를 이것으로 먼저 확인한다.
 * 안 되는 것: 원장 읽기. 공개된 제공 API 목록에 전표·계정과목·마감 조회가 없다(types.ts 머리, DEFERRED D-19).
 *   세 함수는 로그인까지 해 본 뒤 EcountUnsupportedError를 던진다 — 키 문제와 API 부재를 구분해서 말하려고.
 *   조회 경로가 확인되면 이 세 함수만 채운다. 모양(EcountLedgerSource)은 그대로다.
 */

const TIMEOUT_MS = 20_000

function statusOk(status: string | number): boolean {
  return String(status) === '200'
}

function envelopeError(body: EcountEnvelope<unknown>): string {
  return body.Error?.Message ?? body.Errors?.[0]?.Message ?? `Status ${body.Status}`
}

async function post<T>(fetchImpl: typeof fetch, url: string, payload: unknown): Promise<T> {
  const res = await fetchImpl(url, {
    method: 'POST',
    // Content-Type과 Accept 둘 다 있어야 한다(확인됨). 하나만 있으면 HTML 오류 페이지가 온다.
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })
  const text = await res.text()
  let body: EcountEnvelope<T>
  try {
    body = JSON.parse(text) as EcountEnvelope<T>
  } catch {
    throw new EcountApiError(`ECOUNT 응답이 JSON이 아니다 (HTTP ${res.status}): ${text.slice(0, 120)}`)
  }
  if (!statusOk(body.Status) || !body.Data) {
    throw new EcountApiError(`ECOUNT ${url.split('/OAPI/')[1] ?? url}: ${envelopeError(body)}`)
  }
  return body.Data
}

function host(company: EcountCompany, zone: string | null): string {
  return `https://${company.test ? 'sboapi' : 'oapi'}${zone ?? ''}.ecount.com`
}

export function createRealLedgerSource(fetchImpl: typeof fetch = fetch): EcountLedgerSource {
  /** com_code → 세션. 동기화 한 번(요청 하나) 동안만 산다. 호출 한도가 불확실해 로그인을 재사용한다. */
  const sessions = new Map<string, Promise<{ zone: string; session: string }>>()

  async function login(company: EcountCompany) {
    const zone =
      company.zone ??
      (await (async () => {
        const data = await post<EcountZoneData>(fetchImpl, `${host(company, null)}/OAPI/V2/Zone`, {
          COM_CODE: company.com_code,
        })
        if (data.EMPTY_ZONE || !data.ZONE) {
          throw new EcountApiError(`회사코드 ${company.com_code}의 Zone을 찾지 못했다.`)
        }
        return data.ZONE
      })())

    const data = await post<EcountLoginData>(fetchImpl, `${host(company, zone)}/OAPI/V2/OAPILogin`, {
      COM_CODE: company.com_code,
      USER_ID: company.user_id,
      ZONE: zone,
      API_CERT_KEY: company.api_cert_key,
      LAN_TYPE: 'ko-KR',
    })
    // 로그인 실패도 Status 200으로 온다(확인됨). 실패는 Data.Code에만 있다.
    const session = data.Datas?.SESSION_ID
    if (data.Code !== '00' || !session) {
      throw new EcountApiError(`ECOUNT 로그인 실패(${data.Code}): ${data.Message ?? '사유 없음'}`, data.Code)
    }
    return { zone, session }
  }

  function session(company: EcountCompany) {
    const hit = sessions.get(company.com_code)
    if (hit) return hit
    const p = login(company)
    // 실패한 로그인을 캐시에 남기지 않는다. 다음 회사·다음 호출이 다시 시도할 수 있어야 한다.
    p.catch(() => sessions.delete(company.com_code))
    sessions.set(company.com_code, p)
    return p
  }

  async function unsupported(company: EcountCompany, what: string): Promise<never> {
    await session(company)
    throw new EcountUnsupportedError(
      `로그인은 됐지만 ${what} 조회 API가 ECOUNT 공개 OAPI 목록에 없다 (DEFERRED D-19).`,
    )
  }

  return {
    mode: 'real',
    listAccounts: (company) => unsupported(company, '계정과목'),
    listSlipLines: (company) => unsupported(company, '전표'),
    listClosings: (company) => unsupported(company, '월 마감'),
  }
}

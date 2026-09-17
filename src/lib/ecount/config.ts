import { createRealLedgerSource } from './client'
import { MOCK_COMPANIES, mockLedgerSource } from './mock'
import type { EcountCompany, EcountLedgerSource } from './types'

/**
 * mock이냐 real이냐를 정하는 유일한 자리. 서버에서만 부른다.
 *
 * ECOUNT_COMPANIES가 있으면 real, 없으면 mock. 형식이 틀리면 **mock으로 떨어지지 않고 멈춘다** —
 * 키를 넣었는데 조용히 mock이 돌면, 동기화 보고서가 '성공'이라고 말하는 동안 아무것도 가져오지 않는다.
 * (NEXT_PUBLIC_DATA_MODE를 조용히 dummy로 떨어뜨리지 않는 것과 같은 이유. HANDOVER 5절)
 *
 * ECOUNT_COMPANIES 예 (서버 전용. NEXT_PUBLIC_를 붙이지 않는다):
 *   [{"business_id":"biz_dy","com_code":"123456","user_id":"API_USER","api_cert_key":"...","zone":"CB","test":true}]
 */

export interface EcountSetup {
  source: EcountLedgerSource
  companies: EcountCompany[]
}

export function ecountSetup(env: NodeJS.ProcessEnv = process.env): EcountSetup {
  const raw = env.ECOUNT_COMPANIES?.trim()
  if (!raw) return { source: mockLedgerSource, companies: MOCK_COMPANIES }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('ECOUNT_COMPANIES가 JSON이 아니다. .env.example의 예를 본다.')
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('ECOUNT_COMPANIES는 회사 한 곳 이상의 배열이어야 한다.')
  }
  const companies = parsed.map((c, i): EcountCompany => {
    const r = (c ?? {}) as Record<string, unknown>
    for (const key of ['business_id', 'com_code', 'user_id', 'api_cert_key'] as const) {
      if (typeof r[key] !== 'string' || !(r[key] as string).trim()) {
        throw new Error(`ECOUNT_COMPANIES[${i}].${key}가 비었다.`)
      }
    }
    return {
      business_id: r.business_id as string,
      com_code: r.com_code as string,
      user_id: r.user_id as string,
      api_cert_key: r.api_cert_key as string,
      zone: typeof r.zone === 'string' && r.zone ? r.zone : undefined,
      test: r.test === true,
    }
  })
  return { source: createRealLedgerSource(), companies }
}

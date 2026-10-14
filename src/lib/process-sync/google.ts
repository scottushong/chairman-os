import 'server-only'

import { createSign } from 'node:crypto'

/**
 * 구글 시트 읽기 (0071) — 서비스 계정 + Sheets API v4, **읽기 전용**(spreadsheets.readonly).
 *
 * 새 의존성을 들이지 않는다. 서비스 계정 로그인은 JWT 한 장(RS256, node:crypto)을 구글 토큰 주소에 내고
 * 한 시간짜리 access token을 받는 것뿐이다 — googleapis 패키지(수십 MB)를 이 한 줄 때문에 넣지 않는다.
 * «웹에 게시» 주소(pubhtml)는 읽지 않는다: 게시본은 누구나 읽는 공개 주소라 거기서 업무를 끌어오면
 * 공개를 끄는 순간 동기화가 깨지고, 공개를 유지하라고 권하게 된다.
 *
 * 비밀값은 env 이름만 안다: GOOGLE_SHEETS_SA_JSON(서비스 계정 키 JSON 한 덩어리). 값이 없으면
 * 화면은 «연결 전»이고 동기화 버튼이 꺼진다(isSheetsConfigured). 키 · 토큰은 오류 문장 · 로그에 싣지 않는다.
 *
 * 시험은 진짜 구글을 부르지 않는다 — SheetsReader 인터페이스 뒤에 가짜(fake.ts)를 끼운다.
 */

export interface SheetsReader {
  /** 시트의 값(문자열 격자). tab이 null이면 첫 탭. */
  readValues(sheetId: string, tab: string | null): Promise<string[][]>
}

/** 사람에게 보여 줄 문장을 가진 오류. message에 비밀값 · 응답 본문을 싣지 않는다. */
export class SheetsReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetsReadError'
  }
}

export const SHEETS_ENV = 'GOOGLE_SHEETS_SA_JSON'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export function isSheetsConfigured(): boolean {
  return (process.env[SHEETS_ENV] ?? '').trim() !== ''
}

interface ServiceAccountKey {
  client_email: string
  private_key: string
}

function readKey(): ServiceAccountKey {
  const raw = process.env[SHEETS_ENV]
  if (!raw) throw new SheetsReadError('구글 시트 연결 전입니다(서비스 계정 키가 없습니다).')
  try {
    const key = JSON.parse(raw) as Partial<ServiceAccountKey>
    if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') throw new Error('shape')
    return { client_email: key.client_email, private_key: key.private_key.replace(/\\n/g, '\n') }
  } catch {
    throw new SheetsReadError('서비스 계정 키(GOOGLE_SHEETS_SA_JSON)의 모양이 틀렸습니다. JSON 파일 내용을 그대로 넣어야 합니다.')
  }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url')

/** 서비스 계정 JWT(RS256). 내보내는 이유는 check 스크립트가 모양(머리 · 범위 · 서명 길이)을 재기 위해서다. */
export function signServiceAccountJwt(key: ServiceAccountKey, nowSec = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${head}.${body}`)
  return `${head}.${body}.${b64url(signer.sign(key.private_key))}`
}

let cached: { token: string; until: number; email: string } | null = null

async function accessToken(): Promise<string> {
  const key = readKey()
  if (cached && cached.email === key.client_email && cached.until > Date.now() + 60_000) return cached.token
  let jwt: string
  try {
    jwt = signServiceAccountJwt(key)
  } catch {
    throw new SheetsReadError('서비스 계정 키로 서명하지 못했습니다(private_key를 확인하세요).')
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    cache: 'no-store',
  })
  if (!res.ok) throw new SheetsReadError(`구글 로그인에 실패했습니다(HTTP ${res.status}). 서비스 계정 키가 지워졌거나 바뀌었는지 보세요.`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new SheetsReadError('구글 로그인 응답에 토큰이 없습니다.')
  cached = { token: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000, email: key.client_email }
  return data.access_token
}

/** 읽는 범위. 탭 이름이 있으면 '탭'!A1:Z2001, 없으면 첫 탭 A1:Z2001(제목 줄 + 2000줄). */
export function sheetRange(tab: string | null): string {
  const cells = 'A1:Z2001'
  return tab ? `'${tab}'!${cells}` : cells
}

export function googleSheetsReader(): SheetsReader {
  return {
    async readValues(sheetId, tab) {
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(sheetId)) throw new SheetsReadError('시트 파일 ID 모양이 틀렸습니다.')
      const token = await accessToken()
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(sheetRange(tab))}` +
        '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE'
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (res.status === 403) throw new SheetsReadError('서비스 계정이 이 시트를 볼 수 없습니다. 시트의 «공유»에 서비스 계정 이메일을 «뷰어»로 넣으세요.')
      if (res.status === 404) throw new SheetsReadError('시트를 찾지 못했습니다. 파일 ID를 확인하세요.')
      if (res.status === 400) throw new SheetsReadError('탭 이름을 찾지 못했습니다. 탭 이름을 확인하거나 비워 두세요(첫 탭).')
      if (res.status === 429) throw new SheetsReadError('구글이 잠시 읽기를 막았습니다(요청이 많음). 1분 뒤에 다시 하세요.')
      if (!res.ok) throw new SheetsReadError(`구글 시트를 읽지 못했습니다(HTTP ${res.status}).`)
      const data = (await res.json()) as { values?: unknown[][] }
      return (data.values ?? []).map((r) => r.map((c) => (c == null ? '' : String(c))))
    },
  }
}

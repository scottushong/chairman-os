/**
 * 모델 호출 실패를 사람 말로 (Phase 11). 오류 한 가지마다 사용자에게 다른 문장, 로그에는 한 줄의 구조.
 *
 * SDK 오류 클래스(@anthropic-ai/sdk APIError …)를 instanceof로 보지 않고 모양(status · type · name · message)으로
 * 본다 — 검증(scripts/check-ask.ts)이 SDK 없이 같은 모양의 객체로 잰다. 순서가 뜻이다: 시간 초과는 연결 오류의
 * 한 갈래라 먼저, 크레딧 부족은 400의 한 갈래라 다른 400보다 먼저 본다.
 */

export type AiErrorKind =
  | 'auth'
  | 'credit'
  | 'rate_limit'
  | 'overloaded'
  | 'timeout'
  | 'connection'
  | 'bad_request'
  | 'server'
  | 'unknown'

export interface AiErrorInfo {
  kind: AiErrorKind
  status: number | null
  requestId: string | null
  /** API 본문의 error.type(예: rate_limit_error). */
  type: string | null
  message: string
}

const MESSAGE_KO: Record<AiErrorKind, string> = {
  auth: 'AI 연결 키가 맞지 않아 답하지 못했습니다. 시스템 담당자에게 알려 주세요.',
  credit: 'AI 사용 크레딧이 바닥나 지금은 답하지 못합니다. 시스템 담당자에게 알려 주세요.',
  rate_limit: 'AI 요청이 몰려 잠시 막혔습니다. 1분쯤 뒤에 다시 물어 주세요.',
  overloaded: 'AI 서버가 지금 붐빕니다. 잠시 후 다시 물어 주세요.',
  timeout: 'AI 답이 60초 안에 오지 않았습니다. 질문을 좁혀 다시 물어 주세요.',
  connection: 'AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
  bad_request: 'AI 요청을 처리하지 못했습니다. 새 대화를 열어 다시 물어 주세요.',
  server: 'AI 서버 오류로 답하지 못했습니다. 잠시 후 다시 시도하세요.',
  unknown: 'AI가 답하지 못했습니다. 잠시 후 다시 시도하세요.',
}

const MESSAGE_EN: Record<AiErrorKind, string> = {
  auth: 'The AI key is not valid, so no answer was made. Please tell the system admin.',
  credit: 'AI credit has run out. Please tell the system admin.',
  rate_limit: 'Too many AI requests right now. Please ask again in a minute.',
  overloaded: 'The AI service is busy. Please try again shortly.',
  timeout: 'The AI did not answer within 60 seconds. Try a narrower question.',
  connection: 'Could not reach the AI service. Please try again shortly.',
  bad_request: 'The AI could not process this request. Please open a new chat and ask again.',
  server: 'The AI service had an error. Please try again shortly.',
  unknown: 'The AI could not answer. Please try again shortly.',
}

export function aiErrorMessage(kind: AiErrorKind, lang: 'ko' | 'en' = 'ko'): string {
  return (lang === 'en' ? MESSAGE_EN : MESSAGE_KO)[kind]
}

function field(e: unknown, k: string): unknown {
  return e && typeof e === 'object' ? (e as Record<string, unknown>)[k] : undefined
}

export function classifyAiError(e: unknown): AiErrorInfo {
  const status = typeof field(e, 'status') === 'number' ? (field(e, 'status') as number) : null
  // SDK 오류의 name은 그냥 'Error'일 때가 있다 — 클래스 이름(APIConnectionTimeoutError …)도 같이 본다.
  const name = `${typeof field(e, 'name') === 'string' ? (field(e, 'name') as string) : ''} ${e && typeof e === 'object' ? (e.constructor?.name ?? '') : ''}`
  const message = e instanceof Error ? e.message : typeof field(e, 'message') === 'string' ? (field(e, 'message') as string) : String(e ?? '')
  // SDK는 본문의 error.type을 type에 둔다. 옛 판은 error.error.type에만 있다.
  const body = field(e, 'error')
  const type =
    (typeof field(e, 'type') === 'string' ? (field(e, 'type') as string) : null) ??
    (typeof field(field(body, 'error'), 'type') === 'string' ? (field(field(body, 'error'), 'type') as string) : null)
  const rid = field(e, 'requestID') ?? field(e, 'request_id')
  const requestId = typeof rid === 'string' ? rid : null

  const kind: AiErrorKind = (() => {
    if (/timeout|timed out/i.test(name) || /timed? ?out/i.test(message)) return 'timeout'
    if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') return 'auth'
    if (/credit balance|insufficient.*credit|billing/i.test(message)) return 'credit'
    if (status === 429 || type === 'rate_limit_error') return 'rate_limit'
    if (status === 529 || type === 'overloaded_error' || /overloaded/i.test(message)) return 'overloaded'
    if (status === null && (/connection/i.test(name) || /ECONNRESET|ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(message))) return 'connection'
    if (status === 400 || status === 404 || status === 413 || status === 422) return 'bad_request'
    if (status !== null && status >= 500) return 'server'
    return 'unknown'
  })()
  return { kind, status, requestId, type, message: message.slice(0, 300) }
}

/** 로그 한 줄(구조). 사용자 문장과 따로 — 원인을 찾는 사람은 이 줄을 grep한다. */
export function logAiError(info: AiErrorInfo, extra: Record<string, unknown> = {}) {
  console.error(
    '[assistant] model_error',
    JSON.stringify({ kind: info.kind, status: info.status, request_id: info.requestId, type: info.type, message: info.message, ...extra }),
  )
}

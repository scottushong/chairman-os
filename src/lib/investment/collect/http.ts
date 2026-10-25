/**
 * 수집 경로의 외부 호출 손잡이 하나 — 호출 수를 세고(하루 한도), SEC Fair Access를 지킨다.
 *
 *   SEC: User-Agent = env SEC_USER_AGENT(회사명 + 연락 이메일 — 코드에 박지 않는다). 비면 «DY Industry chairman-os»로 부르고
 *        화면이 «SEC_USER_AGENT 비어 있음»을 안내한다. 초당 4회 이하(SEC 한도 10회의 절반 아래), 429 · 5xx는 1 · 2 · 4초 뒤 다시.
 *   그 밖: 기본 User-Agent · 같은 재시도.
 * 비밀값(키)은 주소에 붙여도 오류 문장 · 기록에는 남기지 않는다(redact).
 */

export class BudgetExceeded extends Error {
  constructor() {
    super('collect_daily_limit')
  }
}

export const DEFAULT_SEC_UA = 'DY Industry chairman-os'

export function secUserAgent(): { ua: string; configured: boolean } {
  const v = process.env.SEC_USER_AGENT?.trim()
  return v ? { ua: v, configured: true } : { ua: DEFAULT_SEC_UA, configured: false }
}

export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string>; method?: string; body?: string; signal?: AbortSignal }): Promise<{
    ok: boolean
    status: number
    text(): Promise<string>
    json(): Promise<unknown>
  }>
}

export interface HttpOptions {
  /** 이 실행에서 더 부를 수 있는 호출 수(하루 한도 − 오늘 쓴 것). */
  remaining: number
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  secrets?: string[]
}

export class Http {
  calls = 0
  private readonly last = new Map<string, number>()
  private readonly fetchImpl: FetchLike
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  constructor(private readonly opts: HttpOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: 'no-store' }) as ReturnType<FetchLike>)
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now = opts.now ?? (() => Date.now())
  }

  get left() {
    return this.opts.remaining - this.calls
  }

  redact(s: string) {
    return (this.opts.secrets ?? []).filter(Boolean).reduce((t, k) => t.split(k).join('<key>'), s)
  }

  /** 호스트별 최소 간격(ms) — SEC 초당 4회 · Twelve Data 무료 분당 8회 · OpenFIGI 키 없이 분당 25회. */
  private interval(url: string, sec: boolean) {
    if (sec) return 260
    const host = /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? ''
    if (host === 'api.twelvedata.com') return 7600
    if (host === 'api.openfigi.com') return process.env.OPENFIGI_API_KEY?.trim() ? 300 : 2500
    return 0
  }

  private async one(url: string, init: Parameters<FetchLike>[1], sec: boolean) {
    if (this.calls >= this.opts.remaining) throw new BudgetExceeded()
    const gap = this.interval(url, sec)
    if (gap > 0) {
      const host = sec ? 'sec' : (/^https?:\/\/([^/]+)/.exec(url)?.[1] ?? '')
      const wait = (this.last.get(host) ?? 0) + gap - this.now()
      if (wait > 0) await this.sleep(wait)
      this.last.set(host, this.now())
    }
    this.calls += 1
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 30_000)
    try {
      return await this.fetchImpl(url, { ...init, signal: ctl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  async get(url: string, kind: 'sec' | 'other' = 'other', headers: Record<string, string> = {}, method = 'GET', body?: string) {
    const sec = kind === 'sec'
    const h: Record<string, string> = sec
      ? { 'User-Agent': secUserAgent().ua, 'Accept-Encoding': 'gzip, deflate', ...headers }
      : { 'User-Agent': `${DEFAULT_SEC_UA} (investment research)`, ...headers }
    let lastErr = ''
    for (const backoff of [0, 1000, 2000, 4000]) {
      if (backoff) await this.sleep(backoff)
      try {
        const res = await this.one(url, { headers: h, method, body }, sec)
        if (res.ok) return res
        lastErr = `HTTP ${res.status}`
        if (res.status !== 429 && res.status < 500) break
      } catch (e) {
        if (e instanceof BudgetExceeded) throw e
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    throw new Error(this.redact(`${lastErr} — ${url.replace(/\?.*$/, '')}`))
  }

  async text(url: string, kind: 'sec' | 'other' = 'other', headers: Record<string, string> = {}) {
    return (await this.get(url, kind, headers)).text()
  }

  async json<T = unknown>(url: string, kind: 'sec' | 'other' = 'other', headers: Record<string, string> = {}) {
    const t = await (await this.get(url, kind, headers)).text()
    try {
      return JSON.parse(t) as T
    } catch {
      throw new Error(`JSON 아님 — ${url.replace(/\?.*$/, '')}`)
    }
  }

  async postJson<T = unknown>(url: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await this.get(url, 'other', { 'Content-Type': 'application/json', ...headers }, 'POST', JSON.stringify(body))
    return JSON.parse(await res.text()) as T
  }
}

import type { ChangeStatus, InvChange, InvDisclosure, InvPosition, ManagerId } from './types'

/**
 * 공시 사이 순보유 변화 판정(원문 4.2) — 결정론, AI 없음.
 *
 *   Net Share Change = Adjusted Current Shares − Adjusted Previous Shares
 *   Share Change %   = Net Share Change / Adjusted Previous Shares × 100
 *
 * **주식 수만 본다.** 평가액(value)은 판정에 쓰지 않는다 — 주가가 올라 평가액이 늘어도 매수가 아니다(검증 6).
 * 분할: 두 기준일 사이 기록된 분할이 있으면 이전 수량 × 비율. 기록이 없는데 수량비 · 가격비가 흔한 분할 비율에
 * 맞으면 «분할 의심» UNKNOWN — 매수 · 매도로 세지 않는다(검증 7).
 * 공시 사이의 순보유 변화만 계산한다. 장중 매수일 · 평균 매수가 · 거래 횟수는 만들지 않는다.
 */
export const CHANGE_VERSION = 'chg-1.0'

const SPLIT_RATIOS = [2, 3, 4, 5, 10, 20, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 10, 1 / 20]

export interface Holding {
  key: string
  issuer: string
  cusip: string | null
  security_id: string | null
  shares: number | null
  value: number | null
  ownership: number | null
}

/**
 * 같은 공시 안 같은 종목 여러 줄(13F의 운용 단위 · discretion별 줄)을 합친다.
 * 옵션(put/call) 줄은 주식 보유가 아니라 뺀다. PRN(채권 원금)은 따로 열쇠를 둔다 — 주식 수와 섞지 않는다.
 */
export function aggregate(positions: readonly InvPosition[]): Map<string, Holding> {
  const out = new Map<string, Holding>()
  for (const p of positions) {
    if (p.put_call) continue
    const key = p.share_type === 'PRN' ? `${p.holding_key}:PRN` : p.holding_key
    const h = out.get(key)
    if (!h) {
      out.set(key, {
        key,
        issuer: p.issuer_name,
        cusip: p.cusip,
        security_id: p.security_id,
        shares: p.shares,
        value: p.value,
        ownership: p.ownership_pct,
      })
      continue
    }
    h.shares = h.shares === null || p.shares === null ? null : h.shares + p.shares
    h.value = h.value === null || p.value === null ? null : h.value + p.value
    h.ownership = h.ownership === null || p.ownership_pct === null ? h.ownership ?? p.ownership_pct : h.ownership + p.ownership_pct
    h.security_id ??= p.security_id
  }
  return out
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d

/** 기록 없는 분할 의심 — 수량비가 분할 비율에 맞고(±1%), 가격비가 그 역수 근처(±35%)일 때. */
export function suspectSplit(prev: Holding, cur: Holding): number | null {
  if (!prev.shares || !cur.shares || !prev.value || !cur.value) return null
  const r = cur.shares / prev.shares
  const pricePrev = prev.value / prev.shares
  const priceCur = cur.value / cur.shares
  for (const k of SPLIT_RATIOS) {
    if (Math.abs(r / k - 1) <= 0.01 && Math.abs(pricePrev / priceCur / k - 1) <= 0.35) return k
  }
  return null
}

export interface ClassifyInput {
  manager: ManagerId
  sourceId: string
  from: InvDisclosure
  to: InvDisclosure
  prev: readonly InvPosition[]
  cur: readonly InvPosition[]
  /** 'shares' = 주식 수 비교(13F · 손 입력) · 'presence' = 목록에 있나만(NBIM 전체 목록 — 주식 수 없음) */
  basis: 'shares' | 'presence'
  /** 기록된 분할 비율(두 기준일 사이 누적). 없으면 null. */
  splitFactor?: (h: Holding) => number | null
}

export function classify(input: ClassifyInput): InvChange[] {
  const prev = aggregate(input.prev)
  const cur = aggregate(input.cur)
  const keys = [...new Set([...prev.keys(), ...cur.keys()])].sort()
  const out: InvChange[] = []
  for (const key of keys) {
    const p = prev.get(key) ?? null
    const c = cur.get(key) ?? null
    const base: InvChange = {
      manager_id: input.manager,
      source_id: input.sourceId,
      from_disclosure: input.from.disclosure_id,
      to_disclosure: input.to.disclosure_id,
      holding_key: key,
      security_id: c?.security_id ?? p?.security_id ?? null,
      issuer_name: c?.issuer ?? p?.issuer ?? key,
      cusip: c?.cusip ?? p?.cusip ?? null,
      prev_shares: p?.shares ?? null,
      split_factor: 1,
      prev_shares_adj: p?.shares ?? null,
      cur_shares: c?.shares ?? null,
      net_change: null,
      change_pct: null,
      prev_value: p?.value ?? null,
      cur_value: c?.value ?? null,
      prev_ownership_pct: p?.ownership ?? null,
      cur_ownership_pct: c?.ownership ?? null,
      status: 'UNKNOWN',
      basis: input.basis,
      note: null,
      calculation_version: CHANGE_VERSION,
    }
    if (!p && c) {
      out.push({ ...base, status: 'NEW', net_change: c.shares, note: '이전 공시에 없고 최신 공시에 있음' })
      continue
    }
    if (p && !c) {
      out.push({
        ...base,
        status: 'EXIT',
        net_change: p.shares === null ? null : -p.shares,
        change_pct: p.shares ? -100 : null,
        note: '이전 공시에 있었으나 최신 공개 범위에서 확인되지 않음(실제 전량 매도인지는 공개 범위 밖)',
      })
      continue
    }
    if (!p || !c) continue
    if (input.basis === 'presence') {
      const d = p.ownership !== null && c.ownership !== null ? round(c.ownership - p.ownership, 4) : null
      out.push({ ...base, status: 'UNKNOWN', note: `주식 수가 공개되지 않음 — 계속 보유${d === null ? '' : ` · 지분율 ${d >= 0 ? '+' : ''}${d}%p(참고)`}` })
      continue
    }
    if (p.shares === null || c.shares === null) {
      out.push({ ...base, status: 'UNKNOWN', note: '주식 수가 비어 있음' })
      continue
    }
    const recorded = input.splitFactor?.(p) ?? null
    if (recorded === null && p.shares !== c.shares) {
      const k = suspectSplit(p, c)
      if (k !== null) {
        out.push({
          ...base,
          status: 'UNKNOWN',
          note: `분할 의심(수량 ×${k >= 1 ? k : `1/${Math.round(1 / k)}`} · 평가액÷수량 가격 반대 방향) — 기업행위 자료가 없어 매수 · 매도로 세지 않음`,
        })
        continue
      }
    }
    const factor = recorded ?? 1
    const adj = p.shares * factor
    const net = c.shares - adj
    const status: ChangeStatus = net === 0 ? 'HOLD' : net > 0 ? 'ADD' : 'TRIM'
    out.push({
      ...base,
      split_factor: factor,
      prev_shares_adj: adj,
      net_change: net,
      change_pct: adj > 0 ? round((net / adj) * 100, 4) : null,
      status,
      note: factor !== 1 ? `분할 보정 ×${factor}` : null,
    })
  }
  return out
}

/** 한 기준일의 실제 공시 묶음 — 원본 + NEW HOLDINGS 수정 · RESTATEMENT 수정은 원본을 대신한다. */
export interface EffectivePeriod {
  as_of: string
  primary: InvDisclosure
  members: InvDisclosure[]
}

export function effectivePeriods(disclosures: readonly InvDisclosure[]): EffectivePeriod[] {
  const byDate = new Map<string, InvDisclosure[]>()
  for (const d of disclosures) byDate.set(d.data_as_of, [...(byDate.get(d.data_as_of) ?? []), d])
  const pub = (d: InvDisclosure) => `${d.source_published_at ?? ''}|${d.ingested_at}`
  const out: EffectivePeriod[] = []
  for (const [as_of, list] of byDate) {
    const sorted = [...list].sort((a, b) => pub(a).localeCompare(pub(b)))
    const restated = sorted.filter((d) => d.amendment_type === 'RESTATEMENT').at(-1)
    const original = sorted.filter((d) => !d.is_amendment).at(-1)
    const primary = restated ?? original ?? sorted.at(-1)!
    const added = sorted.filter((d) => d.amendment_type === 'NEW HOLDINGS' && pub(d) > pub(primary))
    out.push({ as_of, primary, members: [primary, ...added] })
  }
  return out.sort((a, b) => a.as_of.localeCompare(b.as_of))
}

/** 판정 개수(대시보드 · 레이더 요약). */
export function countChanges(changes: readonly InvChange[]): Record<ChangeStatus, number> {
  const c: Record<ChangeStatus, number> = { NEW: 0, ADD: 0, TRIM: 0, EXIT: 0, HOLD: 0, UNKNOWN: 0 }
  for (const x of changes) c[x.status] += 1
  return c
}

import { suggestAccountClass } from '@/lib/ecount/excel/accounts-import'
import type { AccountSection, FinAutoFix, FinRow } from '@/types'

import type { AutoDecision, AutoRule } from './auto-types'

import { addMonths, computeDebt, DEBT_SOURCE_KO, plAccountsRaw, sumOf, VAL_SOURCE_KO, type AcctAmount, type Ctx, type MonthData, type ValSource } from './engine'

/**
 * 0091 «자동 판단 · 버튼 없음» — 자료가 들어오면 시스템이 정한다. 사람에게 고르라고 하지 않는다. 틀리면 파일을 빼거나 숫자를 고친다.
 * 순수 함수(검사 check:finance-auto가 잰다). 원장 원본(줄)은 고치지 않는다 — ctx의 달 자료(평가 칸 · 카드 줄)와 손익 조정(plAdjust)만 바꾼다.
 *
 *   1 평가     재공품 · 완제품 월말 = 그 달 평가 파일(실측) → 제조지시명세서 · 출하집계표로 추정 → 앞 달 값(이월, 3달까지). 사람이 고친 값이 이긴다.
 *   2 귀속월   원장 거래 줄(손익 계정)의 적요 «N월분» → 그 달 · «기간(1~3월 · 2026.01~2026.12)» → N등분 · 연납 모양(보험 · 임차 · 세금 · 같은 거래처
 *              한 해 한 번 · 100만 원 이상) → 12등분. 아니면 전표 날짜 그대로. 사람이 달을 고치거나 «원래 날짜로» 되돌릴 수 있다.
 *   3 중복     법인카드 줄과 원장 거래 줄이 같은 금액 · ±3일 · 같은 거래처(또는 적요 유사)면 법인카드 쪽을 뺀다. «되살리기».
 *   4 원금/이자 대출현황 열 → 없으면 원장 이자비용(engine.computeDebt). 출처만 알린다(고칠 것은 파일).
 */

export { AUTO_RULE_KO, type AutoDecision, type AutoRule } from './auto-types'

/* ───────────────────────── 낱말 · 숫자 ───────────────────────── */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`
const monthKo = (p: string) => `${Number(p.slice(5, 7))}월`
const ymKo = (p: string) => `${p.slice(0, 4)}년 ${Number(p.slice(5, 7))}월`
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
/** 거래처 · 적요 비교용 — 띄어쓰기 · 괄호 · 법인 표기 · 기호를 뺀 소문자. */
export const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|co\.?,?\s*ltd\.?|inc\.?|corp\.?/g, '')
    .replace(/[\s()[\]{}.,·\-_/&'"*:;]+/g, '')
const bigrams = (s: string) => {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2))
  return out
}
/** 두 글의 비슷함(0~1, 두 글자 묶음 Dice). */
export function similar(a: string, b: string): number {
  const x = bigrams(a)
  const y = bigrams(b)
  if (!x.size || !y.size) return 0
  let both = 0
  for (const g of x) if (y.has(g)) both += 1
  return (2 * both) / (x.size + y.size)
}
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)

/** 같은 (규칙, 자리)의 마지막 고침(«자동으로»면 없음). */
function latestFixes(fixes: readonly FinAutoFix[]): Map<string, FinAutoFix> {
  const out = new Map<string, FinAutoFix>()
  for (const f of [...fixes].sort((a, b) => a.fix_id - b.fix_id)) {
    const k = `${f.rule}|${f.item_key}`
    if (f.action === 'auto') out.delete(k)
    else out.set(k, f)
  }
  return out
}
const fixOf = (f: FinAutoFix | undefined) => (f ? { by: f.created_by_name, at: f.created_at, prev: f.prev } : null)

const PL: AccountSection[] = ['revenue', 'cogs', 'sga', 'd_and_a', 'non_operating', 'tax']
function plSection(ctx: Ctx, code: string, name: string): { section: AccountSection; category: AcctAmount['category'] } | null {
  const a = ctx.accounts.get(code)
  if (a) return PL.includes(a.section) ? { section: a.section, category: a.category } : null
  const s = suggestAccountClass(code, name, '')
  return s.suggestion && !s.contradiction && PL.includes(s.suggestion.section) ? { section: s.suggestion.section, category: s.suggestion.category } : null
}

/* ───────────────────────── 2 귀속월 ───────────────────────── */

/** 적요에서 귀속 달(들)을 읽는다 — «N월분» · 기간(물결표만 — 날짜의 '-'를 기간으로 읽지 않는다). 못 읽으면 null. */
export function periodsFromMemo(memo: string, linePeriod: string): { months: string[]; why: string } | null {
  const text = memo.replace(/\s+/g, ' ')
  const y0 = Number(linePeriod.slice(0, 4))
  const m0 = Number(linePeriod.slice(5, 7))
  const year = (y: string | undefined) => (!y ? null : y.length === 2 ? 2000 + Number(y) : Number(y))
  // 기간 — «2026.01~2026.12» · «26년 1월~12월» · «1~3월» · «10월~12월»
  const range = /(?:(\d{4}|\d{2})\s*[.년/]\s*)?(\d{1,2})\s*월?\s*[~～〜]\s*(?:(\d{4}|\d{2})\s*[.년/]\s*)?(\d{1,2})\s*월/.exec(text) ?? /(\d{4})\s*[./]\s*(\d{1,2})\s*[~～〜]\s*(\d{4})\s*[./]\s*(\d{1,2})/.exec(text)
  if (range) {
    const ya = year(range[1]) ?? y0
    const ma = Number(range[2])
    const yb = year(range[3]) ?? (Number(range[4]) < ma ? ya + 1 : ya)
    const mb = Number(range[4])
    if (ma >= 1 && ma <= 12 && mb >= 1 && mb <= 12) {
      const from = ym(ya, ma)
      const to = ym(yb, mb)
      const months: string[] = []
      for (let p = from; p <= to && months.length <= 24; p = addMonths(p, 1)) months.push(p)
      if (months.length >= 1 && months.length <= 24 && !(months.length === 1 && months[0] === linePeriod)) return { months, why: `적요 «${range[0].trim()}» — 기간 ${months.length}달` }
    }
  }
  const part = /(?:(\d{4}|\d{2})\s*년\s*)?(\d{1,2})\s*월\s*분/.exec(text)
  if (part) {
    const m = Number(part[2])
    if (m >= 1 && m <= 12) {
      // 연도가 없으면 — 전표 달보다 두 달 넘게 뒤의 달이면 지난해(1월 전표의 «12월분»).
      const y = year(part[1]) ?? (m > m0 + 1 ? y0 - 1 : y0)
      const target = ym(y, m)
      if (target !== linePeriod) return { months: [target], why: `적요 «${part[0].trim()}»` }
    }
  }
  return null
}

const ANNUAL_WORD = /보험|임차|임대료|리스료|세금|공과|연회비|연납|연간|1년분|년분/
/** 적요 · 계정에 «한 해 치»라고 적혀 있으면 원장이 몇 달 없어도 연납으로 본다. */
const ANNUAL_SAID = /연납|연간|1년분|12개월|일년/
/** «한 해 한 번»을 말하려면 원장 거래 줄이 이만큼의 달에 있어야 한다(한두 달 자료로 매달 내는 임차료를 12등분하지 않게). */
const ANNUAL_MIN_MONTHS = 6

interface Line {
  period: string
  row: FinRow
  code: string
  name: string
  amount: number
  key: string
}

/** 원장 거래 줄의 자리 열쇠 — 다시 올려도(줄 번호가 바뀌어도) 같은 줄은 같은 열쇠. */
export function lineKey(r: FinRow, period: string): string {
  const amt = num(r.debit) - num(r.credit)
  return `${period}:${String(r.tx_date ?? '').slice(0, 10)}:${String(r.account_code ?? '').trim()}:${amt}:${norm(r.counterparty).slice(0, 24)}:${norm(r.memo).slice(0, 24)}`.slice(0, 200)
}

function periodRule(ctx: Ctx, fixes: Map<string, FinAutoFix>): AutoDecision[] {
  const lines: Line[] = []
  for (const [p, m] of ctx.months) {
    for (const r of m.ledgerLines) {
      const code = String(r.account_code ?? '').trim()
      const name = String(r.account_name ?? ctx.accounts.get(code)?.name ?? code)
      if (!code || !plSection(ctx, code, name)) continue
      const amount = num(r.debit) - num(r.credit)
      if (!amount) continue
      lines.push({ period: p, row: r, code, name, amount, key: lineKey(r, p) })
    }
  }
  // 연납 모양 — 같은 (계정, 거래처)가 읽은 기간 안에 한 번뿐.
  const seen = new Map<string, number>()
  for (const l of lines) {
    const cp = norm(l.row.counterparty)
    if (cp) seen.set(`${l.code}|${cp}`, (seen.get(`${l.code}|${cp}`) ?? 0) + 1)
  }
  const span = [...ctx.months.values()].filter((m) => m.ledgerLines.length).length
  const out: AutoDecision[] = []
  const dup = new Map<string, number>()
  for (const l of lines) {
    let auto: { months: string[]; why: string } | null = periodsFromMemo(String(l.row.memo ?? ''), l.period)
    if (!auto) {
      const cp = norm(l.row.counterparty)
      const text = `${l.name} ${String(l.row.memo ?? '')}`
      const said = ANNUAL_SAID.test(text)
      if (cp && ANNUAL_WORD.test(text) && Math.abs(l.amount) >= 1_000_000 && seen.get(`${l.code}|${cp}`) === 1 && (said || span >= ANNUAL_MIN_MONTHS)) {
        auto = { months: Array.from({ length: 12 }, (_, i) => addMonths(l.period, i)), why: `연납 모양 — ${String(l.row.counterparty)} · ${l.name} · ${said ? '적요에 한 해 치' : `원장 ${span}달 안에 한 번`} · ${won(Math.abs(l.amount))}` }
      }
    }
    if (!auto) continue
    // 같은 내용 줄이 둘이면 열쇠 뒤에 번호.
    const n = (dup.get(l.key) ?? 0) + 1
    dup.set(l.key, n)
    const key = n > 1 ? `${l.key}#${n}`.slice(0, 200) : l.key
    const f = fixes.get(`period|${key}`)
    const months = f?.action === 'month' && f.value?.to && PERIOD.test(f.value.to) ? [f.value.to] : f?.action === 'keep_date' ? [l.period] : auto.months
    const state: AutoDecision['state'] = !f ? 'auto' : f.action === 'keep_date' ? 'off' : 'fixed'
    const sc = plSection(ctx, l.code, l.name)!
    if (state !== 'off' && !(months.length === 1 && months[0] === l.period)) {
      const adj = (p: string, amount: number) => {
        const list = ctx.plAdjust!.get(p) ?? []
        list.push({ code: l.code, name: l.name, section: sc.section, category: sc.category, amount })
        ctx.plAdjust!.set(p, list)
      }
      adj(l.period, -l.amount)
      const each = Math.trunc(l.amount / months.length)
      months.forEach((p, i) => adj(p, i === months.length - 1 ? l.amount - each * (months.length - 1) : each))
    }
    const where = months.length === 1 ? ymKo(months[0]) : `${ymKo(months[0])} ~ ${ymKo(months.at(-1)!)} ${months.length}등분`
    out.push({
      id: `period|${key}`,
      rule: 'period',
      key,
      period: [l.period, ...months].sort()[0],
      periods: [...new Set([l.period, ...months, ...auto.months])],
      title: `${l.name} ${won(Math.abs(l.amount))}${l.row.counterparty ? ` · ${String(l.row.counterparty)}` : ''} — ${state === 'off' ? `전표 날짜(${ymKo(l.period)}) 그대로` : `${ymKo(l.period)} 전표 → ${where}`}`,
      basis: `${auto.why}${l.row.memo && !auto.why.startsWith('적요') ? ` · 적요 «${String(l.row.memo).slice(0, 40)}»` : ''} · 전표 ${String(l.row.tx_date ?? l.period).slice(0, 10)}`,
      state,
      fix: fixOf(f),
      from: l.period,
      months,
    })
  }
  return out
}

/* ───────────────────────── 3 중복 ───────────────────────── */

export function cardKey(r: FinRow, period: string): string {
  return `${period}:${String(r.used_on ?? '').slice(0, 10)}:${num(r.amount)}:${norm(r.merchant).slice(0, 30)}`.slice(0, 200)
}

function duplicateRule(ctx: Ctx, fixes: Map<string, FinAutoFix>): AutoDecision[] {
  const out: AutoDecision[] = []
  const used = new Set<FinRow>()
  for (const [p, m] of [...ctx.months].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!m.card.length) continue
    const near = [addMonths(p, -1), p, addMonths(p, 1)].flatMap((q) => ctx.months.get(q)?.ledgerLines ?? [])
    if (!near.length) continue
    const keep: FinRow[] = []
    const dup = new Map<string, number>()
    for (const c of m.card) {
      const amt = num(c.amount)
      const date = String(c.used_on ?? '')
      const merchant = norm(c.merchant)
      const hit =
        amt && isDate(date)
          ? near.find((l) => {
              if (used.has(l) || !isDate(l.tx_date)) return false
              if (num(l.debit) !== amt && num(l.credit) !== amt) return false
              if (dayDiff(date, String(l.tx_date)) > 3) return false
              const cp = norm(l.counterparty)
              const memo = norm(l.memo)
              if (merchant.length >= 2 && cp.length >= 2 && (cp.includes(merchant) || merchant.includes(cp))) return true
              if (merchant.length >= 2 && memo.includes(merchant)) return true
              return merchant.length >= 2 && Math.max(similar(merchant, cp), similar(merchant, memo)) >= 0.5
            })
          : undefined
      if (!hit) {
        keep.push(c)
        continue
      }
      const base = cardKey(c, p)
      const n = (dup.get(base) ?? 0) + 1
      dup.set(base, n)
      const key = n > 1 ? `${base}#${n}`.slice(0, 200) : base
      const f = fixes.get(`duplicate|${key}`)
      const restored = f?.action === 'restore'
      if (restored) keep.push(c)
      else used.add(hit)
      const same = norm(hit.counterparty) && (norm(hit.counterparty).includes(merchant) || merchant.includes(norm(hit.counterparty))) ? '같은 거래처' : '적요 비슷'
      out.push({
        id: `duplicate|${key}`,
        rule: 'duplicate',
        key,
        period: p,
        periods: [p],
        title: `법인카드 ${date.slice(5, 10)} ${String(c.merchant ?? '')} ${won(amt)} — ${restored ? '되살림(둘 다 셈)' : '원장에 이미 있어 카드 쪽 제외'}`,
        basis: `같은 금액 · 날짜 ${Math.round(dayDiff(date, String(hit.tx_date)))}일 차이 · ${same} — 원장 ${String(hit.tx_date).slice(0, 10)} ${String(hit.account_name ?? hit.account_code ?? '')} ${String(hit.counterparty ?? '')}${hit.memo ? ` «${String(hit.memo).slice(0, 30)}»` : ''}`,
        state: restored ? 'off' : 'auto',
        fix: fixOf(f),
      })
    }
    m.card = keep
  }
  return out
}

/* ───────────────────────── 1 평가 ───────────────────────── */

/** kg당 원가 — 그 달(없으면 앞 달) 장부 원가율 × 출하 단가. 못 구하면 null. */
function unitCost(ctx: Ctx, p: string, m: MonthData): { cost: number; why: string } | null {
  const qty = sumOf(m.shipment, 'qty')
  const amt = sumOf(m.shipment, 'amount')
  for (const q of [p, addMonths(p, -1)]) {
    const accts = plAccountsRaw(ctx, q)
    if (!accts) continue
    const rev = -accts.filter((a) => a.section === 'revenue').reduce((s, a) => s + a.amount, 0)
    const cogs = accts.filter((a) => a.section === 'cogs').reduce((s, a) => s + a.amount, 0)
    if (rev <= 0 || cogs <= 0) continue
    const ratio = cogs / rev
    if (ratio <= 0 || ratio >= 1.5) continue
    if (qty > 0 && amt > 0) return { cost: (amt / qty) * ratio, why: `출하 단가 ${won(amt / qty)} × ${monthKo(q)} 원가율 ${(ratio * 100).toFixed(1)}%` }
    const sq = sumOf(ctx.months.get(q)?.sales ?? [], 'qty')
    if (sq > 0) return { cost: cogs / sq, why: `${monthKo(q)} 매출원가 ÷ 판매 수량` }
  }
  return null
}

function valuationRule(ctx: Ctx, fixes: Map<string, FinAutoFix>): AutoDecision[] {
  const out: AutoDecision[] = []
  const months = [...ctx.months.keys()].sort()
  const resolved = new Map<string, { wip: number | null; finished: number | null; carry: { wip: number; finished: number } }>()
  for (const p of months) {
    const m = ctx.months.get(p)!
    if (!m.valuationKnown) continue
    const prev = resolved.get(addMonths(p, -1))
    const pm = ctx.months.get(addMonths(p, -1))
    const src: { wip: ValSource | null; finished: ValSource | null } = { wip: null, finished: null }
    const from: { wip: string | null; finished: string | null } = { wip: null, finished: null }
    const carry = { wip: 0, finished: 0 }
    for (const cat of ['wip', 'finished'] as const) {
      const name = cat === 'wip' ? '재공품' : '완제품'
      const key = `${p}:${cat}`
      const f = fixes.get(`valuation|${key}`)
      const measured = m.valuation[cat]
      const before = prev?.[cat] ?? null
      let value: number | null = null
      let basis = ''
      // 고친 뒤에 평가 파일(· 화면 입력)이 새로 오면 파일이 이긴다 — «틀리면 파일을 다시 올린다».
      const fileNewer = measured !== null && !!f && !!m.valuationAt && m.valuationAt > f.created_at
      if (f?.action === 'value' && typeof f.value?.amount === 'number' && !fileNewer) {
        value = f.value.amount
        src[cat] = 'manual'
        basis = measured !== null ? `파일 값 ${won(measured)} 대신 사람이 고친 값` : '사람이 고친 값'
      } else if (measured !== null) {
        value = measured
        src[cat] = 'measured'
      } else if (before !== null && (m.production.length || m.shipment.length)) {
        const made = sumOf(m.production, 'qty')
        const shipped = sumOf(m.shipment, 'qty')
        if (cat === 'wip') {
          const madePrev = sumOf(pm?.production ?? [], 'qty')
          if (made > 0 && madePrev > 0) {
            const r = Math.min(2, Math.max(0.5, made / madePrev))
            value = Math.round(before * r)
            basis = `${monthKo(addMonths(p, -1))} 재공품 ${won(before)} × 제조지시 수량 ${made.toLocaleString('ko-KR')} ÷ ${madePrev.toLocaleString('ko-KR')}${r !== made / madePrev ? '(0.5~2배로 묶음)' : ''}`
          }
        } else {
          const u = unitCost(ctx, p, m)
          if (u && (made > 0 || shipped > 0)) {
            value = Math.max(0, Math.round(before + (made - shipped) * u.cost))
            basis = `${monthKo(addMonths(p, -1))} 완제품 ${won(before)} + (제조지시 ${made.toLocaleString('ko-KR')} − 출하 ${shipped.toLocaleString('ko-KR')}) × kg당 원가 ${won(u.cost)}(${u.why})`
          }
        }
        if (value !== null) src[cat] = 'estimated'
      }
      if (value === null && before !== null && (prev?.carry[cat] ?? 0) < 3) {
        value = before
        src[cat] = 'carried'
        from[cat] = ctx.months.get(addMonths(p, -1))?.valuationSource?.[cat] === 'carried' ? (ctx.months.get(addMonths(p, -1))?.valuationFrom?.[cat] ?? addMonths(p, -1)) : addMonths(p, -1)
        carry[cat] = (prev?.carry[cat] ?? 0) + 1
        basis = `${monthKo(p)} 평가 파일 · 제조지시 · 출하 자료가 없어 ${ymKo(from[cat]!)} 값`
      }
      m.valuation[cat] = value
      if (src[cat] && src[cat] !== 'measured') {
        out.push({
          id: `valuation|${key}`,
          rule: 'valuation',
          key,
          period: p,
          periods: [p],
          title: `${ymKo(p)} 말 ${name} ${value === null ? '—' : won(value)} [${VAL_SOURCE_KO[src[cat]!]}]`,
          basis,
          state: src[cat] === 'manual' ? 'fixed' : 'auto',
          fix: fixOf(f),
          value,
        })
      }
    }
    m.valuationSource = src
    m.valuationFrom = from
    resolved.set(p, { wip: m.valuation.wip, finished: m.valuation.finished, carry })
  }
  return out
}

/* ───────────────────────── 모아서 ───────────────────────── */

/**
 * ctx에 자동 판단을 입힌다(제자리 — loadOverview가 만든 ctx는 요청마다 새것). 돌려주는 것 = 정한 것 전부(달마다 고르는 것은 decisionsFor).
 * 순서: 귀속월(손익 조정) → 중복(카드 줄) → 평가(원가율은 조정 전 장부로 — 두 번 세지 않게).
 */
export function applyAuto(ctx: Ctx, fixes: readonly FinAutoFix[]): AutoDecision[] {
  ctx.auto = true
  ctx.plAdjust = new Map()
  const latest = latestFixes(fixes)
  const period = periodRule(ctx, latest)
  const dup = duplicateRule(ctx, latest)
  const val = valuationRule(ctx, latest)
  return [...val, ...period, ...dup]
}

/** 그 달 화면의 «자동으로 정한 것» — 그 달 숫자를 바꾼 판단 + 원금/이자 출처(원장으로 물러선 때). */
export function decisionsFor(ctx: Ctx, all: readonly AutoDecision[], period: string): AutoDecision[] {
  const out = all.filter((d) => d.periods.includes(period))
  if (ctx.auto) {
    const debt = computeDebt(ctx, period)
    if (debt.rows.length && (debt.interestSource === 'ledger' || debt.interestSource === 'estimate')) {
      out.push({
        id: `loan|${period}:interest`,
        rule: 'loan',
        key: `${period}:interest`,
        period,
        periods: [period],
        title: `${ymKo(period)} 이자 ${debt.monthlyInterest === null ? '—' : won(debt.monthlyInterest)} — 출처 ${DEBT_SOURCE_KO[debt.interestSource]}`,
        basis: debt.interestSource === 'ledger' ? '대출현황에 «이자» 열이 없어 계정별 원장의 이자비용을 썼습니다(대출마다 나누지 않음).' : '대출현황에 «이자» 열 · 원장 이자비용이 없어 잔액 × 금리 ÷ 12로 계산했습니다.',
        state: 'auto',
        fix: null,
      })
    }
  }
  const order: Record<AutoRule, number> = { valuation: 0, period: 1, duplicate: 2, loan: 3 }
  return out.sort((a, b) => order[a.rule] - order[b.rule] || a.id.localeCompare(b.id))
}

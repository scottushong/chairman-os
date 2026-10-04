import { isLocked, type OfficialPeriod } from '@/lib/statements/period'

import type { ExistingAccount } from './accounts-import'
import { ledgerSign } from './annual-import'
import { MONTH_KEYS, type EcountMapping, type SheetLike } from './mapping'
import {
  addToSums,
  emptySums,
  figureChecks,
  matchLines,
  readStatementLines,
  type AmountsPreview,
  type FigureCheck,
  type PreviewLine,
  type StatementLine,
} from './statement-lines'

/**
 * ③ 월별 손익 미리보기 · 등록 재료. 등록은 0052 ecount_monthly_import(달마다 요약 전표 + 대응 한 줄 · 재업로드는 정정 전표).
 *
 * 판정(설계서 B-③):
 *   차단  마감된 달 · 세무사 확정이 덮은 달 · 계정 매칭 실패 · 숫자 오류 · 행 합 ≠ 합계 열 · 파일 이익 줄과 계산 불일치 ·
 *         누계인데 1월부터 빈 달 없이 이어지지 않음 · 재무상태표 계정 · 비활성 계정 · 한 계정에 줄 둘 · 대응 계정 줄
 *         (뒤의 넷은 0052 RPC도 거부한다 — 미리보기에서 먼저 막는다)
 *   경고  그 달에 수기 전표가 이미 있음(두 번 셀 수 있다)
 * **누계(YTD)는 당월로 바꾼다** — 앞 달 누계를 뺀다(1월은 그대로). 합계 열 대조는 바꾸기 전 파일 값으로 한다
 * (누계 파일의 합계 열은 마지막 달 누계와 같아야 한다).
 */

/**
 * 대응 계정 — 손익만으로는 전표가 닫히지 않아 그 달 순이익만큼 한 줄을 세운다(0052 ecount_monthly_import가 없으면 만든다).
 * equity(현금 · 채권 · 채무 KPI를 안 건드린다) · cash_flow operating(현금흐름표에서 순이익을 되돌려 현금 증감 0).
 * 코드는 DB ecount_monthly_counter_code()와 같아야 한다(check-migrations가 대조).
 */
export const ECOUNT_MONTHLY_COUNTER = { code: 'ECOUNT-PL', name: 'ECOUNT 월별손익 대응' } as const

export interface MonthlyContext {
  accounts: readonly ExistingAccount[]
  /** 그 회사의 마지막 마감 달('YYYY-MM') — 그 달과 앞선 달은 받지 않는다(0016 closed_period와 같은 판정) */
  lastClosed: string | null
  /** 그 회사의 활성 공식 결산(세무사 확정) — 덮은 달은 받지 않는다 */
  officials: readonly OfficialPeriod[]
  /** 그 회사에 수기 전표가 이미 있는 달들('YYYY-MM') */
  journalMonths: readonly string[]
}

/** 누계 → 당월. 빈 칸은 빈 칸으로 두고(그 달 자료 없음), 다음 달은 마지막으로 보인 누계를 뺀다. 1월은 그대로. */
export function ytdToMonthly(values: readonly (number | null)[]): (number | null)[] {
  let prev = 0
  return values.map((v) => {
    if (v === null) return null
    const m = v - prev
    prev = v
    return m === 0 ? 0 : m
  })
}

const won = (v: number) => `${v.toLocaleString('ko-KR')}원`

const BALANCE_SECTIONS: readonly string[] = ['cash', 'receivable', 'other_asset', 'payable', 'other_liability', 'equity']

export function planMonthly(sheets: readonly SheetLike[], mapping: EcountMapping, ctx: MonthlyContext): AmountsPreview {
  const blocks: string[] = []
  const warnings: string[] = []
  const part = mapping.parts[0]
  const sheet = part ? sheets.find((s) => s.name === part.sheet) : undefined
  const monthKeys = MONTH_KEYS.filter((k) => part?.columns[k] !== undefined)
  const hasTotal = part?.columns.total !== undefined
  const ytd = mapping.basis === 'ytd'

  let all: StatementLine[] = []
  if (sheet && part) all = readStatementLines(sheet, part, mapping.unit, hasTotal ? [...monthKeys, 'total'] : monthKeys)
  if (!mapping.year) blocks.push('몇 년도 자료인지 정하지 않았습니다')

  // 누계는 1월부터 빈 달 없이 이어져야 당월로 바꿀 수 있다 — 3월 누계 − 1월 누계는 2·3월 두 달 치다.
  const contiguous = monthKeys.every((k, i) => k === MONTH_KEYS[i])
  if (ytd && !contiguous) blocks.push('누계 자료는 1월부터 빈 달 없이 월 열을 지정해야 당월로 바꿀 수 있습니다')

  // 합계 열 대조 — 바꾸기 전 파일 값으로. 당월이면 달의 합, 누계면 마지막 달 누계와 같아야 한다.
  const totalProblem = new Map<StatementLine, string>()
  if (hasTotal) {
    for (const l of all) {
      const total = l.amounts.total
      if (total === null || l.errors.total) continue
      const vals = monthKeys.map((k) => l.amounts[k])
      const expected = ytd ? ([...vals].reverse().find((v) => v !== null) ?? 0) : vals.reduce<number>((a, v) => a + (v ?? 0), 0)
      if (expected !== total) {
        const what = ytd ? '마지막 달 누계' : '달의 합'
        totalProblem.set(l, `${what} ${won(expected)} ≠ 합계 열 ${won(total)} (차액 ${won(total - expected)})`)
      }
    }
  }

  // 누계 → 당월(실을 줄 · 이익 줄 모두 — 이익 줄도 누계로 왔다).
  const converted = ytd && contiguous
  if (converted) {
    all = all.map((l) => {
      const m = ytdToMonthly(monthKeys.map((k) => l.amounts[k]))
      return { ...l, amounts: { ...l.amounts, ...Object.fromEntries(monthKeys.map((k, i) => [k, m[i]])) } }
    })
  }
  // totalProblem의 키를 바꾼 줄로 옮긴다(같은 행 번호).
  const totalByRow = new Map([...totalProblem].map(([l, p]) => [`${l.sheet}:${l.rowNo}`, p]))

  const { matched, others } = matchLines(all, monthKeys, ctx.accounts)
  for (const l of matched) {
    const p = totalByRow.get(`${l.sheet}:${l.rowNo}`)
    if (p) l.blocks.push(p)
  }
  // 0052 RPC가 거부하는 줄 — 등록 단계에서 처음 알게 하지 않는다.
  const byCode = new Map<string, number[]>()
  for (const l of matched) if (l.account) byCode.set(l.account.code, [...(byCode.get(l.account.code) ?? []), l.rowNo])
  for (const l of matched) {
    if (!l.account) continue
    const rows = byCode.get(l.account.code)!
    if (rows.length > 1) l.blocks.push(`계정 ${l.account.code}에 줄이 ${rows.length}개(${rows.join(' · ')}행) 맞았습니다 — 한 계정은 한 줄만 싣습니다`)
    if (BALANCE_SECTIONS.includes(l.account.section)) l.blocks.push(`재무상태표 계정 ${l.account.code}입니다 — 월별 업로드는 손익 계정만 싣습니다`)
    if (!l.account.active) l.blocks.push(`비활성 계정 ${l.account.code}입니다 — 장부가 받지 않습니다(계정과목에서 다시 쓰기로 바꾸거나 열 지정을 고치세요)`)
    if (l.account.code === ECOUNT_MONTHLY_COUNTER.code) l.blocks.push(`${ECOUNT_MONTHLY_COUNTER.name} 계정에는 금액을 싣지 않습니다 — 등록이 그 달 순이익만큼 자동으로 세웁니다`)
  }
  for (const o of others) {
    const p = totalByRow.get(`${o.sheet}:${o.rowNo}`)
    if (p) warnings.push(`${o.rowNo}행 «${o.name}»: ${p}`)
    if (o.kind === 'subtotal' && monthKeys.some((k) => o.amounts[k] !== null)) warnings.push(`${o.rowNo}행 «${o.name}»은 묶음(소계)으로 보고 싣지 않습니다`)
  }

  // 달마다 — 마감 · 확정 · 수기 전표 · 이익 줄 대조
  const unmatched = matched.some((l) => !l.account)
  if (unmatched) warnings.push('계정을 다 맞춘 뒤에 이익 줄과 대조합니다')
  const checks: FigureCheck[] = []
  monthKeys.forEach((k, i) => {
    const month = mapping.year ? `${mapping.year}-${k.slice(1)}` : null
    const used = matched.some((l) => (l.amounts[i] ?? 0) !== 0)
    if (month && used) {
      if (ctx.lastClosed && month <= ctx.lastClosed) blocks.push(`${month}은 마감된 달입니다 — 받지 않습니다(고칠 것은 당월 정정 전표로)`)
      else if (isLocked(month, [...ctx.officials])) blocks.push(`${month}은 세무사 확정 결산이 덮은 달입니다 — 받지 않습니다`)
      if (ctx.journalMonths.includes(month)) warnings.push(`${month}에 수기 전표가 이미 있습니다 — 등록하면 두 번 셀 수 있습니다`)
    }
    if (unmatched) return
    const sums = emptySums()
    for (const l of matched) if (l.account && l.amounts[i] !== null) addToSums(sums, l.account.section, l.src, l.amounts[i]!)
    checks.push(...figureChecks(others, k, sums, (l) => l.amounts[k]))
  })
  for (const c of checks) {
    if (c.diff !== 0) blocks.push(`${Number(c.key.slice(1))}월 ${c.label}(${c.rowNo}행): 파일 ${won(c.file)} · 계산 ${won(c.computed)} (차액 ${won(c.diff)})`)
  }
  if (matched.length === 0) blocks.push('실을 금액 줄이 없습니다 — 열 지정(과목명 · 월 열)을 확인하세요')

  const lines = matched.map((m) => {
    const { src, ...l } = m
    void src
    return l
  })
  return {
    kind: 'monthly',
    year: mapping.year,
    unit: mapping.unit,
    basis: mapping.basis,
    converted,
    keys: [...monthKeys],
    lines,
    others: others.map((o) => ({ sheet: o.sheet, rowNo: o.rowNo, name: o.name, kind: o.kind, amounts: monthKeys.map((k) => o.amounts[k]) })),
    checks,
    blocks,
    warnings,
    blockCount: blocks.length + lines.reduce((n, l) => n + l.blocks.length, 0),
    warningCount: warnings.length + lines.reduce((n, l) => n + l.warnings.length, 0),
  }
}

/** 0052 ecount_monthly_import의 p_months 한 칸 — 그 달 손익 줄(당월 금액 · 원장 규약 차변 − 대변). 대응 줄은 DB가 세운다. */
export interface MonthlyLedgerMonth {
  month: string
  lines: { account_code: string; amount: number }[]
}

/**
 * 월별 등록 줄 — **막힌 줄이 하나라도 있으면 던진다**(부르는 쪽이 먼저 본다). 금액은 planMonthly가 이미 당월로 바꾼 값이다
 * (누계면 ytdToMonthly). 원장 부호는 연간과 같은 ledgerSign(수익 −, 비용 +, 영업외는 소속 머리). 0원 줄은 빼고,
 * 금액 있는 줄이 하나도 없는 달은 보내지 않는다 — 그 달은 손대지 않는다(앞 업로드가 있으면 그대로 남는다).
 */
export function monthlyLedgerMonths(preview: Pick<AmountsPreview, 'kind' | 'year' | 'keys' | 'blockCount' | 'lines'>): MonthlyLedgerMonth[] {
  if (preview.kind !== 'monthly') throw new Error('monthlyLedgerMonths: 월별 미리보기가 아니다')
  if (preview.blockCount > 0) throw new Error('monthlyLedgerMonths: 막힌 줄이 있다')
  if (!preview.year) throw new Error('monthlyLedgerMonths: 해가 없다')
  return preview.keys.flatMap((k, i) => {
    const lines = preview.lines.flatMap((l: PreviewLine) => {
      const v = l.amounts[i]
      if (!l.account || v === null || v === 0) return []
      const amount = ledgerSign(l.account.section, l.nonOp) * v
      return amount === 0 ? [] : [{ account_code: l.account.code, amount }]
    })
    return lines.length ? [{ month: `${preview.year}-${k.slice(1)}`, lines }] : []
  })
}

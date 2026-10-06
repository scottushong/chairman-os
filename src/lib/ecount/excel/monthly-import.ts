import { isLocked, type OfficialPeriod } from '@/lib/statements/period'

import type { ExistingAccount } from './accounts-import'
import { ledgerSign } from './annual-import'
import { findPeriod } from './detect'
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
  /**
   * 그 회사의 **활성 업로드 전표**(finance_import_slips) — 달('YYYY-MM') → 전표 번호. 이 파일이 그 달을 말하는데 금액이 없으면
   * 등록이 **그 전표**를 역분개한다(0056 — 번호를 DB로 같이 보내 그 사이 바뀌었으면 import_changed). 주지 않으면 빈 달은 «손댈 것 없음».
   */
  uploadSlips?: Readonly<Record<string, string>>
}

/** 역분개할 달 하나 — 미리보기 때 본 그 달의 활성 업로드 전표(0056 리뷰 I-2). */
export interface MonthlyReversal {
  month: string
  slip_no: string
}

/** 역분개 목록을 대조용 글로(달 순). 미리보기 · 사람의 확인 · 등록 때 다시 만든 것이 같아야 한다. */
export function reversalKey(list: readonly MonthlyReversal[] | undefined): string {
  return [...(list ?? [])].map((r) => `${r.month}:${r.slip_no}`).sort().join(',')
}

/**
 * 파일이 **말하는 달**(0056 · 리뷰 I-1) — 계정 줄 중 하나라도 금액 칸(0 포함)이 찬 **첫 달부터 마지막 달까지**, 그리고
 * inPeriod(머리의 «YYYY/MM/DD ~ YYYY/MM/DD» 기간)가 있으면 그 안만. 그 안에서 금액이 하나도 없는 달이 «금액 없는 달»이다
 * (ECOUNT는 0을 빈 칸으로 둔다 — 누계는 ytdToMonthly가 이미 0으로 바꿨다). 첫 달 앞(예: 3분기 파일의 1~6월 빈 열) ·
 * 마지막 달 뒤(아직 안 온 달) · 기간 밖은 «자료 없음» — 등록이 손대지 않는다.
 */
export function spokenMonthIndexes(
  lines: readonly Pick<PreviewLine, 'amounts'>[],
  monthCount: number,
  inPeriod: (i: number) => boolean = () => true,
): number[] {
  const filled = (i: number) => lines.some((l) => l.amounts[i] !== null && l.amounts[i] !== undefined)
  let first = -1
  let last = -1
  for (let i = 0; i < monthCount; i += 1) {
    if (!filled(i)) continue
    if (first < 0) first = i
    last = i
  }
  if (first < 0) return []
  return Array.from({ length: last - first + 1 }, (_, k) => first + k).filter(inPeriod)
}

/**
 * 누계 → 당월. 앞 달 누계를 뺀다(1월은 그대로).
 * reported(달마다 «파일이 그 달을 말하는가» — 0052 리뷰): 파일이 말하는 달 안의 빈 칸은 **누계 0**이다(ECOUNT 누계표는 0을 비워 둔다).
 * 그래서 «1월 100 · 2월 빈 칸 · 3월 50»은 +100 · −100 · +50이고, 11월까지 100 · 12월 빈 칸이면 12월은 −100(한 해 합 0)이다.
 * 파일이 아예 말하지 않는 달(열 전체가 빈 칸 — 아직 안 온 달)만 빈 칸(null)으로 남는다. reported를 주지 않으면 빈 칸은 모두 «자료 없음».
 */
export function ytdToMonthly(values: readonly (number | null)[], reported?: readonly boolean[]): (number | null)[] {
  let prev = 0
  return values.map((raw, i) => {
    const v = raw === null && reported?.[i] ? 0 : raw
    if (v === null) return null
    const m = v - prev
    prev = v
    return m === 0 ? 0 : m
  })
}

/** 누계 파일이 말하는 달 — 계정 줄(합계 · 소계 · 이익 줄 말고) 중 하나라도 그 달 칸이 차 있으면(오류 칸 포함) 말한다. */
export function reportedMonths(lines: readonly StatementLine[], monthKeys: readonly string[]): boolean[] {
  return monthKeys.map((k) => lines.some((l) => l.kind === 'line' && (l.amounts[k] !== null || !!l.errors[k])))
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

  // 누계 파일이 말하는 달 — 그 안의 빈 칸은 누계 0(ytdToMonthly).
  const reported = reportedMonths(all, monthKeys)
  const lastReported = reported.lastIndexOf(true)
  // 리뷰 m-1: 누계인데 말하는 달 **사이**의 열이 통째로 비었다 — 그 달 누계를 알 수 없다(0으로 보면 다음 달이 두 달 치를 뺀다).
  if (ytd) {
    const firstReported = reported.indexOf(true)
    const holes = monthKeys.filter((_, i) => i > firstReported && i < lastReported && !reported[i])
    if (firstReported >= 0 && holes.length) {
      blocks.push(`누계 자료의 ${holes.map((k) => `${Number(k.slice(1))}월`).join(' · ')} 열이 통째로 비어 있습니다 — 그 달 누계를 알 수 없어 당월로 바꾸지 않습니다(ECOUNT에서 그 달까지 다시 내려받으세요)`)
    }
  }
  // 리뷰 I-1: 머리의 기간(«2025/07/01 ~ 2025/09/30»)이 있으면 그 밖의 달은 이 파일이 말하지 않는 달이다.
  const period = sheet ? (findPeriod(sheet.rows)?.value ?? null) : null

  // 합계 열 대조 — 바꾸기 전 파일 값으로. 당월이면 달의 합, 누계면 마지막으로 말한 달의 누계(빈 칸 = 0)와 같아야 한다.
  const totalProblem = new Map<StatementLine, string>()
  if (hasTotal) {
    for (const l of all) {
      const total = l.amounts.total
      if (total === null || l.errors.total) continue
      const vals = monthKeys.map((k) => l.amounts[k])
      const expected = ytd ? (lastReported < 0 ? 0 : (vals[lastReported] ?? 0)) : vals.reduce<number>((a, v) => a + (v ?? 0), 0)
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
      const m = ytdToMonthly(monthKeys.map((k) => l.amounts[k]), reported)
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
  const monthOf = (k: string) => (mapping.year ? `${mapping.year}-${k.slice(1)}` : null)
  const inPeriod = (i: number) => {
    const month = monthOf(monthKeys[i])
    return !period || !month || (month >= period.from.slice(0, 7) && month <= period.to.slice(0, 7))
  }
  const spoken = new Set(spokenMonthIndexes(matched, monthKeys.length, inPeriod))
  const reversals: MonthlyReversal[] = []
  monthKeys.forEach((k, i) => {
    const month = mapping.year ? `${mapping.year}-${k.slice(1)}` : null
    const used = matched.some((l) => (l.amounts[i] ?? 0) !== 0)
    if (month && used) {
      if (ctx.lastClosed && month <= ctx.lastClosed) blocks.push(`${month}은 마감된 달입니다 — 받지 않습니다(고칠 것은 당월 정정 전표로)`)
      else if (isLocked(month, [...ctx.officials])) blocks.push(`${month}은 세무사 확정 결산이 덮은 달입니다 — 받지 않습니다`)
      if (ctx.journalMonths.includes(month)) warnings.push(`${month}에 수기 전표가 이미 있습니다 — 등록하면 두 번 셀 수 있습니다`)
    }
    // 0056: 파일이 말하는데 금액이 없는 달 + 지난 업로드 전표 → 등록이 그 전표를 역분개한다(0052까지는 옛 전표가 남았다).
    const prevSlip = month ? ctx.uploadSlips?.[month] : undefined
    if (month && !used && spoken.has(i) && prevSlip) {
      if (ctx.lastClosed && month <= ctx.lastClosed) {
        blocks.push(`${month}은 이 파일에 금액이 없지만 마감된 달이라 지난 업로드 전표를 되돌리지 않습니다 — 고칠 것은 당월 정정 전표로`)
      } else if (isLocked(month, [...ctx.officials])) {
        blocks.push(`${month}은 이 파일에 금액이 없지만 세무사 확정 결산이 덮은 달이라 지난 업로드 전표를 되돌리지 않습니다`)
      } else {
        reversals.push({ month, slip_no: prevSlip })
        warnings.push(`${month}은 이 파일에 금액이 없습니다 — 등록하면 지난 업로드 전표 ${prevSlip}를 역분개합니다(그 달 손익 0 · 등록 전에 확인 필요)`)
      }
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
    reversals,
    blockCount: blocks.length + lines.reduce((n, l) => n + l.blocks.length, 0),
    warningCount: warnings.length + lines.reduce((n, l) => n + l.warnings.length, 0),
  }
}

/**
 * 0052 ecount_monthly_import의 p_months 한 칸 — 그 달 손익 줄(당월 금액 · 원장 규약 차변 − 대변). 대응 줄은 DB가 세운다.
 * lines = [] 는 «파일이 말하는데 금액이 없는 달»(0056) — reverses(미리보기 때 본 그 달 활성 업로드 전표)를 DB가 역분개한다.
 * 지금 활성 전표가 reverses와 다르면(그 사이 남이 등록 · 정정) DB가 import_changed로 거부한다(리뷰 I-2).
 */
export interface MonthlyLedgerMonth {
  month: string
  lines: { account_code: string; amount: number }[]
  /** 빈 달만 — 되돌릴 전표 번호 */
  reverses?: string
}

/**
 * 월별 등록 줄 — **막힌 줄이 하나라도 있으면 던진다**(부르는 쪽이 먼저 본다). 금액은 planMonthly가 이미 당월로 바꾼 값이다
 * (누계면 ytdToMonthly). 원장 부호는 연간과 같은 ledgerSign(수익 −, 비용 +, 영업외는 소속 머리). 0원 줄은 뺀다.
 * 금액 없는 달은 **미리보기가 역분개할 달로 적은 것(reversals — 파일이 말하는 달 + 지난 업로드 전표 있음)만** 빈 달(lines = [])로
 * 보낸다 — DB가 그 전표를 역분개한다(0056). 지난 업로드가 없는 빈 달 · 말하지 않는 달(마지막으로 금액 칸이 찬 달 뒤)은 보내지 않는다
 * (손댈 것이 없다 — 0056 전 DB에 빈 달을 보내면 ecount_plan_invalid라 꼭 필요한 달만 보낸다).
 */
export function monthlyLedgerMonths(
  preview: Pick<AmountsPreview, 'kind' | 'year' | 'keys' | 'blockCount' | 'lines' | 'reversals'>,
): MonthlyLedgerMonth[] {
  if (preview.kind !== 'monthly') throw new Error('monthlyLedgerMonths: 월별 미리보기가 아니다')
  if (preview.blockCount > 0) throw new Error('monthlyLedgerMonths: 막힌 줄이 있다')
  if (!preview.year) throw new Error('monthlyLedgerMonths: 해가 없다')
  const reversals = new Map((preview.reversals ?? []).map((r) => [r.month, r.slip_no]))
  return preview.keys.flatMap((k, i): MonthlyLedgerMonth[] => {
    const month = `${preview.year}-${k.slice(1)}`
    const lines = preview.lines.flatMap((l: PreviewLine) => {
      const v = l.amounts[i]
      if (!l.account || v === null || v === 0) return []
      const amount = ledgerSign(l.account.section, l.nonOp) * v
      return amount === 0 ? [] : [{ account_code: l.account.code, amount }]
    })
    if (lines.length) return [{ month, lines }]
    const reverses = reversals.get(month)
    return reverses ? [{ month, lines: [], reverses }] : []
  })
}

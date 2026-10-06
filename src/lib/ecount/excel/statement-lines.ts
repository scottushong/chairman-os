import { ACCOUNT_CODE_PATTERN } from '@/lib/ledger/accounts'
import type { AccountSection } from '@/types'

import type { ExistingAccount } from './accounts-import'
import { cellAmount, cellText, type EcountCell, type EcountUnit } from './cells'
import { classifyRowLabel, normalizeLabel, type RowKind } from './detect'
import type { MonthlyBasis, SheetLike, SheetPart } from './mapping'

/**
 * ② 연간 · ③ 월별 공통 — 금액 줄 읽기 · 계정 맞추기 · 합계 대조. 순수 함수(브라우저와 서버가 같이 본다).
 *
 * 줄 종류는 detect.ts classifyRowLabel이 정한다(로마숫자 머리 · 합계 · 소계 · 이익 줄). 여기서 더하는 판단 둘:
 *   1. **혼자 선 머리는 계정 줄이다** — K-GAAP 손익계산서의 «Ⅷ. 법인세비용»은 아래 줄 없이 금액을 단다.
 *   2. **계정과 안 맞는 묶음 이름은 소계다** — «(1) 당좌자산»은 번호를 걷으면 보통 줄처럼 보이지만 계정이 아니다.
 *      장부에 같은 이름의 계정이 있으면(«유형자산») 계정 줄로 둔다.
 * 실을 줄(line)만 계정에 맞추고, 합계 · 이익 · 머리 줄은 «파일이 말하는 합계»로 계산과 대조한다.
 */

export interface StatementLine {
  sheet: string
  /** 엑셀 행 번호(1부터) */
  rowNo: number
  /** 번호를 걷은 이름(classifyRowLabel) */
  name: string
  code: string
  kind: RowKind
  /** 이 줄이 속한 로마숫자 머리의 이름(영업외수익 · 영업외비용 판별에 쓴다) */
  heading: string | null
  /** 금액 열 이름 → 원 단위 금액(빈 칸 null) */
  amounts: Record<string, number | null>
  /** 금액 열 이름 → 못 읽은 이유 */
  errors: Record<string, string>
}

function codeOf(cell: EcountCell | undefined): string {
  if (!cell) return ''
  return cell.t === 'number' ? String(cell.v) : cellText(cell).trim()
}

/** 머리글 아래 줄을 읽는다. 이름 · 코드 · 금액이 다 빈 줄은 건너뛴다. 단위를 곱한다. */
export function readStatementLines(sheet: SheetLike, part: SheetPart, unit: EcountUnit, keys: readonly string[]): StatementLine[] {
  const out: StatementLine[] = []
  let heading: string | null = null
  const col = (row: EcountCell[], key: string) => (part.columns[key] === undefined ? undefined : row[part.columns[key]])
  for (let r = part.headerRow + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r]
    const rawName = cellText(col(row, 'name'))
    const code = codeOf(col(row, 'code'))
    const amounts: Record<string, number | null> = {}
    const errors: Record<string, string> = {}
    let any = false
    for (const k of keys) {
      const cell = col(row, k)
      if (cell && cell.t !== 'empty') any = true
      const a = cellAmount(cell, unit)
      if (a.ok) amounts[k] = a.value
      else {
        amounts[k] = null
        errors[k] = a.reason
      }
    }
    if (!rawName.trim() && !code && !any) continue
    const label = classifyRowLabel(rawName)
    let kind: RowKind = label.kind === 'blank' ? (code ? 'line' : 'blank') : label.kind
    // «Ⅲ. 매출총이익» · «Ⅹ. 당기순이익» — 로마숫자가 붙은 이익 · 합계 줄은 머리가 아니라 이익 · 합계 줄이다.
    let name = label.name
    if (kind === 'heading') {
      const inner = classifyRowLabel(label.name)
      if (inner.kind === 'profit' || inner.kind === 'total') {
        kind = inner.kind
        name = inner.name
      }
    }
    if (kind === 'blank') continue
    if (kind === 'heading') heading = name
    out.push({ sheet: sheet.name, rowNo: r + 1, name, code, kind, heading, amounts, errors })
  }
  // 혼자 선 머리(아래 계정 줄 없이 다음 머리 · 이익 · 합계 · 끝이 오는 머리)에 금액이 있으면 계정 줄이다.
  for (let i = 0; i < out.length; i += 1) {
    const l = out[i]
    if (l.kind !== 'heading') continue
    const next = out[i + 1]
    const lone = !next || next.kind === 'heading' || next.kind === 'profit' || next.kind === 'total'
    if (lone && keys.some((k) => l.amounts[k] !== null || l.errors[k])) l.kind = 'line'
  }
  return out
}

// ---------------------------------------------------------------- 계정 맞추기

/** 계정이 아니라 묶음(소계)일 때가 많은 이름 — 장부에 같은 이름 계정이 없을 때만 소계로 본다. */
const GROUP_NAMES = new Set(
  [
    '자산', '유동자산', '비유동자산', '당좌자산', '재고자산', '투자자산', '유형자산', '무형자산', '기타비유동자산',
    '부채', '유동부채', '비유동부채', '자본', '자본잉여금', '이익잉여금', '자본조정', '기타포괄손익누계액',
    '매출액', '매출원가', '판매비와관리비', '영업외수익', '영업외비용', '제조원가', '당기제품제조원가',
  ].map(normalizeLabel),
)

export interface LineMatch {
  account: { code: string; name: string; section: AccountSection; active: boolean } | null
  /** pick = 이름이 계정 둘 이상과 맞아 사람이 고른 것(연간) */
  how: 'code' | 'name' | 'pick' | null
  problem: string | null
  /** 이름이 계정 둘 이상과 맞았을 때 그 후보들(코드 · 이름) — 연간 미리보기가 줄마다 고르게 한다 */
  candidates?: { code: string; name: string }[]
}

/**
 * 줄 → 그 회사 계정. 코드 열이 있으면 코드로, 없거나 비면 이름(정규화 뒤 정확히 같은 것)으로.
 * 이름이 둘 이상 맞으면 모호 — 사람이 계정코드 열을 지정하거나 이름을 고쳐야 한다(설계서 «모호하면 사람이 고름»은 DEFERRED).
 */
export function matchAccount(line: Pick<StatementLine, 'code' | 'name'>, accounts: readonly ExistingAccount[]): LineMatch {
  const pick = (a: ExistingAccount) => ({ code: a.account_code, name: a.name, section: a.section, active: a.active })
  if (line.code) {
    const a = accounts.find((x) => x.account_code === line.code)
    if (a) return { account: pick(a), how: 'code', problem: null }
  }
  const key = normalizeLabel(line.name)
  const hits = key ? accounts.filter((a) => normalizeLabel(a.name) === key) : []
  if (hits.length === 1) return { account: pick(hits[0]), how: 'name', problem: null }
  if (hits.length > 1) {
    return {
      account: null,
      how: null,
      problem: `이름 «${line.name}»이 계정 ${hits.length}개(${hits.map((h) => h.account_code).join(' · ')})와 맞습니다 — 계정코드 열을 지정하세요`,
      candidates: hits.map((h) => ({ code: h.account_code, name: h.name })),
    }
  }
  if (line.code) return { account: null, how: null, problem: `계정코드 ${line.code}(«${line.name}»)가 장부에 없습니다 — 계정과목을 먼저 올리세요` }
  return { account: null, how: null, problem: `장부에 «${line.name}» 계정이 없습니다 — 계정과목을 먼저 올리거나 계정코드 열을 지정하세요` }
}

export function isGroupName(name: string): boolean {
  return GROUP_NAMES.has(normalizeLabel(name))
}

// ---------------------------------------------------------------- 합계 대조

/** 영업외 줄이 수익인가 비용인가 — 소속 머리가 먼저, 없으면 이름. */
export function nonOpDirection(line: Pick<StatementLine, 'heading' | 'name'>): 'income' | 'expense' {
  const h = normalizeLabel(line.heading ?? '')
  if (/영업외비용|영업외손실/.test(h)) return 'expense'
  if (/영업외수익|영업외이익/.test(h)) return 'income'
  return /비용|손실|차손|기부금/.test(line.name) ? 'expense' : 'income'
}

export interface SectionSums {
  asset: number
  liability: number
  equity: number
  revenue: number
  cogs: number
  sga: number
  nonOpIncome: number
  nonOpExpense: number
  tax: number
  hasBs: boolean
  hasPl: boolean
}

export function emptySums(): SectionSums {
  return { asset: 0, liability: 0, equity: 0, revenue: 0, cogs: 0, sga: 0, nonOpIncome: 0, nonOpExpense: 0, tax: 0, hasBs: false, hasPl: false }
}

/** 맞춘 계정의 구분으로 더한다 — 금액은 파일에 보인 그대로(자산 · 비용 +, 차감 계정은 파일이 음수로 적었을 때만 뺀다). */
export function addToSums(s: SectionSums, section: AccountSection, line: Pick<StatementLine, 'heading' | 'name'>, v: number) {
  switch (section) {
    case 'cash':
    case 'receivable':
    case 'other_asset':
      s.asset += v
      s.hasBs = true
      return
    case 'payable':
    case 'other_liability':
      s.liability += v
      s.hasBs = true
      return
    case 'equity':
      s.equity += v
      s.hasBs = true
      return
    case 'revenue':
      s.revenue += v
      break
    case 'cogs':
      s.cogs += v
      break
    case 'sga':
    case 'd_and_a':
      s.sga += v
      break
    case 'non_operating':
      if (nonOpDirection(line) === 'expense') s.nonOpExpense += v
      else s.nonOpIncome += v
      break
    case 'tax':
      s.tax += v
      break
  }
  s.hasPl = true
}

/** 파일의 합계 · 이익 · 머리 줄 이름 → 계산식. 손실 꼴(«영업손실»)은 부호를 뒤집어 잰다. */
const FIGURES: { names: string[]; label: string; bs: boolean; calc: (s: SectionSums) => number; loss?: string[] }[] = [
  { names: ['자산총계'], label: '자산총계', bs: true, calc: (s) => s.asset },
  { names: ['부채총계'], label: '부채총계', bs: true, calc: (s) => s.liability },
  { names: ['자본총계'], label: '자본총계', bs: true, calc: (s) => s.equity },
  { names: ['부채와자본총계', '부채및자본총계', '부채와자본의총계'], label: '부채와자본총계', bs: true, calc: (s) => s.liability + s.equity },
  { names: ['매출액'], label: '매출액', bs: false, calc: (s) => s.revenue },
  { names: ['매출원가'], label: '매출원가', bs: false, calc: (s) => s.cogs },
  { names: ['매출총이익'], loss: ['매출총손실'], label: '매출총이익', bs: false, calc: (s) => s.revenue - s.cogs },
  { names: ['판매비와관리비'], label: '판매비와관리비', bs: false, calc: (s) => s.sga },
  { names: ['영업이익'], loss: ['영업손실'], label: '영업이익', bs: false, calc: (s) => s.revenue - s.cogs - s.sga },
  { names: ['영업외수익'], label: '영업외수익', bs: false, calc: (s) => s.nonOpIncome },
  { names: ['영업외비용'], label: '영업외비용', bs: false, calc: (s) => s.nonOpExpense },
  {
    names: ['법인세비용차감전순이익', '법인세차감전순이익'],
    loss: ['법인세비용차감전순손실', '법인세차감전순손실'],
    label: '법인세비용차감전순이익',
    bs: false,
    calc: (s) => s.revenue - s.cogs - s.sga + s.nonOpIncome - s.nonOpExpense,
  },
  { names: ['당기순이익'], loss: ['당기순손실'], label: '당기순이익', bs: false, calc: (s) => s.revenue - s.cogs - s.sga + s.nonOpIncome - s.nonOpExpense - s.tax },
]

export interface FigureCheck {
  sheet: string
  rowNo: number
  label: string
  /** 금액 열(연간 'amount' · 월별 'm01'…) */
  key: string
  file: number
  computed: number
  diff: number
}

/**
 * 파일이 말하는 합계(자산총계 · 영업이익 · 당기순이익 · 머리 줄 «Ⅰ. 매출액» 금액 …)를 맞춘 계정의 합과 대조한다.
 * 계정 줄(line)이 아닌 줄만 본다. 그 표(재무상태표/손익계산서)에 실을 줄이 없으면 대조하지 않는다.
 */
export function figureChecks(
  others: readonly StatementLine[],
  key: string,
  sums: SectionSums,
  amountOf: (l: StatementLine) => number | null,
): FigureCheck[] {
  const out: FigureCheck[] = []
  for (const l of others) {
    if (l.kind === 'line' || l.kind === 'blank') continue
    const n = normalizeLabel(l.name)
    const f = FIGURES.find((x) => x.names.includes(n) || x.loss?.includes(n))
    if (!f || (f.bs ? !sums.hasBs : !sums.hasPl)) continue
    const raw = amountOf(l)
    if (raw === null) continue
    // «영업손실 300»은 영업이익 −300이다. «영업이익(손실) (300)»은 이미 음수로 왔다.
    const file = f.loss?.includes(n) && raw > 0 ? -raw : raw
    const computed = f.calc(sums)
    out.push({ sheet: l.sheet, rowNo: l.rowNo, label: f.label, key, file, computed, diff: file - computed })
  }
  return out
}

// ---------------------------------------------------------------- 미리보기 모양(화면과 서버가 같이 쓴다)

export interface PreviewLine {
  sheet: string
  rowNo: number
  name: string
  code: string
  account: LineMatch['account']
  how: LineMatch['how']
  /** 이름이 계정 둘 이상과 맞은 줄 — 사람이 고를 후보(연간만). 고른 값은 picks[pickKey(줄)]로 온다 */
  candidates?: { code: string; name: string }[]
  /** 영업외 계정이면 수익 쪽인가 비용 쪽인가(소속 머리 · 이름) — 연간 등록의 부호가 이것으로 갈린다 */
  nonOp?: 'income' | 'expense'
  /** keys와 같은 순서 */
  amounts: (number | null)[]
  blocks: string[]
  warnings: string[]
}

export interface AmountsPreview {
  kind: 'annual' | 'monthly'
  year: string | null
  unit: EcountUnit
  basis: MonthlyBasis | null
  /** 누계를 당월로 바꿨는가(월별 · ytd) */
  converted: boolean
  /** 금액 열 이름(연간 ['amount'] · 월별 지정한 달들) */
  keys: string[]
  lines: PreviewLine[]
  /** 싣지 않는 줄 — 합계 · 소계 · 이익 · 머리(대조에만 쓴다) */
  others: { sheet: string; rowNo: number; name: string; kind: RowKind; amounts: (number | null)[] }[]
  checks: FigureCheck[]
  /** 줄에 붙지 않는 차단(기간 · 마감 · 불균형 · 합계 불일치) */
  blocks: string[]
  warnings: string[]
  /** 월별 — 이 파일에 금액이 없어 등록이 지난 업로드 전표를 역분개할 달들(0056). 연간은 없다 */
  reversals?: string[]
  blockCount: number
  warningCount: number
}

/** 줄 하나를 가리키는 열쇠 — 사람이 고른 계정(picks)의 키. 시트 이름 + 엑셀 행 번호. */
export function pickKey(line: Pick<StatementLine, 'sheet' | 'rowNo'>): string {
  return `${line.sheet}!${line.rowNo}`
}

/** 사람이 고른 계정(줄 열쇠 → 계정코드)을 화면이 보낸 값에서 거른다. 믿지 않는다 — 후보인지는 matchLines가 다시 본다. */
export function parsePicks(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 5000)) {
    if (typeof v === 'string' && /^.{1,120}!\d{1,6}$/.test(k) && ACCOUNT_CODE_PATTERN.test(v)) out[k] = v
  }
  return out
}

/**
 * 줄을 계정에 맞추고, 묶음 이름은 소계로 돌린다. 숫자 오류는 차단. 0원 · 빈 줄은 싣지 않는다(경고 없이).
 * pickable(연간): 이름이 계정 둘 이상과 맞은 줄은 후보를 들고 «고르세요»로 막히고, picks에 **그 줄의 후보 중 하나**가
 * 있으면 그 계정으로 맞춘다(how='pick'). 후보가 아닌 값은 못 본 것으로 한다 — 화면이 보낸 코드를 믿지 않는다.
 */
export function matchLines(
  lines: StatementLine[],
  keys: readonly string[],
  accounts: readonly ExistingAccount[],
  opts: { pickable?: boolean; picks?: Readonly<Record<string, string>> } = {},
): { matched: (PreviewLine & { src: StatementLine })[]; others: StatementLine[] } {
  const matched: (PreviewLine & { src: StatementLine })[] = []
  const others: StatementLine[] = []
  for (const l of lines) {
    if (l.kind !== 'line') {
      others.push(l)
      continue
    }
    let m = matchAccount(l, accounts)
    if (opts.pickable && m.candidates) {
      const picked = opts.picks?.[pickKey(l)]
      const hit = picked && m.candidates.some((c) => c.code === picked) ? accounts.find((a) => a.account_code === picked) : undefined
      m = hit
        ? { account: { code: hit.account_code, name: hit.name, section: hit.section, active: hit.active }, how: 'pick', problem: null, candidates: m.candidates }
        : { ...m, problem: `이름 «${l.name}»이 계정 ${m.candidates.length}개와 맞습니다 — «맞춘 계정» 칸에서 하나를 고르세요` }
    }
    if (!m.account && !m.candidates && !l.code && isGroupName(l.name)) {
      others.push({ ...l, kind: 'subtotal' })
      continue
    }
    const amounts = keys.map((k) => l.amounts[k])
    const errs = keys.flatMap((k) => (l.errors[k] ? [`${k === 'amount' ? '' : `${Number(k.slice(1))}월 `}${l.errors[k]}`] : []))
    // 금액이 전부 비었거나 0이고 오류도 없으면 싣지 않는다(«0원 줄 제외») — 계정이 없어도 막지 않는다.
    if (errs.length === 0 && amounts.every((v) => v === null || v === 0)) continue
    const blocks = [...errs]
    const warnings: string[] = []
    if (m.problem) blocks.push(m.problem)
    if (m.account && !m.account.active) warnings.push(`비활성 계정 ${m.account.code}에 금액이 있습니다`)
    matched.push({
      sheet: l.sheet,
      rowNo: l.rowNo,
      name: l.name,
      code: l.code,
      account: m.account,
      how: m.how,
      ...(opts.pickable && m.candidates ? { candidates: m.candidates } : {}),
      ...(m.account?.section === 'non_operating' ? { nonOp: nonOpDirection(l) } : {}),
      amounts,
      blocks,
      warnings,
      src: l,
    })
  }
  return { matched, others }
}

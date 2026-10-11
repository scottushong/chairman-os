import { ACCOUNT_CODE_PATTERN, ACCOUNT_NAME_MAX, SECTION_CATEGORIES } from '@/lib/ledger/accounts'
import {
  ACCOUNT_CATEGORY,
  ACCOUNT_SECTION,
  ACCOUNT_SECTION_LABEL_KO,
  CASH_FLOW_CLASS,
  type AccountCategory,
  type AccountSection,
  type CashFlowClass,
} from '@/types'

import { cellText, type EcountCell } from './cells'
import { classifyRowLabel, normalizeLabel } from './detect'
import type { SheetLike, SheetPart } from './mapping'

/**
 * ① 계정과목 업로드 — 파일 행 읽기 · 분류 제안 · 병합 계획. 순수 함수(브라우저와 서버가 같이 본다).
 *
 * 화면은 사람이 분류를 고칠 때마다 planAccounts를 **다시 돌려** 차단이 풀렸는지 보여 주고, 등록 때 서버는
 * 원본을 다시 읽어 같은 함수로 **처음부터 다시** 계획한다 — 화면이 보낸 것은 사람의 선택(분류 고침 · 이름 바꿀 코드)뿐이다.
 *
 * 병합 규칙(설계서 B-①):
 *   새 코드        source='ecount'로 더한다. «사용안함»이면 active=false로 넣는다
 *   있는 코드      **분류는 절대 안 바꾼다**(마감 달 KPI가 바뀐다). 이름은 사람이 체크한 것만 바꾼다
 *   파일에 없는 코드 지우지 않는다(목록만 보여 준다)
 */

export interface AccountClass {
  section: AccountSection
  category: AccountCategory
  cash_flow: CashFlowClass | null
}

export interface AccountFileRow {
  /** 엑셀 행 번호(1부터) — 화면 · 차단 문장이 이 번호로 가리킨다 */
  rowNo: number
  code: string
  name: string
  group: string
  use: string
}

export interface IgnoredRow {
  rowNo: number
  text: string
  why: string
}

/** 코드 칸 — 숫자 칸(101)은 정수 글로, 글 칸(«0101»)은 앞자리 0을 그대로. */
function codeText(cell: EcountCell | undefined): string {
  if (!cell) return ''
  if (cell.t === 'number') return String(cell.v)
  return cellText(cell).trim()
}

/**
 * 머리글 아래 행을 읽는다. 코드도 이름도 없는 줄은 건너뛰고, 코드 없이 합계 · 제목 같은 줄은 «무시»로 모은다(경고).
 * 코드 없이 이름만 있는 보통 줄은 행으로 남긴다 — planAccounts가 «계정코드 빈 줄»로 막는다.
 */
export function readAccountRows(sheet: SheetLike, part: SheetPart): { rows: AccountFileRow[]; ignored: IgnoredRow[] } {
  const rows: AccountFileRow[] = []
  const ignored: IgnoredRow[] = []
  const col = (r: EcountCell[], key: string) => (part.columns[key] === undefined ? undefined : r[part.columns[key]])
  for (let r = part.headerRow + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r]
    const code = codeText(col(row, 'code'))
    const name = cellText(col(row, 'name')).trim()
    if (!code && !name) continue
    if (!code) {
      const k = classifyRowLabel(name)
      if (k.kind !== 'line') {
        ignored.push({ rowNo: r + 1, text: name, why: k.kind === 'heading' ? '제목 행' : '합계 행' })
        continue
      }
    }
    rows.push({
      rowNo: r + 1,
      code,
      name,
      group: cellText(col(row, 'group')).trim(),
      use: cellText(col(row, 'use')).trim(),
    })
  }
  return { rows, ignored }
}

// ---------------------------------------------------------------- 분류 제안

/** 넓은 갈래 — 구분 열 · 코드 대역이 서로 맞는지 잴 때 쓴다. 영업외는 수익 · 비용 어느 쪽과도 맞는다. */
type Broad = 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'nonop'

interface Hint {
  broad: Broad
  /** 갈래보다 더 좁게 알 때(«매출원가» · «판매비와관리비» · «법인세») */
  section?: AccountSection
  label: string
}

/**
 * 코드 대역 — K-GAAP(더존 · ECOUNT 기본 계정) 세 자리 관례. 네 자리 이상(1010)은 앞 세 자리로 본다.
 *   101~250 자산 · 251~330 부채 · 331~400 자본 · 401~450 매출 · 451~799 매출원가(제조 · 도급 원가 포함)
 *   801~900 판매비와관리비 · 901~997 영업외(수익 · 비용) · 998~999 법인세
 */
export function codeBand(code: string): Hint | null {
  if (!/^\d{3,}$/.test(code)) return null
  const n = Number(code.slice(0, 3))
  const label = `코드 ${code.slice(0, 3)}번대`
  if (n >= 101 && n <= 250) return { broad: 'asset', label }
  if (n >= 251 && n <= 330) return { broad: 'liability', label }
  if (n >= 331 && n <= 400) return { broad: 'equity', section: 'equity', label }
  if (n >= 401 && n <= 450) return { broad: 'income', section: 'revenue', label }
  if (n >= 451 && n <= 799) return { broad: 'expense', section: 'cogs', label }
  if (n >= 801 && n <= 900) return { broad: 'expense', section: 'sga', label }
  if (n >= 901 && n <= 997) return { broad: 'nonop', section: 'non_operating', label }
  if (n >= 998 && n <= 999) return { broad: 'expense', section: 'tax', label }
  return null
}

/** «구분» 열의 글. 모르는 글이면 null(제안에 쓰지 않는다 — 막지도 않는다). */
export function groupHint(text: string): Hint | null {
  const t = normalizeLabel(text)
  if (!t) return null
  const label = `구분 «${text.trim().slice(0, 20)}»`
  if (/영업외수익|영업외이익/.test(t)) return { broad: 'nonop', section: 'non_operating', label }
  if (/영업외비용|영업외손실|영업외/.test(t)) return { broad: 'nonop', section: 'non_operating', label }
  if (/법인세/.test(t)) return { broad: 'expense', section: 'tax', label }
  if (/판매비|관리비|판관비/.test(t)) return { broad: 'expense', section: 'sga', label }
  if (/원가/.test(t)) return { broad: 'expense', section: 'cogs', label }
  if (/부채/.test(t)) return { broad: 'liability', label }
  if (/자본|잉여금/.test(t)) return { broad: 'equity', section: 'equity', label }
  if (/자산/.test(t)) return { broad: 'asset', label }
  if (/매출|수익/.test(t)) return { broad: 'income', label }
  if (/비용/.test(t)) return { broad: 'expense', label }
  return null
}

function compatible(a: Broad, b: Broad): boolean {
  if (a === b) return true
  if (a === 'nonop') return b === 'income' || b === 'expense'
  if (b === 'nonop') return a === 'income' || a === 'expense'
  return false
}

const BROAD_KO: Record<Broad, string> = { asset: '자산', liability: '부채', equity: '자본', income: '수익', expense: '비용', nonop: '영업외' }

const NONOP_NAME = /영업외|이자수익|배당금수익|임대료수익|외환차익|외화환산이익|처분이익|잡이익|이자비용|외환차손|외화환산손실|처분손실|잡손실|기부금|평가손실|평가이익/
const DA_NAME = /감가상각비|무형자산상각비|상각비$/

function expenseCategory(name: string): AccountCategory {
  if (/급여|임금|상여|퇴직|복리후생|노무비|인건비|수당/.test(name)) return 'labor'
  if (/전력|전기|수도광열|가스/.test(name)) return 'electricity'
  if (/운반|운송|물류|택배/.test(name)) return 'freight'
  if (/라이선스|라이센스|로열티|사용료/.test(name)) return 'license'
  if (/원재료|재료비|상품매출원가|매입/.test(name)) return 'raw_material'
  return 'other'
}

function assetClass(name: string): AccountClass {
  if (/현금|예금|당좌/.test(name) && !/예수금|누계액/.test(name)) return { section: 'cash', category: 'asset', cash_flow: null }
  if (/외상매출금|받을어음|매출채권/.test(name)) return { section: 'receivable', category: 'asset', cash_flow: 'operating' }
  if (/누계액|충당금/.test(name)) return { section: 'other_asset', category: 'asset', cash_flow: null }
  const investing = /유형자산|토지|건물|기계|차량|비품|공구|구축물|건설중|무형|영업권|특허|소프트웨어|개발비|보증금|투자|대여금|장기/.test(name)
  return { section: 'other_asset', category: 'asset', cash_flow: investing ? 'investing' : 'operating' }
}

function liabilityClass(name: string): AccountClass {
  if (/외상매입금|지급어음|매입채무/.test(name)) return { section: 'payable', category: 'liability', cash_flow: 'operating' }
  return { section: 'other_liability', category: 'liability', cash_flow: /차입금|사채|리스부채/.test(name) ? 'financing' : 'operating' }
}

function plClass(section: AccountSection, name: string): AccountClass {
  if (section === 'revenue') return { section, category: 'revenue', cash_flow: null }
  if (section === 'cogs' || section === 'sga') {
    if (DA_NAME.test(name) && !/누계/.test(name)) return { section: 'd_and_a', category: 'other', cash_flow: null }
    return { section, category: expenseCategory(name), cash_flow: null }
  }
  return { section, category: 'other', cash_flow: null }
}

export interface AccountSuggestion {
  /** 제안 분류 — 모르면 null(분류 미정 → 사람이 고르기 전까지 차단) */
  suggestion: AccountClass | null
  /** 무엇을 보고 정했는가(«구분 «자산» · 코드 101번대 · 이름») */
  why: string
  /** 구분 열과 코드 대역이 서로 다르면 그 문장 — 사람이 고르기 전까지 차단 */
  contradiction: string | null
}

/** «구분» 열 + 코드 대역 + 이름 낱말로 분류를 **제안**한다. 확정은 사람이 미리보기에서 한다. */
export function suggestAccountClass(code: string, nameRaw: string, group: string): AccountSuggestion {
  const name = normalizeLabel(nameRaw)
  const g = groupHint(group)
  const b = codeBand(code)
  const why = [g?.label, b?.label].filter(Boolean).join(' + ')
  if (g && b && !compatible(g.broad, b.broad)) {
    return { suggestion: null, why, contradiction: `구분 열(${BROAD_KO[g.broad]})과 코드 대역(${BROAD_KO[b.broad]})이 다릅니다` }
  }
  const hint = g ?? b
  if (!hint) return { suggestion: null, why: '구분 열 · 코드 대역 없음', contradiction: null }
  // 더 좁게 아는 쪽 — 구분 열이 넓고(«비용») 코드가 좁으면(판관비 대역) 코드를 쓴다.
  const section = g?.section ?? b?.section
  let broad: Broad = g && g.broad !== 'nonop' ? g.broad : (b?.broad ?? g!.broad)
  if (section === 'non_operating') broad = 'nonop'

  let out: AccountClass
  switch (broad) {
    case 'asset':
      out = assetClass(name)
      break
    case 'liability':
      out = liabilityClass(name)
      break
    case 'equity':
      out = { section: 'equity', category: 'equity', cash_flow: 'financing' }
      break
    case 'nonop':
      out = plClass('non_operating', name)
      break
    case 'income':
      out = plClass(NONOP_NAME.test(name) ? 'non_operating' : 'revenue', name)
      break
    case 'expense': {
      let s: AccountSection = section && section !== 'revenue' ? section : 'sga'
      if (!section) {
        if (/법인세/.test(name)) s = 'tax'
        else if (NONOP_NAME.test(name)) s = 'non_operating'
        else if (/매출원가|원재료비|재료비|노무비|제조|외주가공/.test(name)) s = 'cogs'
      }
      out = plClass(s, name)
      break
    }
  }
  return { suggestion: out, why: why ? `${why} + 이름` : '이름', contradiction: null }
}

// ---------------------------------------------------------------- 사용여부

/** «사용» · «Y» · «예» → true, «미사용» · «사용안함» · «N» · «아니오» → false, 빈 칸 → true, 모르는 글 → null. */
export function parseUse(text: string): boolean | null {
  const t = normalizeLabel(text).toUpperCase()
  if (!t) return true
  if (/^(미사용|사용안함|사용중지|중지|N|NO|아니오|아니요|X|FALSE|0)$/.test(t)) return false
  if (/^(사용|사용함|사용중|Y|YES|예|O|TRUE|1)$/.test(t)) return true
  return null
}

// ---------------------------------------------------------------- 병합 계획

export interface ExistingAccount {
  account_code: string
  name: string
  section: AccountSection
  category: AccountCategory
  cash_flow: CashFlowClass | null
  active: boolean
}

export type AccountLineStatus = 'new' | 'same' | 'name_differs' | 'renamed' | 'blocked'

export interface AccountPlanLine {
  rowNo: number
  code: string
  name: string
  active: boolean
  status: AccountLineStatus
  existing: ExistingAccount | null
  suggestion: AccountClass | null
  why: string
  /** 새 계정이 실제로 받을 분류(사람이 고친 것 > 제안). 있는 계정은 null — 분류를 건드리지 않는다 */
  final: AccountClass | null
  overridden: boolean
  /** 이 줄을 막는 이유들 */
  blocks: string[]
  /** 이 줄의 경고들 */
  warnings: string[]
}

export interface AccountsPlan {
  lines: AccountPlanLine[]
  ignored: IgnoredRow[]
  /** 파일에 없는 기존 계정(지우지 않는다 — 목록만) */
  missing: { code: string; name: string }[]
  creates: (AccountClass & { account_code: string; name: string; active: boolean })[]
  renames: { account_code: string; from: string; to: string }[]
  blockCount: number
  warningCount: number
}

export type AccountOverrides = Record<string, AccountClass>

export function validClass(c: AccountClass): boolean {
  return (
    ACCOUNT_SECTION.includes(c.section) &&
    ACCOUNT_CATEGORY.includes(c.category) &&
    SECTION_CATEGORIES[c.section].includes(c.category) &&
    (c.cash_flow === null || CASH_FLOW_CLASS.includes(c.cash_flow))
  )
}

/** 화면이 보낸 «분류 고침» · «이름 바꿀 코드»를 믿지 않고 모양만 걸러 받는다. 모르는 칸은 버린다. */
export function parseAccountChoices(overrides: unknown, renames: unknown): { overrides: AccountOverrides; renames: string[] } {
  const out: AccountOverrides = {}
  if (overrides && typeof overrides === 'object') {
    for (const [code, v] of Object.entries(overrides as Record<string, unknown>).slice(0, 5000)) {
      if (!ACCOUNT_CODE_PATTERN.test(code) || !v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      const c = {
        section: o.section as AccountSection,
        category: o.category as AccountCategory,
        cash_flow: (o.cash_flow ?? null) as CashFlowClass | null,
      }
      if (validClass(c)) out[code] = c
    }
  }
  const list = Array.isArray(renames) ? renames.filter((r): r is string => typeof r === 'string' && ACCOUNT_CODE_PATTERN.test(r)).slice(0, 5000) : []
  return { overrides: out, renames: [...new Set(list)] }
}

/**
 * 병합 계획. 차단 — 코드 공백 · 코드 모양 · 이름 공백/길이 · 파일 안 중복 · 분류 미정 · 구분↔코드 모순 · 구분↔대분류 모순.
 * 경고 — 이름만 다름 · 사용여부를 못 읽음 · 합계/제목 행 무시 · 파일에 없는 기존 계정.
 * 있는 코드에는 분류 고침을 받지 않는다(분류는 절대 안 바꾼다).
 */
export function planAccounts(input: {
  rows: AccountFileRow[]
  ignored: IgnoredRow[]
  existing: ExistingAccount[]
  overrides?: AccountOverrides
  renames?: string[]
}): AccountsPlan {
  const overrides = input.overrides ?? {}
  const renames = new Set(input.renames ?? [])
  const existing = new Map(input.existing.map((a) => [a.account_code, a]))
  const count = new Map<string, number>()
  for (const r of input.rows) if (r.code) count.set(r.code, (count.get(r.code) ?? 0) + 1)

  const lines: AccountPlanLine[] = input.rows.map((r) => {
    const blocks: string[] = []
    const warnings: string[] = []
    const ex = r.code ? (existing.get(r.code) ?? null) : null
    if (!r.code) blocks.push('계정코드가 비어 있습니다')
    else if (!ACCOUNT_CODE_PATTERN.test(r.code)) blocks.push('계정코드는 영문 · 숫자 · 하이픈 20자까지입니다')
    if ((count.get(r.code) ?? 0) > 1) blocks.push(`파일 안에 같은 코드 ${r.code}가 ${count.get(r.code)}번 있습니다`)
    if (!r.name) blocks.push('계정명이 비어 있습니다')
    else if (r.name.length > ACCOUNT_NAME_MAX) blocks.push(`계정명은 ${ACCOUNT_NAME_MAX}자까지입니다`)
    const use = parseUse(r.use)
    if (use === null) warnings.push(`사용여부 «${r.use.slice(0, 20)}»를 읽지 못해 «사용»으로 둡니다`)
    const active = use ?? true

    const s = suggestAccountClass(r.code, r.name, r.group)
    let final: AccountClass | null = null
    let overridden = false
    let status: AccountLineStatus
    if (ex) {
      // 있는 코드 — 분류는 그대로. 이름만 다르면 경고, 사람이 체크했으면 이름 바꿈.
      if (r.name && normalizeLabel(r.name) !== normalizeLabel(ex.name)) {
        if (renames.has(r.code)) status = 'renamed'
        else {
          status = 'name_differs'
          warnings.push(`이름이 다릅니다 — 장부 «${ex.name}» · 파일 «${r.name}»`)
        }
      } else status = 'same'
      if (s.suggestion && (s.suggestion.section !== ex.section)) {
        warnings.push(`파일로 본 구분(${ACCOUNT_SECTION_LABEL_KO[s.suggestion.section]})이 장부(${ACCOUNT_SECTION_LABEL_KO[ex.section]})와 다릅니다 — 있는 계정의 분류는 바꾸지 않습니다`)
      }
    } else {
      const o = r.code ? overrides[r.code] : undefined
      if (o) {
        overridden = true
        if (validClass(o)) final = o
        else blocks.push('구분과 대분류가 맞지 않습니다')
      } else if (s.contradiction) blocks.push(`${s.contradiction} — 분류를 직접 고르세요`)
      else if (!s.suggestion) blocks.push('분류를 정하지 못했습니다 — 직접 고르세요')
      else final = s.suggestion
      status = 'new'
    }
    if (blocks.length) status = 'blocked'
    return { rowNo: r.rowNo, code: r.code, name: r.name, active, status, existing: ex, suggestion: s.suggestion, why: s.why, final, overridden, blocks, warnings }
  })

  const inFile = new Set(input.rows.map((r) => r.code))
  const missing = input.existing.filter((a) => !inFile.has(a.account_code)).map((a) => ({ code: a.account_code, name: a.name }))
  const creates = lines
    .filter((l) => l.status === 'new' && l.final)
    .map((l) => ({ account_code: l.code, name: l.name, active: l.active, ...l.final! }))
  const renamesOut = lines
    .filter((l) => l.status === 'renamed' && l.existing)
    .map((l) => ({ account_code: l.code, from: l.existing!.name, to: l.name }))
  const blockCount = lines.reduce((n, l) => n + l.blocks.length, 0)
  const warningCount = lines.reduce((n, l) => n + l.warnings.length, 0) + input.ignored.length + (missing.length ? 1 : 0)
  return { lines, ignored: input.ignored, missing, creates, renames: renamesOut, blockCount, warningCount }
}

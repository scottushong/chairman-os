import type { ExistingAccount } from './accounts-import'
import { cellText } from './cells'
import { detectPeriod, fullYearOf } from './detect'
import type { EcountMapping, SheetLike } from './mapping'
import {
  addToSums,
  emptySums,
  figureChecks,
  matchLines,
  readStatementLines,
  type AmountsPreview,
  type StatementLine,
} from './statement-lines'

/**
 * ② 연간 재무제표(재무상태표 · 손익계산서) 미리보기 — **검증만**. 등록(official_statement_import_ecount)은 0051 이후다.
 *
 * 판정(설계서 B-②):
 *   차단  계정 매칭 실패 · 숫자 오류 · 재무상태표 불균형 · 파일 합계 행과 계산 불일치(차액) · 해 미상 · 세무사 확정이 이미 있는 해
 *   경고  파일 기간이 한 해 전체가 아님 · 파일 기간의 해 ≠ 지정한 해 · 비활성 계정 · 소계로 본 묶음 줄
 * 금액은 파일에 보인 그대로(양수) — 원장 부호 규약(부채 · 자본 · 수익 −)은 등록 RPC가 계정 구분으로 정한다.
 */

export interface AnnualContext {
  /** 그 회사 계정(비활성 포함 — 비활성에 금액이 있으면 경고) */
  accounts: readonly ExistingAccount[]
  /** 그 회사의 활성 공식 결산(세무사 확정) 기간 키들 — 'YYYY' · 'YYYY-Q1' … */
  officialKeys: readonly string[]
}

function sheetPeriod(sheet: SheetLike): string | null {
  for (let r = 0; r < Math.min(sheet.rows.length, 15); r += 1) {
    for (const c of sheet.rows[r] ?? []) {
      const p = detectPeriod(cellText(c))
      if (p) return fullYearOf(p) ?? `${p.from} ~ ${p.to}`
    }
  }
  return null
}

export function planAnnual(sheets: readonly SheetLike[], mapping: EcountMapping, ctx: AnnualContext): AmountsPreview {
  const keys = ['amount']
  const blocks: string[] = []
  const warnings: string[] = []
  const all: StatementLine[] = []
  for (const part of mapping.parts) {
    const sheet = sheets.find((s) => s.name === part.sheet)
    if (!sheet) continue
    all.push(...readStatementLines(sheet, part, mapping.unit, keys))
    const period = sheetPeriod(sheet)
    if (period && !/^\d{4}$/.test(period)) warnings.push(`«${sheet.name}»의 기간(${period})이 한 해 전체가 아닙니다`)
    else if (period && mapping.year && period !== mapping.year) warnings.push(`«${sheet.name}»의 기간은 ${period}년인데 ${mapping.year}년으로 지정했습니다`)
  }
  if (!mapping.year) blocks.push('몇 년도 자료인지 정하지 않았습니다')
  else if (ctx.officialKeys.includes(mapping.year)) blocks.push(`${mapping.year}년은 세무사 확정 결산이 이미 있습니다 — ECOUNT 연간은 받지 않습니다`)

  const { matched, others } = matchLines(all, keys, ctx.accounts)
  for (const o of others) if (o.kind === 'subtotal' && o.amounts.amount !== null) warnings.push(`${o.sheet} ${o.rowNo}행 «${o.name}»은 묶음(소계)으로 보고 싣지 않습니다`)

  const unmatched = matched.some((l) => !l.account)
  const sums = emptySums()
  for (const l of matched) if (l.account && l.amounts[0] !== null) addToSums(sums, l.account.section, l.src, l.amounts[0])

  const checks = unmatched ? [] : figureChecks(others, 'amount', sums, (l) => l.amounts.amount)
  if (unmatched) warnings.push('계정을 다 맞춘 뒤에 합계 행과 대조합니다')
  for (const c of checks) {
    if (c.diff !== 0) blocks.push(`${c.sheet} ${c.rowNo}행 ${c.label}: 파일 ${c.file.toLocaleString('ko-KR')}원 · 계산 ${c.computed.toLocaleString('ko-KR')}원 (차액 ${c.diff.toLocaleString('ko-KR')}원)`)
  }
  if (!unmatched && sums.hasBs && sums.asset !== sums.liability + sums.equity) {
    const d = sums.asset - sums.liability - sums.equity
    blocks.push(`재무상태표가 맞지 않습니다: 자산 ${sums.asset.toLocaleString('ko-KR')}원 · 부채+자본 ${(sums.liability + sums.equity).toLocaleString('ko-KR')}원 (차액 ${d.toLocaleString('ko-KR')}원)`)
  }
  if (matched.length === 0) blocks.push('실을 금액 줄이 없습니다 — 열 지정(과목명 · 당기 금액)을 확인하세요')

  const lines = matched.map((m) => {
    const { src, ...l } = m
    void src
    return l
  })
  return {
    kind: 'annual',
    year: mapping.year,
    unit: mapping.unit,
    basis: null,
    converted: false,
    keys,
    lines,
    others: others.map((o) => ({ sheet: o.sheet, rowNo: o.rowNo, name: o.name, kind: o.kind, amounts: keys.map((k) => o.amounts[k]) })),
    checks,
    blocks,
    warnings,
    blockCount: blocks.length + lines.reduce((n, l) => n + l.blocks.length, 0),
    warningCount: warnings.length + lines.reduce((n, l) => n + l.warnings.length, 0),
  }
}

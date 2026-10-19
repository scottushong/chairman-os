import { ATTACHMENT_MIME } from '@/lib/attachments/rules'
import { canImportEcount } from '@/lib/auth/roles'
import { planAccounts, readAccountRows, suggestAccountClass, type ExistingAccount } from '@/lib/ecount/excel/accounts-import'
import { annualLedgerLines, planAnnual } from '@/lib/ecount/excel/annual-import'
import { cellText } from '@/lib/ecount/excel/cells'
import { normalizeLabel } from '@/lib/ecount/excel/detect'
import { guessMapping, mappingProblems, monthOfLabel, withLabels, type EcountMapping } from '@/lib/ecount/excel/mapping'
import { monthlyLedgerMonths, planMonthly } from '@/lib/ecount/excel/monthly-import'
import { ecountImportErrorMessage } from '@/lib/ecount/import-errors'
import type { EcountSheet } from '@/lib/ecount/excel/workbook'
import { periodOfDate } from '@/lib/ledger/basis'
import { lastClosedPeriod } from '@/lib/ledger/journal'
import type { AuditActor, ChairmanRepository } from '@/lib/repository'
import type { FinanceImportKind, FinanceLedger, SessionUser } from '@/types'

import { ensureAccounts } from './auto-accounts'

/**
 * 0085 — 계정과목표 · 월별 손익계산서 · 재무제표(연간)도 칸 하나에 놓으면 저장한다(예전 «그 밖» 칸의 미리보기 → 열 지정 → 등록을 사람 없이).
 * 길은 예전과 같다: finance_imports 한 줄(0050) + 원본 첨부(서버가 사람 세션으로 올린다) + 미리보기 기록 + 등록 RPC(0051 · 0052 · 0056) —
 * 판정(마감 달 · 세무사 확정이 덮은 달 · 재무상태표 계정 · 균형 …)은 그 RPC가 그대로 한다. 막히면 «보류(이유)»로 남기고 draft는 취소한다.
 *   계정과목표 — 있는 코드의 분류는 바꾸지 않는다(0051). 단 «자동 생성» 계정은 이 파일의 이름 · 구분으로 덮어쓰고 표시를 내린다.
 *   월별 손익 — 계정을 못 맞춘 줄(코드가 있는 것)은 «자동 생성»으로 만든 뒤 다시 계획한다(계정표가 뒤에 와도 된다).
 *                역분개(파일에 금액이 없는 달의 지난 업로드 전표)는 «다시 올림 = 새 값으로 바꾸기»라 자동으로 확인한다.
 * ECOUNT 코드 회사(DY)만 — 다른 회사는 이 길이 없다(보류로 알린다).
 */

export type LegacyKind = FinanceImportKind

export interface LegacyResult {
  kind: LegacyKind
  status: 'applied' | 'held'
  message: string
  warnings: string[]
  /** 월별 — 저장한 달들(재무 현황 다시 계산) */
  months: string[]
  importId: string | null
  /** 계정과목표 — 덮어쓴 자동 생성 계정 수 */
  overwritten?: number
}

const MONTH_HEAD = (s: string) => {
  const m = monthOfLabel(s)
  return !!m && !m.ytd
}

/** 시트 머리 글로 예전 셋 중 하나인가(강한 낱말만 — 18가지 자료와 헷갈리지 않게). */
export function sniffLegacy(sheets: readonly EcountSheet[], fileName: string): LegacyKind | null {
  const head = (s: EcountSheet) => normalizeLabel([s.name, ...s.rows.slice(0, 8).map((r) => r.map(cellText).join(' '))].join(' '))
  const all = normalizeLabel(fileName) + ' ' + sheets.map(head).join(' ')
  if (/계정별원장|원장거래|전표/.test(all)) return null
  const monthCols = Math.max(0, ...sheets.map((s) => Math.max(0, ...s.rows.slice(0, 12).map((r) => r.filter((c) => MONTH_HEAD(cellText(c))).length))))
  if (/손익계산서|월별손익/.test(all) && monthCols >= 3) return guessMapping([...sheets], 'monthly').found ? 'monthly' : null
  if (/계정과목표|계정과목코드표|계정코드표|계정과목목록|계정과목리스트/.test(all)) return guessMapping([...sheets], 'accounts').found ? 'accounts' : null
  if (/재무상태표|대차대조표|손익계산서|재무제표/.test(all) && !/표준재무제표|세무사|회계법인/.test(all)) return guessMapping([...sheets], 'annual').found ? 'annual' : null
  return null
}

async function companyAccounts(repo: ChairmanRepository, businessId: string, ledger?: FinanceLedger): Promise<ExistingAccount[]> {
  return (ledger ?? (await repo.loadFinanceLedger())).accounts
    .filter((a) => a.business_id === businessId)
    .map((a) => ({ account_code: a.account_code, name: a.name, section: a.section, category: a.category, cash_flow: a.cash_flow, active: a.active }))
}

/** app/actions/ecount-import.ts monthlyPreview와 같은 재료(그 파일은 'use server'라 함수를 내보내지 못한다). */
async function monthlyPlan(repo: ChairmanRepository, businessId: string, sheets: EcountSheet[], mapping: EcountMapping) {
  const [ledger, officials, slips] = await Promise.all([repo.loadFinanceLedger(), repo.listOfficialStatements(businessId), repo.listFinanceImportSlips(businessId)])
  const slipNos = new Set(slips.map((x) => x.slip_no))
  const uploadSlips = new Set([
    ...slipNos,
    ...ledger.entries.filter((e) => e.business_id === businessId && e.correction_kind === 'reversal' && !!e.corrects_id && slipNos.has(e.corrects_id)).map((e) => e.slip_no),
  ])
  const journalMonths = [...new Set(ledger.journal.filter((j) => j.business_id === businessId && j.source === 'manual' && !uploadSlips.has(j.slip_no)).map((j) => periodOfDate(j.entry_date)))]
  return planMonthly(sheets, mapping, {
    accounts: await companyAccounts(repo, businessId, ledger),
    lastClosed: lastClosedPeriod(ledger, businessId),
    officials: officials.map((o) => ({ kind: o.period_kind, key: o.period_key })),
    journalMonths,
    uploadSlips: Object.fromEntries(slips.filter((x) => x.superseded_at === null).map((x) => [x.month, x.slip_no])),
  })
}

const held = (kind: LegacyKind, message: string, warnings: string[] = [], importId: string | null = null): LegacyResult => ({ kind, status: 'held', message, warnings, months: [], importId })

export async function runLegacyImport(o: {
  repo: ChairmanRepository
  user: SessionUser
  businessId: string
  kind: LegacyKind
  fileName: string
  bytes: Uint8Array
  sha: string
  sheets: EcountSheet[]
}): Promise<LegacyResult> {
  const { repo, user, businessId, kind } = o
  const actor: AuditActor = { user_id: user.user_id, role: user.role }
  if (!canImportEcount(user, businessId)) return held(kind, '보류 — 계정과목표 · 월별 손익 · 재무제표(ECOUNT 양식)는 ECOUNT를 쓰는 회사만 받습니다.')
  if (!/\.xlsx$/i.test(o.fileName)) return held(kind, '보류 — 이 자료는 xlsx 파일만 받습니다. ECOUNT에서 «엑셀(xlsx)»로 저장해 올려 주세요.')
  const guess = guessMapping(o.sheets, kind)
  if (!guess.found) return held(kind, '보류 — 머리글(과목 · 금액 열)을 찾지 못했습니다.')
  const mapping = withLabels(guess.mapping, o.sheets)
  const problems = mappingProblems(mapping, o.sheets)
  if (problems.length) return held(kind, `보류 — ${problems[0]}`)
  if (kind !== 'accounts' && !mapping.year) return held(kind, '보류 — 몇 년도 자료인지 알아보지 못했습니다(제목 · 머리글에 해가 없음).')
  const warnings: string[] = []
  if (!guess.detectedUnit) warnings.push('단위 표기가 없어 «원»으로 읽었습니다.')

  let importId: string | null = null
  const cancel = async () => {
    if (!importId) return
    for (const a of await repo.listAttachments('finance_imports', importId).catch(() => [])) await repo.deleteAttachment(a.attachment_id, actor).catch(() => undefined)
    await repo.cancelFinanceImport(importId, actor).catch(() => undefined)
  }
  try {
    const imp = await repo.createFinanceImport({ business_id: businessId, kind, file_name: o.fileName.slice(0, 255) }, actor)
    importId = imp.import_id
    const att = await repo.createAttachment({ entity_table: 'finance_imports', entity_id: imp.import_id, file_name: o.fileName.slice(0, 255), mime: ATTACHMENT_MIME.xlsx, size_bytes: o.bytes.byteLength, security_class: 'Normal' }, actor)
    await repo.putAttachmentObject(att.storage_path, o.bytes.slice().buffer as ArrayBuffer, ATTACHMENT_MIME.xlsx)

    if (kind === 'accounts') {
      const part = mapping.parts[0]
      const sheet = o.sheets.find((s) => s.name === part.sheet)!
      const { rows, ignored } = readAccountRows(sheet, part)
      const existing = await companyAccounts(repo, businessId)
      const auto = new Set(await repo.listAutoAccounts(businessId).catch(() => [] as string[]))
      const plan = planAccounts({ rows, ignored, existing })
      if (plan.blockCount > 0) {
        await cancel()
        return held(kind, `보류 — 계정과목표 ${plan.blockCount}줄이 막혔습니다(분류를 모름 · 코드 모양). 그 줄을 고쳐 다시 올려 주세요.`, plan.lines.flatMap((l) => l.blocks.map((b) => `${l.rowNo}행 ${b}`)).slice(0, 10))
      }
      await repo.recordFinanceImportPreview(imp.import_id, { file_sha256: o.sha, summary: { stage: 'preview', mapping, counts: { rows: rows.length, creates: plan.creates.length, blocks: 0, warnings: plan.warningCount }, auto: true }, period_key: null }, actor)
      const r = await repo.registerEcountAccounts(imp.import_id, { file_sha256: o.sha, creates: plan.creates, renames: plan.renames }, actor)
      // 덮어쓰기 — «자동 생성» 계정만(사람이 만든 · ECOUNT에서 온 계정의 분류는 그대로 — 0051 규칙).
      let overwritten = 0
      for (const row of rows) {
        if (!auto.has(row.code)) continue
        const s = suggestAccountClass(row.code, row.name, row.group)
        const cls = s.contradiction ? null : s.suggestion
        try {
          await repo.updateAccount(businessId, row.code, { name: row.name.slice(0, 60), ...(cls ?? {}), auto_created: false }, actor)
          overwritten += 1
        } catch (e) {
          warnings.push(`자동 생성 계정 ${row.code}을 계정과목표 값으로 바꾸지 못했습니다(${e instanceof Error ? e.message.slice(0, 60) : '?'}).`)
        }
      }
      return { kind, status: 'applied', message: `저장됨 · 계정 ${rows.length}개(새 ${r.added} · 이름 ${r.renamed}${overwritten ? ` · 자동 생성 ${overwritten}개 덮어씀` : ''})`, warnings: [...warnings, ...plan.lines.flatMap((l) => l.warnings).slice(0, 10)], months: [], importId, overwritten }
    }

    if (kind === 'monthly') {
      let amounts = await monthlyPlan(repo, businessId, o.sheets, mapping)
      // 계정을 못 맞춘 줄 — 코드가 있으면 «자동 생성» 뒤 다시 계획(계정과목표가 뒤에 와도 된다).
      const missing = amounts.lines.filter((l) => !l.account && l.code).map((l) => ({ code: l.code, name: l.name }))
      if (missing.length) {
        const made = await ensureAccounts(repo, actor, businessId, missing)
        if (made.created.length) {
          warnings.push(`계정과목표에 없는 계정 ${made.created.length}개를 «자동 생성»했습니다 — 계정과목표를 올리면 덮어씁니다.`)
          amounts = await monthlyPlan(repo, businessId, o.sheets, mapping)
        }
      }
      if (amounts.blockCount > 0) {
        await cancel()
        const why = [...amounts.blocks, ...amounts.lines.flatMap((l) => l.blocks.map((b) => `${l.name}: ${b}`))].slice(0, 10)
        const closed = why.some((w) => /마감/.test(w))
        return held(kind, closed ? '보류 — 마감된 달이 들어 있습니다. 대표 · CFO가 마감을 풀거나 그 달을 뺀 파일을 올려 주세요.' : `보류 — 월별 손익 ${amounts.blockCount}곳이 막혔습니다.`, why)
      }
      const months = monthlyLedgerMonths(amounts)
      if (!months.length) {
        await cancel()
        return held(kind, '보류 — 실을 금액 줄이 없습니다(과목명 · 월 열을 찾지 못함).')
      }
      await repo.recordFinanceImportPreview(imp.import_id, { file_sha256: o.sha, summary: { stage: 'preview', mapping, counts: { lines: amounts.lines.length, blocks: 0, warnings: amounts.warningCount }, reversals: amounts.reversals ?? [], auto: true }, period_key: mapping.year }, actor)
      const r = await repo.registerEcountMonthly(imp.import_id, { file_sha256: o.sha, period_key: mapping.year!, basis: mapping.basis ?? 'monthly', months }, actor)
      const saved = months.map((m) => m.month)
      return { kind, status: 'applied', message: `저장됨 · ${saved.length}개 달(새 ${r.posted} · 바꿈 ${r.corrected} · 같음 ${r.unchanged}${r.reversed ? ` · 비운 달 ${r.reversed}` : ''})`, warnings: [...warnings, ...amounts.warnings].slice(0, 20), months: saved, importId }
    }

    // annual
    const [accounts, officials] = await Promise.all([companyAccounts(repo, businessId), repo.listOfficialStatements(businessId)])
    const amounts = planAnnual(o.sheets, mapping, { accounts, officialKeys: officials.filter((x) => x.period_kind === 'year').map((x) => x.period_key), picks: {} })
    if (amounts.blockCount > 0) {
      await cancel()
      return held(kind, `보류 — 재무제표 ${amounts.blockCount}곳이 막혔습니다(세무사 확정이 있는 해 · 계정 못 맞춤 · 균형).`, [...amounts.blocks, ...amounts.lines.flatMap((l) => l.blocks.map((b) => `${l.name}: ${b}`))].slice(0, 10))
    }
    const lines = annualLedgerLines(amounts)
    await repo.recordFinanceImportPreview(imp.import_id, { file_sha256: o.sha, summary: { stage: 'preview', mapping, counts: { lines: amounts.lines.length, blocks: 0, warnings: amounts.warningCount }, picks: {}, auto: true }, period_key: mapping.year }, actor)
    await repo.registerEcountAnnual(imp.import_id, { file_sha256: o.sha, period_key: mapping.year!, lines }, actor)
    return { kind, status: 'applied', message: `저장됨 · ${mapping.year}년 재무제표 ${lines.length}줄(잠정 — 세무사 결산이 오면 «공식»)`, warnings: [...warnings, ...amounts.warnings].slice(0, 20), months: [`${mapping.year}-12`], importId }
  } catch (e) {
    await cancel()
    const m = e instanceof Error ? e.message : ''
    console.error('[legacy-auto]', kind, m)
    return held(kind, `보류 — ${ecountImportErrorMessage(m) ?? '저장하지 못했습니다'}.`)
  }
}

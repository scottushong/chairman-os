'use server'

import { revalidatePath } from 'next/cache'

import { ATTACHMENT_MIME } from '@/lib/attachments/rules'
import { canImportEcount, canKeepBooks } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { ecountAuditNote, ecountFileProblem } from '@/lib/ecount/excel/file-rules'
import {
  parseAccountChoices,
  planAccounts,
  readAccountRows,
  type AccountFileRow,
  type ExistingAccount,
  type IgnoredRow,
} from '@/lib/ecount/excel/accounts-import'
import { planAnnual } from '@/lib/ecount/excel/annual-import'
import type { EcountUnit } from '@/lib/ecount/excel/cells'
import { planMonthly } from '@/lib/ecount/excel/monthly-import'
import {
  guessMapping,
  mappingProblems,
  parseMapping,
  reuseMapping,
  sameMapping,
  sheetGrids,
  withLabels,
  type EcountMapping,
  type MappingSource,
  type SheetGrid,
} from '@/lib/ecount/excel/mapping'
import type { AmountsPreview } from '@/lib/ecount/excel/statement-lines'
import {
  EcountExcelError,
  outlineWorkbook,
  readEcountWorkbook,
  sha256Hex,
  type EcountSheet,
  type SheetOutline,
} from '@/lib/ecount/excel/workbook'
import { periodOfDate } from '@/lib/ledger/basis'
import { lastClosedPeriod } from '@/lib/ledger/journal'
import { DUPLICATE_ACCOUNT_CODE, getRepository, type ChairmanRepository } from '@/lib/repository'
import {
  FINANCE_IMPORT_KIND,
  FINANCE_IMPORT_KIND_LABEL_KO,
  type FinanceImport,
  type FinanceImportKind,
  type FinanceLedger,
  type SessionUser,
} from '@/types'

/**
 * ECOUNT 엑셀 업로드 — 공통 기반(설계서 docs/superpowers/specs/2026-10-02-ecount-excel-import.md A절 · E절 1단계).
 *
 * 흐름(서버가 원본을 두 번 읽는다):
 *   1. startEcountImport   → finance_imports draft 한 줄(0050)
 *   2. beginAttachment(entity_table='finance_imports') → 브라우저가 Storage로 직접 업로드. **AI 요약은 부르지 않는다.**
 *   3. previewEcountImport → 서버가 Storage에서 원본을 다시 읽어 sha256 · 개요를 적는다(DB 쓰기는 그 draft 한 줄뿐)
 *   4. commitEcountImport  → 같은 원본을 다시 읽고 sha256이 미리보기 때와 같은지 본 뒤 대상별 등록
 *   5. cancelEcountImport  → 원본 첨부 취소 **먼저** → cancelled(0050 머리 주석 :25 — cancelled 뒤에는 원본을 못 지운다)
 *
 * ECOUNT 열 구성(화면 캡처)이 없어서 **열은 사람이 지정한다**(lib/ecount/excel/mapping.ts) — 머리글로 짐작하거나
 * 같은 회사의 지난 업로드 지정을 불러오고, 사람이 «이 열 지정으로 미리보기»를 눌러 확정한다(summary.mapping).
 * 등록은 확정한 지정으로만 한다. 계정과목은 등록까지, 연간 · 월별은 미리보기 검증까지(등록 RPC는 0051 이후).
 *
 * 믿지 않는 것: 화면이 보낸 business_id · import_id · 행. 회사는 업로드 줄(DB가 RLS로 내준 것)에서 다시 읽고,
 * 업로드는 «본인 · draft · 그 회사 장부 권한»을 매번 다시 판정한다. 최종 판정은 0050 RLS(can_keep_books)다.
 */

export interface EcountImportState {
  error?: string
  importId?: string
}

/** 미리보기 때 사람이 고른 것 — 열 지정 하나. 행 · 금액은 받지 않는다(서버가 원본에서 읽는다). */
export interface EcountPreviewChoices {
  mapping?: unknown
}

/** 등록 때 사람이 고른 것 — 열 지정(미리보기에서 확정한 것과 같아야 한다) · 새 계정 분류 고침 · 이름 바꿀 코드. */
export interface EcountCommitChoices {
  mapping?: unknown
  overrides?: unknown
  renames?: unknown
}

export interface EcountPreviewState extends EcountImportState {
  kind?: FinanceImportKind
  /** 공통부가 읽은 시트 개요(금액 원문 없음). */
  outline?: SheetOutline[]
  /** 열 지정 화면이 쓰는 시트 머리(위 30행의 글) */
  grids?: SheetGrid[]
  /** 지금 열 지정 — 짐작 · 지난 업로드 · 확정 중 하나(mappingSource) */
  mapping?: EcountMapping
  mappingSource?: MappingSource
  /** 파일 머리에서 찾은 단위(없으면 null) */
  detectedUnit?: EcountUnit | null
  /** 확정하려던 지정이 이 파일에서 읽을 수 없는 이유들 — 있으면 미리보기를 만들지 않았다 */
  mappingProblems?: string[]
  /** 계정과목 미리보기 재료 — 화면이 사람의 분류 고침마다 planAccounts를 다시 돌린다 */
  accounts?: { rows: AccountFileRow[]; ignored: IgnoredRow[]; existing: ExistingAccount[] }
  /** 연간 · 월별 미리보기(검증만 — 등록은 DB 등록 함수가 생긴 뒤) */
  amounts?: AmountsPreview
}

export interface EcountCommitState extends EcountImportState {
  added?: number
  renamed?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 직원 화면이다 — «회장»이 아니라 «대표»(CLAUDE.md 직원 화면 용어 원칙). statements.ts와 같은 문장. */
const NO_BOOKS = '이 회사의 재무를 넣을 권한이 없습니다. (대표 · 그룹 CFO · 해당 회사 대표이사 · 대표가 재무 입력 권한을 준 사람)'
/** 연간 · 월별 등록 — DB 등록 함수(official_statement_import_ecount · ecount_monthly_import)는 0051 이후다. */
const COMMIT_PENDING = '등록은 다음 단계(DB 반영 후)에 열립니다. 지금은 미리보기 검증까지만 합니다.'

function denied(where: string, e: unknown, fallback: string): EcountImportState {
  console.error(`[ecount-import] ${where}`, e)
  const m = e instanceof Error ? e.message : ''
  if (/42501|row-level security|permission denied/.test(m)) return { error: NO_BOOKS }
  if (/finance_import_closed/.test(m)) return { error: '이미 등록되었거나 취소된 업로드입니다. 다시 올리려면 새로 시작하세요.' }
  if (/finance_import_hash_immutable/.test(m)) return { error: '미리보기 때와 다른 파일입니다. 취소하고 새로 올리세요.' }
  if (/PGRST205|42P01/.test(m)) return { error: 'ECOUNT 업로드 준비가 아직 끝나지 않았습니다(DB 반영 전). 잠시 후 다시 시도하세요.' }
  return { error: fallback }
}

function importPath(businessId: string) {
  return `/finance/${encodeURIComponent(businessId)}/import`
}

/** 본인의 진행 중(draft) 업로드 + 그 회사 장부 권한. 회사는 화면이 아니라 업로드 줄에서 읽는다. */
async function ownDraft(
  repo: ChairmanRepository,
  user: SessionUser,
  importId: unknown,
): Promise<{ imp: FinanceImport } | { error: string }> {
  if (typeof importId !== 'string' || !UUID.test(importId)) return { error: '어떤 업로드인지 알 수 없습니다.' }
  // RLS(can_read_books)가 안 보이는 회사의 업로드를 주지 않는다 — 없음과 볼 수 없음을 가르지 않는다.
  const imp = await repo.getFinanceImport(importId)
  if (!imp) return { error: '업로드를 찾지 못했습니다.' }
  if (imp.status !== 'draft') return { error: '이미 등록되었거나 취소된 업로드입니다. 다시 올리려면 새로 시작하세요.' }
  if (imp.created_by !== user.user_id) return { error: '올린 사람만 이 업로드를 이어 가거나 취소할 수 있습니다.' }
  if (!canImportEcount(user, imp.business_id)) return { error: NO_BOOKS }
  return { imp }
}

/**
 * 원본을 Storage에서 **서버가 다시** 읽는다. 원본은 업로드 한 건에 하나(beginAttachment가 둘째를 막는다) —
 * 둘 이상이면 어느 파일을 읽을지 흐려지므로 멈춘다. 읽기는 올린 본인 세션이다(0045 — 올린 사람은 통행증 없이 연다).
 */
async function readOriginal(
  repo: ChairmanRepository,
  imp: FinanceImport,
  user: SessionUser,
): Promise<{ bytes: Uint8Array; sha: string; fileName: string } | { error: string }> {
  const files = await repo.listAttachments('finance_imports', imp.import_id)
  if (files.length === 0) return { error: '원본 파일이 아직 올라가지 않았습니다. 취소하고 새로 올리세요.' }
  if (files.length > 1) return { error: '원본이 둘 이상입니다. 취소하고 새로 올리세요.' }
  const file = files[0]
  // 회사는 DB 트리거가 업로드에서 낸 값이다(0050 attachments_stamp) — 어긋나면 읽지 않는다.
  if (file.business_id !== imp.business_id) return { error: '원본의 회사가 업로드와 다릅니다. 취소하고 새로 올리세요.' }
  if (file.uploaded_by !== user.user_id) return { error: '원본을 올린 사람이 업로드를 만든 사람과 다릅니다. 취소하고 새로 올리세요.' }
  if (file.mime !== ATTACHMENT_MIME.xlsx) return { error: '원본이 엑셀(xlsx)이 아닙니다. 취소하고 새로 올리세요.' }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await repo.readAttachmentObject(file.storage_path))
  } catch (e) {
    console.error('[ecount-import] 원본 읽기', e)
    return { error: '원본 파일을 읽지 못했습니다(업로드가 끝나지 않았을 수 있습니다). 취소하고 새로 올리세요.' }
  }
  // 줄은 섰는데 바이트가 다 오지 않은 경우 — 반쪽 파일을 파싱하지 않는다.
  if (bytes.byteLength !== file.size_bytes) return { error: '원본 파일이 다 올라가지 않았습니다. 취소하고 새로 올리세요.' }
  return { bytes, sha: sha256Hex(bytes), fileName: file.file_name }
}

async function parse(bytes: Uint8Array): Promise<{ sheets: EcountSheet[] } | { error: string }> {
  try {
    return { sheets: await readEcountWorkbook(bytes) }
  } catch (e) {
    if (e instanceof EcountExcelError) return { error: e.message }
    console.error('[ecount-import] 파싱', e)
    return { error: '엑셀 파일을 읽지 못했습니다. 엑셀에서 열어 xlsx로 다시 저장한 뒤 올리세요.' }
  }
}

export async function startEcountImport(businessId: unknown, kind: unknown, fileName: unknown): Promise<EcountImportState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  const business_id = typeof businessId === 'string' ? businessId.trim() : ''
  const file_name = typeof fileName === 'string' ? fileName.trim().slice(0, 255) : ''
  if (!FINANCE_IMPORT_KIND.includes(kind as FinanceImportKind)) return { error: '무엇을 올리는지 알 수 없습니다.' }
  if (!business_id) return { error: '어느 회사의 업로드인지 알 수 없습니다.' }
  if (!file_name) return { error: '파일 이름이 없습니다.' }
  const fileProblem = ecountFileProblem(file_name)
  if (fileProblem) return { error: fileProblem }
  // ECOUNT 코드 체계 회사 + 그 회사 장부 권한(안내). 최종 판정은 0050 finance_imports_insert(can_keep_books).
  if (!canImportEcount(user, business_id)) {
    return { error: canKeepBooks(user, business_id) ? 'ECOUNT 업로드는 ECOUNT를 쓰는 회사만 합니다.' : NO_BOOKS }
  }

  try {
    const repo = await getRepository()
    // 보이는 회사인가(0002 has_business) — 화면이 보낸 id를 그대로 믿지 않는다.
    if (!(await repo.listBusinesses()).some((b) => b.business_id === business_id)) return { error: '회사를 찾지 못했습니다.' }
    const imp = await repo.createFinanceImport(
      { business_id, kind: kind as FinanceImportKind, file_name },
      { user_id: user.user_id, role: user.role },
    )
    // 화면 갱신은 올리기가 끝난 뒤 한 번(원본 없는 draft가 목록에 잠깐 서지 않게) — 업로드 단이 router.refresh한다.
    return { importId: imp.import_id }
  } catch (e) {
    return denied('start', e, '업로드를 시작하지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}

/** 취소 — 원본 첨부를 먼저 지우고(draft일 때만 지워진다) cancelled로. 첨부를 못 지우면 취소하지 않는다. */
export async function cancelEcountImport(importId: unknown): Promise<EcountImportState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const own = await ownDraft(repo, user, importId)
    if ('error' in own) return own
    const actor = { user_id: user.user_id, role: user.role }
    for (const a of await repo.listAttachments('finance_imports', own.imp.import_id)) {
      try {
        await repo.deleteAttachment(a.attachment_id, actor)
      } catch (e) {
        console.error('[ecount-import] 원본 취소', e)
        return { error: '원본 파일을 지우지 못해 취소하지 않았습니다. 잠시 후 다시 시도하세요.' }
      }
    }
    await repo.cancelFinanceImport(own.imp.import_id, actor)
    revalidatePath(importPath(own.imp.business_id))
    revalidatePath('/documents')
    return { importId: own.imp.import_id }
  } catch (e) {
    return denied('cancel', e, '취소하지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}

/** 이 업로드의 summary에 사람이 확정해 둔 열 지정(없거나 모양이 틀리면 null). */
function confirmedMapping(imp: FinanceImport): EcountMapping | null {
  return parseMapping(imp.summary?.mapping, imp.kind)
}

/** 그 회사 계정(비활성 포함)을 판정 모양으로. */
async function companyAccounts(repo: ChairmanRepository, businessId: string, ledger?: FinanceLedger): Promise<ExistingAccount[]> {
  return (ledger ?? (await repo.loadFinanceLedger())).accounts
    .filter((a) => a.business_id === businessId)
    .map((a) => ({ account_code: a.account_code, name: a.name, section: a.section, category: a.category, cash_flow: a.cash_flow, active: a.active }))
}

/** 계정과목 판정 재료 — 파일 행 + 그 회사의 기존 계정(비활성 포함 — 코드는 비활성이어도 이미 있다). */
async function accountsInput(repo: ChairmanRepository, imp: FinanceImport, sheets: EcountSheet[], mapping: EcountMapping) {
  const part = mapping.parts[0]
  const sheet = sheets.find((s) => s.name === part.sheet)!
  const { rows, ignored } = readAccountRows(sheet, part)
  return { rows, ignored, existing: await companyAccounts(repo, imp.business_id) }
}

/**
 * 연간 미리보기 — 검증만. 세무사 확정 결산(활성 · 한 해)이 있는 해는 막는다(설계서 B-② «확정과의 관계»).
 * 0050 전 목록에는 basis 칸이 없다 — 지금 있는 공식 결산은 전부 세무사 확정이다.
 */
async function annualPreview(repo: ChairmanRepository, imp: FinanceImport, sheets: EcountSheet[], mapping: EcountMapping): Promise<AmountsPreview> {
  const [accounts, officials] = await Promise.all([companyAccounts(repo, imp.business_id), repo.listOfficialStatements(imp.business_id)])
  const officialKeys = officials.filter((o) => o.period_kind === 'year').map((o) => o.period_key)
  return planAnnual(sheets, mapping, { accounts, officialKeys })
}

/**
 * 월별 미리보기 — 검증만. 마감된 달(0016 closed_period와 같은 판정) · 세무사 확정이 덮은 달 · 수기 전표가 있는 달을
 * 원장에서 읽어 넘긴다. 최종 판정은 등록 RPC(0051 이후)가 DB에서 다시 한다.
 */
async function monthlyPreview(repo: ChairmanRepository, imp: FinanceImport, sheets: EcountSheet[], mapping: EcountMapping): Promise<AmountsPreview> {
  const [ledger, officials] = await Promise.all([repo.loadFinanceLedger(), repo.listOfficialStatements(imp.business_id)])
  const journalMonths = [
    ...new Set(ledger.journal.filter((j) => j.business_id === imp.business_id && j.source === 'manual').map((j) => periodOfDate(j.entry_date))),
  ]
  return planMonthly(sheets, mapping, {
    accounts: await companyAccounts(repo, imp.business_id, ledger),
    lastClosed: lastClosedPeriod(ledger, imp.business_id),
    officials: officials.map((o) => ({ kind: o.period_kind, key: o.period_key })),
    journalMonths,
  })
}

/**
 * 미리보기 — 원본을 다시 읽고(sha256) 열 지정을 정한다.
 *   choices.mapping 없음  짐작한다: 이 업로드에 확정해 둔 지정 > 같은 회사 · 종류의 지난 업로드 지정(머리글이 그대로일 때) > 머리글 짐작.
 *                          확정해 둔 지정이 아니면 **미리보기를 만들지 않는다** — 사람이 열 지정 화면에서 확인해야 한다.
 *   choices.mapping 있음  사람이 «이 열 지정으로 미리보기»를 눌렀다 — 판정하고 summary.mapping에 확정으로 적는다.
 * DB 쓰기는 그 draft 한 줄(sha256 · summary · period_key)뿐이다.
 */
export async function previewEcountImport(importId: unknown, choices?: EcountPreviewChoices): Promise<EcountPreviewState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const own = await ownDraft(repo, user, importId)
    if ('error' in own) return own
    const { imp } = own
    const original = await readOriginal(repo, imp, user)
    if ('error' in original) return original
    // 한 번 적힌 해시와 다르면 다른 파일이다(0050 — 해시는 못 바꾼다).
    if (imp.file_sha256 && imp.file_sha256 !== original.sha) return { error: '미리보기 때와 다른 파일입니다. 취소하고 새로 올리세요.' }
    const parsed = await parse(original.bytes)
    if ('error' in parsed) return parsed
    const { sheets } = parsed
    const actor = { user_id: user.user_id, role: user.role }

    const outline = outlineWorkbook(sheets)
    const guess = guessMapping(sheets, imp.kind)
    const base: EcountPreviewState = {
      importId: imp.import_id,
      kind: imp.kind,
      outline,
      grids: sheetGrids(sheets),
      detectedUnit: guess.detectedUnit,
    }

    let mapping: EcountMapping | null = null
    if (choices?.mapping !== undefined) {
      const sent = parseMapping(choices.mapping, imp.kind)
      if (!sent) return { ...base, error: '열 지정을 읽지 못했습니다. 화면을 새로 고친 뒤 다시 지정하세요.' }
      mapping = withLabels(sent, sheets)
    } else {
      // «진행 중»에서 이어 가기 — 이 업로드에서 이미 확정한 지정이 있으면 그대로 미리보기까지.
      const mine = confirmedMapping(imp)
      if (mine && mappingProblems(mine, sheets).length === 0) mapping = withLabels(mine, sheets)
    }

    if (!mapping) {
      // 아직 확정 전 — 짐작만 보여 준다. 지난 업로드의 지정이 이 파일 머리글과 맞으면 그것을 먼저.
      const prev = await repo.findLatestFinanceImportMapping(imp.business_id, imp.kind, imp.import_id)
      const saved = prev ? parseMapping(prev.summary?.mapping, imp.kind) : null
      const reused = saved ? reuseMapping(saved, sheets) : null
      await repo.recordFinanceImportPreview(imp.import_id, { file_sha256: original.sha, summary: { stage: 'outline', sheets: outline } }, actor)
      revalidatePath(importPath(imp.business_id))
      if (reused) return { ...base, mapping: reused, mappingSource: 'reused' }
      return { ...base, mapping: guess.mapping, mappingSource: guess.found ? 'guessed' : 'none' }
    }

    const problems = mappingProblems(mapping, sheets)
    if (problems.length > 0) return { ...base, mapping, mappingSource: 'confirmed', mappingProblems: problems }

    const state: EcountPreviewState = { ...base, mapping, mappingSource: 'confirmed' }
    const summary: Record<string, unknown> = { stage: 'preview', sheets: outline, mapping }
    if (imp.kind === 'accounts') {
      const input = await accountsInput(repo, imp, sheets, mapping)
      const plan = planAccounts(input)
      state.accounts = input
      summary.counts = { rows: input.rows.length, creates: plan.creates.length, blocks: plan.blockCount, warnings: plan.warningCount }
    } else {
      const amounts = imp.kind === 'annual' ? await annualPreview(repo, imp, sheets, mapping) : await monthlyPreview(repo, imp, sheets, mapping)
      state.amounts = amounts
      // 금액 원문은 summary에 두지 않는다(원본은 첨부다) — 줄 수 · 차단 수만.
      summary.counts = { lines: amounts.lines.length, blocks: amounts.blockCount, warnings: amounts.warningCount }
    }
    await repo.recordFinanceImportPreview(
      imp.import_id,
      { file_sha256: original.sha, summary, period_key: imp.kind === 'accounts' ? null : mapping.year },
      actor,
    )
    revalidatePath(importPath(imp.business_id))
    return state
  } catch (e) {
    return denied('preview', e, '미리보기를 만들지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}

/**
 * 등록 — 같은 원본을 다시 읽고(sha256이 미리보기 때와 같아야 한다) **처음부터 다시** 판정한다.
 * 화면이 보낸 것은 사람의 선택(열 지정 · 분류 고침 · 이름 바꿀 코드)뿐이고, 열 지정은 미리보기에서 확정해
 * summary에 적힌 것과 같아야 한다 — 짐작한 지정으로는 등록하지 않는다.
 * 지금은 계정과목만 등록한다. 연간 · 월별은 DB 등록 함수(0051 이후)가 생긴 뒤.
 */
export async function commitEcountImport(importId: unknown, choices?: EcountCommitChoices): Promise<EcountCommitState> {
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  try {
    const repo = await getRepository()
    const own = await ownDraft(repo, user, importId)
    if ('error' in own) return own
    const { imp } = own
    if (imp.kind !== 'accounts') return { error: `${FINANCE_IMPORT_KIND_LABEL_KO[imp.kind]}: ${COMMIT_PENDING}` }
    if (!imp.file_sha256) return { error: '미리보기를 먼저 하세요.' }
    const original = await readOriginal(repo, imp, user)
    if ('error' in original) return original
    if (original.sha !== imp.file_sha256) return { error: '미리보기 때와 다른 파일입니다. 취소하고 새로 올리세요.' }

    const saved = confirmedMapping(imp)
    const sent = parseMapping(choices?.mapping, imp.kind)
    if (!saved || !sent || !sameMapping(saved, sent)) {
      return { error: '열 지정이 미리보기 때와 다릅니다. «이 열 지정으로 미리보기»를 다시 누른 뒤 등록하세요.' }
    }
    const parsed = await parse(original.bytes)
    if ('error' in parsed) return parsed
    const problems = mappingProblems(saved, parsed.sheets)
    if (problems.length > 0) return { error: problems[0] }

    const input = await accountsInput(repo, imp, parsed.sheets, saved)
    const picked = parseAccountChoices(choices?.overrides, choices?.renames)
    const plan = planAccounts({ ...input, ...picked })
    if (plan.blockCount > 0) return { error: `막힌 줄이 ${plan.blockCount}개 있습니다. 미리보기에서 고친 뒤 등록하세요.` }

    const actor = { user_id: user.user_id, role: user.role }
    const note = ecountAuditNote({ kind: imp.kind, period: null, fileName: original.fileName, importId: imp.import_id })
    const result = await repo.mergeEcountAccounts(
      imp.business_id,
      { creates: plan.creates.map((c) => ({ ...c, business_id: imp.business_id })), renames: plan.renames },
      actor,
      note,
    )
    await repo.commitFinanceImport(
      imp.import_id,
      {
        ...(imp.summary ?? {}),
        stage: 'committed',
        mapping: saved,
        result: { ...result, unchanged: plan.lines.length - plan.creates.length - plan.renames.length },
      },
      actor,
    )
    const base = `/finance/${encodeURIComponent(imp.business_id)}`
    revalidatePath(importPath(imp.business_id))
    revalidatePath(`${base}/accounts`)
    revalidatePath(base, 'layout')
    revalidatePath('/finance')
    return { importId: imp.import_id, ...result }
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (m === DUPLICATE_ACCOUNT_CODE) return { error: '그 사이에 같은 계정코드가 장부에 생겼습니다. 미리보기를 다시 하세요.' }
    return denied('commit', e, '등록하지 못했습니다. 잠시 후 다시 시도하세요.')
  }
}
